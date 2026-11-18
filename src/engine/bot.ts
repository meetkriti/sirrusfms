// The WhatsApp bot: turns scheduled tasks into prompts and replies into structured updates.
import type { ChecklistItem, ChecklistTemplate, ConvState, TaskInstance, Ticket } from "../types";
import { firstName, locationById, locationName, staffById, taskTitle, templateById, type World } from "./core";
import { SimulatedAdapter, parseWebhook, type InboundWebhook } from "./messaging";
import { classifyComplaint, guessLocation, parseReply, type Classification, type ParsedReply } from "./nlp";
import { completeTask, isOpen, graceFor } from "./tasks";
import { acknowledgeTicket, clientConfirm, createTicket, resolveTicket } from "./tickets";
import { raiseAlert, rule } from "./alerts";
import { time12 } from "../lib/format";
import { MIN, minutesOfDay } from "../lib/time";

export interface BotOptions {
  /** Live-mode fallback for replies the deterministic parser cannot understand. */
  intentFallback?: (text: string, task: TaskInstance | null) => Promise<ParsedReply | null>;
  /** Live-mode complaint classifier; falls back to the mock classifier. */
  classify?: (text: string) => Promise<Classification & { by: "live" | "mock" }>;
  /** Meter photo handler (M6). Returns the bot's reply text. */
  onMeterPhoto?: (staffId: string, photo: string) => Promise<string> | string;
}

const greeting = (ms: number) => {
  const m = minutesOfDay(ms);
  return m < 12 * 60 ? "Good morning" : m < 17 * 60 ? "Good afternoon" : "Good evening";
};

export function sendTaskPrompt(w: World, task: TaskInstance) {
  const db = w.db;
  const t = templateById(db, task.template_id)!;
  const wa = new SimulatedAdapter(w);
  const loc = locationById(db, task.location_id);
  const where = loc && loc.kind !== "project" ? `, ${loc.name}` : "";
  const name = firstName(db, task.assignee_id);
  if (t.mode === "stepwise") {
    wa.sendInteractive(
      task.assignee_id,
      `${greeting(w.now)} ${name}. ${t.name}${where}, due by ${time12(task.due_at)}. ${t.items.length} items to fill. Tap Start, or reply START.`,
      [{ id: `start:${task.id}`, title: "Start log" }],
      { task_id: task.id },
    );
  } else {
    wa.sendInteractive(
      task.assignee_id,
      `${greeting(w.now)} ${name}. ${t.name}${where}, due by ${time12(task.due_at)}. Reply 1 = Done, 2 = Partly done, 3 = Not done, or send a photo.${t.photo_required ? " 📷 Photo required." : ""}`,
      [
        { id: `t1:${task.id}`, title: "1 Done" },
        { id: `t2:${task.id}`, title: "2 Partly done" },
        { id: `t3:${task.id}`, title: "3 Not done" },
      ],
      { task_id: task.id },
    );
  }
  if (task.status === "scheduled") task.status = "sent";
  task.updated_at = w.now;
}

export function sendReminder(w: World, task: TaskInstance) {
  const wa = new SimulatedAdapter(w);
  const t = templateById(w.db, task.template_id)!;
  wa.sendInteractive(
    task.assignee_id,
    `⏰ Reminder: ${taskTitle(w.db, task.template_id, task.location_id)} was due at ${time12(task.due_at)} and is not marked done yet. Please complete within ${graceFor(t)} min.`,
    t.mode === "stepwise" ? [{ id: `start:${task.id}`, title: "Start log" }] : [
      { id: `t1:${task.id}`, title: "1 Done" },
      { id: `t3:${task.id}`, title: "3 Not done" },
    ],
    { task_id: task.id },
  );
}

function openTasksFor(w: World, staffId: string): TaskInstance[] {
  return w.db.tasks
    .filter((t) => t.assignee_id === staffId && (t.status === "sent" || t.status === "in_progress" || (t.status === "missed" && t.date === dateOf(w.now))))
    .sort((a, b) => (a.status === "missed" ? 1 : 0) - (b.status === "missed" ? 1 : 0) || a.due_at - b.due_at);
}
const dateOf = (ms: number) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);

function itemPrompt(t: ChecklistTemplate, idx: number): string {
  const it = t.items[idx];
  const n = `(${idx + 1}/${t.items.length})`;
  if (it.type === "numeric_reading") return `${n} ${it.label}${it.unit ? ` (${it.unit})` : ""}? Acceptable range ${it.min}–${it.max}.`;
  if (it.type === "yes_no") return `${n} ${it.label}? Reply YES or NO.`;
  if (it.type === "photo") return `${n} 📷 Please send: ${it.label}.`;
  return `${n} ${it.label}? (type a short note, or SKIP)`;
}

function askItem(w: World, task: TaskInstance, idx: number) {
  const t = templateById(w.db, task.template_id)!;
  const wa = new SimulatedAdapter(w);
  const it = t.items[idx];
  if (it.type === "yes_no")
    wa.sendInteractive(task.assignee_id, itemPrompt(t, idx), [{ id: "yn:yes", title: "YES" }, { id: "yn:no", title: "NO" }], { task_id: task.id });
  else wa.sendMessage(task.assignee_id, itemPrompt(t, idx), { task_id: task.id });
  w.db.convState[task.assignee_id] = { kind: "stepwise", task_id: task.id, item_index: idx };
}

function finish(w: World, task: TaskInstance, extra: { photo?: string; remarks?: string; source?: "whatsapp_workflow" } = {}) {
  const wa = new SimulatedAdapter(w);
  completeTask(w, task, { source: "whatsapp_workflow", photo: extra.photo, remarks: extra.remarks });
  w.db.convState[task.assignee_id] = { kind: "idle" };
  const late = task.status === "done_late";
  wa.sendMessage(
    task.assignee_id,
    `✅ Recorded: ${taskTitle(w.db, task.template_id, task.location_id)} marked ${late ? "done (late)" : "done"} at ${time12(w.now)}.${task.photos.length ? " Photo saved." : ""} Thank you!`,
    { task_id: task.id },
  );
  const next = openTasksFor(w, task.assignee_id).filter((x) => x.id !== task.id && x.status !== "missed");
  if (next.length) wa.sendMessage(task.assignee_id, `Next pending: ${taskTitle(w.db, next[0].template_id, next[0].location_id)} (due ${time12(next[0].due_at)}).`, { task_id: next[0].id });
}

function startStepwise(w: World, task: TaskInstance) {
  task.status = "in_progress";
  task.updated_at = w.now;
  askItem(w, task, 0);
}

function handleStepwise(w: World, st: Extract<ConvState, { kind: "stepwise" }>, ev: Inbound) {
  const db = w.db;
  const task = db.tasks.find((x) => x.id === st.task_id)!;
  const t = templateById(db, task.template_id)!;
  const it: ChecklistItem = t.items[st.item_index];
  const wa = new SimulatedAdapter(w);
  const advance = () => {
    const nextIdx = st.item_index + 1;
    if (nextIdx >= t.items.length) finish(w, task);
    else askItem(w, task, nextIdx);
  };
  if (it.type === "numeric_reading") {
    const p = parseReply(ev.text ?? "");
    if (p.intent === "number" && p.number !== undefined) {
      const v = p.number;
      if ((it.min !== undefined && v < it.min) || (it.max !== undefined && v > it.max)) {
        db.convState[task.assignee_id] = { ...st, pending_out_of_range: { item_id: it.id, value: v } };
        wa.sendMessage(task.assignee_id, `⚠️ ${it.label} ${v}${it.unit ? " " + it.unit : ""} is outside ${it.min}–${it.max}. Please recheck and send the value again, or add a remark.`, { task_id: task.id });
        return;
      }
      task.responses[it.id] = v;
      advance();
      return;
    }
    if (st.pending_out_of_range && (ev.text ?? "").trim()) {
      // Remark accepted for an out-of-range value: record it and fire R4.
      const { item_id, value } = st.pending_out_of_range;
      task.responses[item_id] = value;
      task.out_of_range = [...(task.out_of_range ?? []), item_id];
      task.remarks = [task.remarks, `${it.label}: ${ev.text}`].filter(Boolean).join("; ");
      const r4 = rule("R4");
      if (r4?.enabled)
        raiseAlert(
          w,
          {
            rule_id: "R4",
            severity: r4.severity,
            title: `Out of range: ${it.label} ${value}${it.unit ? " " + it.unit : ""} (${t.name})`,
            reason: `Rule R4 fired: ${it.label} reported as ${value}${it.unit ? " " + it.unit : ""} at ${locationName(db, task.location_id)}; acceptable range is ${it.min}–${it.max}. Remark from ${staffById(db, task.assignee_id)?.name}: "${ev.text}".`,
            targets: r4.notify,
            entity: { type: "task", id: task.id },
          },
          { serviceLine: t.service_line, assignee: task.assignee_id, whatsapp: r4.send_whatsapp },
        );
      wa.sendMessage(task.assignee_id, `Noted with remark. The Technical Supervisor and FM have been alerted.`, { task_id: task.id });
      db.convState[task.assignee_id] = { kind: "stepwise", task_id: task.id, item_index: st.item_index };
      advance();
      return;
    }
    wa.sendMessage(task.assignee_id, `Please send a number for ${it.label}${it.unit ? ` (${it.unit})` : ""}.`, { task_id: task.id });
    return;
  }
  if (it.type === "yes_no") {
    const p = ev.buttonId === "yn:yes" ? "yes" : ev.buttonId === "yn:no" ? "no" : parseReply(ev.text ?? "").intent;
    if (p === "yes" || p === "done") task.responses[it.id] = true;
    else if (p === "no" || p === "not_done") {
      task.responses[it.id] = false;
      task.remarks = [task.remarks, `${it.label}: NO`].filter(Boolean).join("; ");
    } else {
      wa.sendMessage(task.assignee_id, "Please reply YES or NO.", { task_id: task.id });
      return;
    }
    advance();
    return;
  }
  if (it.type === "photo") {
    if (ev.photo) {
      task.photos.push(ev.photo);
      advance();
      return;
    }
    if (/^skip$/i.test((ev.text ?? "").trim())) {
      task.remarks = [task.remarks, "Photo skipped"].filter(Boolean).join("; ");
      advance();
      return;
    }
    wa.sendMessage(task.assignee_id, "📷 Please send the photo (or type SKIP; it will be flagged).", { task_id: task.id });
    return;
  }
  task.responses[it.id] = /^skip$/i.test((ev.text ?? "").trim()) ? "" : ev.text ?? "";
  advance();
}

interface Inbound {
  staffId: string;
  kind: "text" | "button" | "image";
  text?: string;
  buttonId?: string;
  photo?: string;
  msgId: string;
}

export async function handleInbound(w: World, webhook: InboundWebhook, opts: BotOptions = {}) {
  const ev = parseWebhook(w.db, webhook) as Inbound;
  const db = w.db;
  const person = staffById(db, ev.staffId);
  if (!person) return;
  const wa = new SimulatedAdapter(w);
  const st: ConvState = db.convState[ev.staffId] ?? { kind: "idle" };

  // ---- Buttons carry explicit references ----
  if (ev.buttonId) {
    const [action, ref] = ev.buttonId.split(":");
    if (action === "tkt_ack" || action === "tkt_res") {
      const tk = db.tickets.find((x) => x.id === ref);
      if (!tk) return;
      if (action === "tkt_ack") {
        acknowledgeTicket(w, tk, ev.staffId);
        wa.sendMessage(ev.staffId, `👍 ${tk.number} acknowledged. Please update when resolved.`, { ticket_id: tk.id });
      } else {
        resolveTicket(w, tk, ev.staffId, `Resolved by ${person.name} (via WhatsApp)`);
        wa.sendMessage(ev.staffId, `✅ ${tk.number} marked resolved. The client has been asked to confirm.`, { ticket_id: tk.id });
      }
      return;
    }
    if (action === "close_yes" || action === "close_no") {
      const tk = db.tickets.find((x) => x.id === ref);
      if (!tk) return;
      clientConfirm(w, tk, action === "close_yes");
      db.convState[ev.staffId] = { kind: "idle" };
      wa.sendMessage(ev.staffId, action === "close_yes" ? `Thank you. ${tk.number} is closed.` : `Sorry about that. ${tk.number} has been reopened and the Facility Manager informed.`, { ticket_id: tk.id });
      return;
    }
    if (action === "start" || action === "t1" || action === "t2" || action === "t3") {
      const task = db.tasks.find((x) => x.id === ref);
      if (!task) return;
      if (!isOpen(task) && task.status !== "missed") {
        wa.sendMessage(ev.staffId, `${taskTitle(db, task.template_id, task.location_id)} is already recorded as ${task.status.replace("_", " ")}.`, { task_id: task.id });
        return;
      }
      if (action === "start") return startStepwise(w, task);
      const intent = action === "t1" ? "done" : action === "t2" ? "partial" : "not_done";
      return applyIntent(w, task, { intent, confidence: 1, towers: [] });
    }
    if (st.kind === "stepwise") return handleStepwise(w, st, ev);
    return;
  }

  // ---- Conversation state ----
  if (st.kind === "stepwise") return handleStepwise(w, st, ev);
  if (st.kind === "awaiting_photo") {
    const task = db.tasks.find((x) => x.id === st.task_id)!;
    if (ev.photo) return finish(w, task, { photo: ev.photo });
    if (/^skip$/i.test((ev.text ?? "").trim())) return finish(w, task, { remarks: "Completed without photo (photo skipped)" });
    wa.sendMessage(ev.staffId, "📷 Photo is required for this checklist. Please send a photo, or type SKIP (it will be flagged).", { task_id: task.id });
    return;
  }
  if (st.kind === "awaiting_remark") {
    const task = db.tasks.find((x) => x.id === st.task_id)!;
    task.remarks = ev.text ?? "";
    db.convState[ev.staffId] = { kind: "idle" };
    if (st.status === "partial") {
      task.status = "in_progress";
      wa.sendMessage(ev.staffId, `Noted: partly done ("${task.remarks}"). Reply 1 when fully done.`, { task_id: task.id });
    } else {
      task.reported_not_done = true;
      wa.sendMessage(ev.staffId, `Noted: not done ("${task.remarks}"). Your supervisor and the FM will be informed if it is not completed by ${time12(task.due_at + graceFor(templateById(db, task.template_id)!) * MIN)}.`, { task_id: task.id });
    }
    task.updated_at = w.now;
    return;
  }
  if (st.kind === "awaiting_closure") {
    const p = parseReply(ev.text ?? "");
    const tk = db.tickets.find((x) => x.id === st.ticket_id);
    if (tk && (p.intent === "yes" || p.intent === "no")) {
      clientConfirm(w, tk, p.intent === "yes");
      db.convState[ev.staffId] = { kind: "idle" };
      wa.sendMessage(ev.staffId, p.intent === "yes" ? `Thank you. ${tk.number} is closed.` : `Sorry about that. ${tk.number} has been reopened and the Facility Manager informed.`, { ticket_id: tk.id });
      return;
    }
    // Anything else from the client is treated as a new message below.
    db.convState[ev.staffId] = { kind: "idle" };
  }
  if (st.kind === "ticket_location") {
    const loc = guessLocation(ev.text ?? "") ?? (ev.text ? "PRJ" : null);
    if (!loc) return;
    db.convState[ev.staffId] = { kind: "idle" };
    return openClientTicket(w, ev.staffId, { ...st.draft, location_id: loc }, ev.msgId);
  }

  // ---- Client (society committee) messages become tickets ----
  if (person.role === "client") {
    if (ev.photo && !(ev.text ?? "").trim()) {
      const recent = [...db.tickets].reverse().find((t) => t.raised_by !== "internal" && w.now - t.created_at < 60 * MIN && t.status !== "closed");
      if (recent) {
        recent.photos.push(ev.photo);
        recent.timeline.push({ at: w.now, type: "photo_added", by: person.name, text: "Photo added by client via WhatsApp." });
        wa.sendMessage(ev.staffId, `📷 Photo added to ${recent.number}. Thank you.`, { ticket_id: recent.id });
      } else wa.sendMessage(ev.staffId, "Thank you for the photo. Please describe the issue and location so we can raise a ticket.");
      return;
    }
    const p = parseReply(ev.text ?? "");
    if (p.intent === "greeting") {
      wa.sendMessage(ev.staffId, "Namaskara 🙏 Please describe any issue (what and where) and we will raise a ticket.");
      return;
    }
    const cls = opts.classify ? await opts.classify(ev.text ?? "") : { ...classifyComplaint(ev.text ?? ""), by: "mock" as const };
    const draft = { text: ev.text ?? "", category: cls.category, priority: cls.priority, photo: ev.photo, confidence: cls.confidence, by: cls.by };
    if (!cls.location_id) {
      db.convState[ev.staffId] = { kind: "ticket_location", draft };
      wa.sendMessage(ev.staffId, `Thank you. To raise this (${cls.category}), which tower or area is it? e.g. "Tower B lift lobby", "Clubhouse", "Main gate".`);
      return;
    }
    return openClientTicket(w, ev.staffId, { ...draft, location_id: cls.location_id }, ev.msgId);
  }

  // ---- Staff ----
  if (ev.photo && /\/meters\//.test(ev.photo) && opts.onMeterPhoto) {
    const reply = await opts.onMeterPhoto(ev.staffId, ev.photo);
    wa.sendMessage(ev.staffId, reply);
    return;
  }
  const open = openTasksFor(w, ev.staffId);
  if (!open.length) {
    wa.sendMessage(ev.staffId, "No pending checklists for you right now 👍");
    return;
  }
  if (ev.photo) {
    const task = open[0];
    const tpl = templateById(db, task.template_id)!;
    if (tpl.mode === "stepwise") return startStepwise(w, task);
    return finish(w, task, { photo: ev.photo, remarks: ev.text || undefined });
  }
  let parsed = parseReply(ev.text ?? "");
  if ((parsed.intent === "unknown" || parsed.confidence < 0.6) && opts.intentFallback) {
    const llm = await opts.intentFallback(ev.text ?? "", open[0]);
    if (llm) parsed = llm;
  }
  if (parsed.intent === "greeting") {
    wa.sendMessage(ev.staffId, `🙏 You have ${open.length} pending: ${open.slice(0, 3).map((t) => taskTitle(db, t.template_id, t.location_id)).join("; ")}.`);
    return;
  }
  // Tower mentions ("A and B tower done") target matching tasks.
  let targets = open;
  if (parsed.towers.length) {
    const byTower = open.filter((t) => parsed.towers.includes(locationById(db, t.location_id)?.tower ?? ""));
    if (byTower.length) targets = byTower;
  }
  if (parsed.intent === "done" && parsed.towers.length && targets.length > 1) {
    for (const t of targets) {
      const tpl = templateById(db, t.template_id)!;
      if (tpl.mode === "stepwise") continue;
      completeTask(w, t, { source: "whatsapp_workflow", remarks: tpl.photo_required ? "Marked done by text (no photo)" : undefined });
    }
    wa.sendMessage(ev.staffId, `✅ Recorded ${targets.length} tasks as done: ${targets.map((t) => taskTitle(db, t.template_id, t.location_id)).join("; ")}. Photos are still welcome.`);
    return;
  }
  if (parsed.intent === "unknown" || parsed.intent === "number" || parsed.intent === "yes" || parsed.intent === "no" || parsed.intent === "skip") {
    const t = targets[0];
    const tpl = templateById(db, t.template_id)!;
    if (tpl.mode === "stepwise" && /start|shuru|begin/i.test(ev.text ?? "")) return startStepwise(w, t);
    wa.sendMessage(ev.staffId, `Sorry, I didn't understand. For ${taskTitle(db, t.template_id, t.location_id)}: reply 1 = Done, 2 = Partly done, 3 = Not done${tpl.mode === "stepwise" ? ", or START to fill the log" : ", or send a photo"}.`, { task_id: t.id });
    return;
  }
  return applyIntent(w, targets[0], parsed);
}

function applyIntent(w: World, task: TaskInstance, parsed: ParsedReply) {
  const db = w.db;
  const tpl = templateById(db, task.template_id)!;
  const wa = new SimulatedAdapter(w);
  if (parsed.intent === "done") {
    if (tpl.mode === "stepwise") return startStepwise(w, task);
    if (tpl.photo_required && !task.photos.length) {
      db.convState[task.assignee_id] = { kind: "awaiting_photo", task_id: task.id };
      wa.sendMessage(task.assignee_id, `Great. 📷 Please send a photo for ${taskTitle(db, task.template_id, task.location_id)}.`, { task_id: task.id });
      return;
    }
    return finish(w, task);
  }
  if (parsed.intent === "partial" || parsed.intent === "not_done") {
    db.convState[task.assignee_id] = { kind: "awaiting_remark", task_id: task.id, status: parsed.intent === "partial" ? "partial" : "not_done" };
    wa.sendMessage(task.assignee_id, parsed.intent === "partial" ? "What is still pending? (short note)" : "What is the reason? (short note, e.g. staff on leave)", { task_id: task.id });
  }
}

function openClientTicket(
  w: World,
  clientId: string,
  d: { text: string; category: Ticket["category"]; priority: Ticket["priority"]; photo?: string; confidence: number; by: "mock" | "live"; location_id: string },
  msgId: string,
) {
  const person = staffById(w.db, clientId)!;
  const userMsg = [...w.db.chat].reverse().find((m) => m.phone_owner === clientId && m.from === "user");
  const tk = createTicket(w, {
    raised_by: "client",
    raised_by_name: `${person.name} (${person.title})`,
    channel: "whatsapp",
    category: d.category,
    priority: d.priority,
    location_id: d.location_id,
    description: d.text,
    photos: d.photo ? [d.photo] : [],
    classification: { by: d.by, confidence: d.confidence },
    source: "whatsapp_workflow",
    linked_message_ids: userMsg ? [userMsg.id] : [msgId],
  });
  const wa = new SimulatedAdapter(w);
  wa.sendMessage(
    clientId,
    `🎫 Ticket ${tk.number} raised: ${tk.category} at ${locationName(w.db, tk.location_id)} (priority ${tk.priority}). Owner: ${staffById(w.db, tk.owner_id)?.name}. We will update you here.${tk.photos.length ? "" : " 📷 If you can, please send a photo of the issue."}`,
    { ticket_id: tk.id },
  );
}
