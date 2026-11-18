// M5: Message intelligence. Parse a WhatsApp export / emails → threads → candidate
// events (Mock: deterministic rules; Live: LLM with a strict JSON schema) → map to
// tasks, tickets, inspections and deliveries in code. Every event links to its source.
import type { DB, ExtractedEvent, ExtractedType, Inspection, RawMessage, TicketCategory } from "../types";
import { addDays, istAt, istDate, MIN, HOUR, minutesOfDay } from "../lib/time";
import { GROUP_ALIASES } from "./aliases";
import { baseFields, locationName, nid, PROJECT_ID, staffName, templateById, type World } from "./core";
import { classifyComplaint, extractTowers, guessLocation } from "./nlp";
import { createTicket } from "./tickets";
import type { SeedEmail } from "./seedMessages";

export const AUTO_ACCEPT = 0.85;

// ---------- Parsing ----------

const LINE_RE = /^\[?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?\]?\s*(?:-\s*)?([^:]+?):\s([\s\S]*)$/;

export function parseWhatsAppExport(text: string, startIndex = 0): RawMessage[] {
  const out: RawMessage[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/‎/g, "");
    const m = line.match(LINE_RE);
    if (!m) {
      if (out.length && line.trim()) out[out.length - 1].text += "\n" + line;
      continue;
    }
    const [, dd, mm, yy, hh, mi, ap, sender, body] = m;
    let h = Number(hh);
    if (ap) {
      const pm = ap.toLowerCase() === "pm";
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    const date = `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    const ts = istAt(date, `${String(h).padStart(2, "0")}:${mi}`);
    const isMedia = /^<(photo|media omitted|image omitted)>$/i.test(body.trim()) || /\.(jpg|jpeg|png) \(file attached\)$/i.test(body.trim());
    out.push({
      id: `RAW-${String(startIndex + out.length + 1).padStart(5, "0")}`, project_id: PROJECT_ID, channel: "whatsapp_group", sender: sender.trim(), timestamp: ts,
      text: isMedia ? "" : body.trim(), attachments: isMedia ? ["/samples/generic.svg"] : /<voice note>|audio omitted/i.test(body) ? ["voice-note"] : [],
    });
  }
  return out;
}

export function emailsToRaw(emails: SeedEmail[], startIndex = 0): RawMessage[] {
  return emails.map((e, i) => ({
    id: `RAW-E${String(startIndex + i + 1).padStart(4, "0")}`, project_id: PROJECT_ID, channel: "email", sender: `${e.from_name} <${e.from}>`, timestamp: e.date,
    text: e.body, subject: e.subject, attachments: [],
  }));
}

export interface Thread {
  id: string;
  message_ids: string[];
  sender: string;
  channel: RawMessage["channel"];
  at: number;
  text: string;
  subject?: string;
  photos: number;
}

/** Group consecutive messages from one sender within 5 minutes (e.g. text + photo). */
export function threadMessages(raw: RawMessage[]): Thread[] {
  const out: Thread[] = [];
  for (const m of raw) {
    const last = out[out.length - 1];
    if (m.channel !== "email" && last && last.channel !== "email" && last.sender === m.sender && m.timestamp - last.at <= 5 * MIN) {
      last.message_ids.push(m.id);
      if (m.text) last.text = last.text ? `${last.text}\n${m.text}` : m.text;
      if (m.attachments.some((a) => a !== "voice-note")) last.photos++;
      continue;
    }
    out.push({
      id: `THR-${m.id}`, message_ids: [m.id], sender: m.sender, channel: m.channel, at: m.timestamp, text: m.text, subject: m.subject,
      photos: m.attachments.filter((a) => a !== "voice-note").length,
    });
    if (m.attachments.includes("voice-note")) out[out.length - 1].text = "<voice note>";
  }
  return out;
}

// ---------- Candidate extraction ----------

export interface Candidate {
  type: ExtractedType;
  summary: string;
  confidence: number;
  fields: {
    template_id?: string;
    towers?: string[];
    location_id?: string;
    slot_hint?: "morning" | "evening" | "night";
    readings?: Record<string, number>;
    category?: TicketCategory;
    description?: string;
    shift?: "morning" | "afternoon" | "night";
    on_duty?: number;
    absent?: number;
    replacement?: boolean;
    item?: string;
    quantity?: number;
    acknowledged?: boolean;
    overall_score?: number;
    scores?: { area: string; score: number; max: number; note: string }[];
    ticket_update?: "acknowledged" | "resolved";
    note?: string;
  };
}

const NOISE = /^(good (morning|afternoon|evening|night)( sir| all| team)?[\s🙏.!,]*|ok( sir)?|okay|noted( sir)?|👍+|🙏+|👏+|thanks|thank you|pls share photos also|gm all.*|good work.*)$/iu;
const isNoise = (t: string) => t.split("\n").every((l) => !l.trim() || NOISE.test(l.trim()));
const DONE_WORDS = /\b(done|ho ?ga?ya|complete(d)?|finished|cleaning done|mopping done|aaytu)\b/i;

export function mockExtract(th: Thread): Candidate[] {
  const text = th.text.trim();
  const s = text.toLowerCase();
  const out: Candidate[] = [];
  const photoBoost = th.photos ? 0.03 : 0;
  const isClient = /Secretary|Committee|secretary|kavitha|srinivas/i.test(th.sender);

  if (th.channel === "email") return mockExtractEmail(th);
  if (!text && th.photos) return [{ type: "other", summary: "Photo without caption", confidence: 0.4, fields: { note: "Photo shared without any text; cannot be linked automatically." } }];
  if (!text || isNoise(text)) return [];
  if (/<voice note>/i.test(text)) return [{ type: "other", summary: "Voice note (not transcribed in prototype)", confidence: 0.3, fields: { note: "Voice note: transcription is not available in the prototype. Listen and classify manually." } }];
  if (/^forwarded:/i.test(text)) {
    if (/power shutdown|bescom|water cut|bwssb/i.test(text)) return [{ type: "other", summary: "Utility notice forwarded (planned power shutdown)", confidence: 0.6, fields: { note: "Planned shutdown notice: consider scheduling DG readiness check." } }];
    return [];
  }

  // Client / committee complaints
  if (isClient) {
    const c = classifyComplaint(text);
    out.push({ type: "issue_reported", summary: `${c.category} issue reported by ${th.sender}`, confidence: c.confidence >= 0.8 ? 0.82 : 0.6, fields: { category: c.category, location_id: c.location_id ?? undefined, description: text } });
    return out;
  }
  // Staff ticket updates
  if (/^(checking|ok sir, attending|noted sir, team sent|on it|done sir, issue solved|completed sir, pls check|lift working now|rectified)/i.test(text) || /amc person called/i.test(s)) {
    const resolved = /solved|completed|working now|rectified/i.test(s);
    return [{ type: "other", summary: resolved ? "Staff reports issue resolved" : "Staff acknowledges issue", confidence: 0.86, fields: { ticket_update: resolved ? "resolved" : "acknowledged" } }];
  }
  // Staircases (with towers reported pending)
  if (/stair/.test(s)) {
    let towers = /all (4 )?towers|a b c d|all 4 towers/i.test(s) ? ["A", "B", "C", "D"] : extractTowers(text.split(/[.]/)[0]);
    const pendingSeg = text.split(/[.]/).slice(1).join(".");
    const pending = /leave|pending|nahi|not/i.test(pendingSeg) ? extractTowers(pendingSeg) : [];
    towers = towers.filter((t) => !pending.includes(t));
    if (towers.length && DONE_WORDS.test(s)) out.push({ type: "task_completed", summary: `Staircase cleaning done: Tower ${towers.join(", ")}`, confidence: Math.min(0.97, 0.9 + photoBoost), fields: { template_id: "hk_staircase", towers } });
    if (pending.length) out.push({ type: "other", summary: `Staircase pending: Tower ${pending.join(", ")} (${/leave/i.test(pendingSeg) ? "staff on leave" : "pending"})`, confidence: 0.88, fields: { template_id: "hk_staircase", towers: pending, note: pendingSeg.trim() } });
    return out;
  }
  if (/lobby/.test(s) && DONE_WORDS.test(s)) {
    const towers = /all towers/.test(s) ? ["A", "B", "C", "D"] : extractTowers(text);
    out.push({ type: "task_completed", summary: `Lift lobby cleaning done: Tower ${towers.join(", ")}`, confidence: 0.88, fields: { template_id: "hk_lift_lobby", towers, slot_hint: minutesOfDay(th.at) < 13 * 60 ? "morning" : "evening" } });
    return out;
  }
  if (/basement/.test(s) && DONE_WORDS.test(s)) return [{ type: "task_completed", summary: "Basement sweeping done", confidence: 0.88 + photoBoost, fields: { template_id: "hk_basement", location_id: /2|b2/.test(s) ? "BASE-2" : "BASE-1" } }];
  if (/watering/.test(s)) return [{ type: "task_completed", summary: "Garden watering done", confidence: 0.9, fields: { template_id: "land_watering", location_id: "GARDEN" } }];
  if (/mowing|grass cut/.test(s)) return [{ type: "task_completed", summary: "Lawn mowing done", confidence: 0.87, fields: { template_id: "land_mowing", location_id: "GARDEN" } }];
  if (/washroom/.test(s) && DONE_WORDS.test(s)) return [{ type: "task_completed", summary: "Clubhouse washroom cleaning done", confidence: 0.86, fields: { template_id: "hk_washroom", location_id: "CLUB-WR", slot_hint: minutesOfDay(th.at) < 13 * 60 ? "morning" : "evening" } }];
  if (/(garbage|kasa)/.test(s) && /(done|handed|segregation)/.test(s)) return [{ type: "task_completed", summary: "Garbage segregation / handover done", confidence: 0.86, fields: { template_id: "hk_garbage", location_id: "GARBAGE-PT" } }];
  if (/patrol|rounds|checkpoints/.test(s)) return [{ type: "task_completed", summary: "Night patrol rounds completed", confidence: 0.88, fields: { template_id: "sec_patrol", location_id: "PRJ" } }];
  if (/\bph\s*[\d.]+/.test(s)) {
    const ph = Number(s.match(/ph\s*([\d.]+)/)![1]);
    const mlss = s.match(/mlss\s*(\d+)/) ? Number(s.match(/mlss\s*(\d+)/)![1]) : undefined;
    out.push({ type: "meter_reading", summary: `STP log: pH ${ph}${mlss ? `, MLSS ${mlss}` : ""}`, confidence: 0.92, fields: { template_id: "stp_log", readings: { ph, ...(mlss ? { mlss } : {}) }, slot_hint: minutesOfDay(th.at) < 14 * 60 ? "morning" : "evening" } });
    if (/noise|problem|leak|not working|vibration/.test(s)) out.push({ type: "issue_reported", summary: "Possible equipment fault at STP (blower noise)", confidence: 0.7, fields: { category: "STP/Odour", location_id: "STP-ROOM", description: text } });
    return out;
  }
  if (/pump room|pressure/.test(s)) {
    const p = s.match(/pressure\s*([\d.]+)/);
    const h = s.match(/run\s*([\d.]+)/);
    return [{ type: "meter_reading", summary: "Pump room log", confidence: 0.9, fields: { template_id: "tech_pump", location_id: "PUMP-ROOM", readings: { ...(p ? { pressure: Number(p[1]) } : {}), ...(h ? { run_hours: Number(h[1]) } : {}) } } }];
  }
  if (/\bdg\b.*test|diesel/.test(s)) return [{ type: "task_completed", summary: "DG weekly test run done", confidence: 0.88, fields: { template_id: "tech_dg", location_id: "DG-YARD" } }];
  const g = s.match(/(\d+)\s*guards?/);
  if (g || /full strength/.test(s)) {
    const shift = /night/.test(s) ? "night" : /afternoon/.test(s) ? "afternoon" : "morning";
    const abs = s.match(/(\d+)\s*(absent|leave)/);
    const vac = /vacant|only/.test(s);
    return [{ type: "attendance_update", summary: `Security ${shift} shift: ${g ? g[1] : 8} guards on duty${abs ? `, ${abs[1]} absent` : ""}${/replacement|reliever/.test(s) ? ", replacement arranged" : ""}`, confidence: vac ? 0.8 : 0.87, fields: { shift, on_duty: g ? Number(g[1]) : 8, absent: abs ? Number(abs[1]) : 0, replacement: /replacement|reliever/.test(s) } }];
  }
  if (/register/.test(s)) return [{ type: "task_completed", summary: "Visitor / vehicle register checked", confidence: 0.88, fields: { template_id: "sec_register", location_id: "MAIN-GATE" } }];
  if (/cctv|stopped at gate/.test(s)) return [];
  if (/\b(received|delivered)\b/.test(s)) {
    const q = s.match(/(\d+)\s*(cans?|packs?|pcs?|kg|bags?)/);
    return [{ type: "consumable_delivery", summary: `Consumables received: ${text.replace(/^received\s*/i, "")}`, confidence: 0.8 + photoBoost, fields: { item: text.replace(/^received\s*/i, "").replace(/\s*from .*$/i, ""), quantity: q ? Number(q[1]) : undefined, acknowledged: th.photos > 0 } }];
  }
  // FM instructions ("pls check", "@Manjunath ...") are coordination chatter, not events.
  if (/pls|please|arrange|check|ensure|@/.test(s)) return [];
  return [{ type: "other", summary: "Unclassified message", confidence: 0.35, fields: { note: text } }];
}

function mockExtractEmail(th: Thread): Candidate[] {
  const subj = th.subject ?? "";
  const body = th.text;
  if (/newsletter/i.test(subj)) return [];
  if (/inspection report/i.test(subj)) {
    const overall = Number(body.match(/Overall score:\s*(\d+)/i)?.[1] ?? 0);
    const scores = [...body.matchAll(/^(.+?):\s*(\d+)\/(\d+)\s*[–-]\s*(.+)$/gm)].map((m) => ({ area: m[1].trim(), score: Number(m[2]), max: Number(m[3]), note: m[4].trim() }));
    return [{ type: "inspection_note", summary: `Inspection report: overall ${overall}% (${scores.filter((s) => s.score <= 6).length} areas at or below 6/10)`, confidence: scores.length >= 5 ? 0.93 : 0.7, fields: { overall_score: overall, scores } }];
  }
  if (/delivery note/i.test(subj)) {
    const items = [...body.matchAll(/^(.+?) – Qty (\d+) (\w+) @ Rs (\d+)/gm)];
    const acked = /\(signed\)/i.test(body);
    return items.map((m) => ({ type: "consumable_delivery" as const, summary: `Delivery note: ${m[1]} × ${m[2]} ${m[3]}${acked ? " (signed)" : " (signature pending)"}`, confidence: 0.9, fields: { item: m[1], quantity: Number(m[2]), acknowledged: acked } }));
  }
  if (/amc visit report/i.test(subj)) return [{ type: "task_completed", summary: "Lift AMC visit logged (all towers)", confidence: 0.86, fields: { template_id: "tech_lift_amc", towers: ["A", "B", "C", "D"], note: body.split("\n").slice(1, 2).join(" ") } }];
  if (/shortfall/i.test(subj)) return [{ type: "attendance_update", summary: "Security agency reports a guard shortfall", confidence: 0.75, fields: { note: body } }];
  if (/approved: (q-\d{4}-\d+)/i.test(subj)) return [{ type: "other", summary: `Client approval for ${subj.match(/Q-\d{4}-\d+/i)![0]}`, confidence: 0.9, fields: { note: `Quotation ${subj.match(/Q-\d{4}-\d+/i)![0]} approved by the AOA by email.` } }];
  if (/weekly site report/i.test(subj)) return [{ type: "other", summary: "FM weekly summary (no new action)", confidence: 0.55, fields: { note: "Narrative summary; matches existing records." } }];
  const c = classifyComplaint(`${subj} ${body}`);
  if (c.category !== "Other" || /complaint|request/i.test(subj))
    return [{ type: "issue_reported", summary: `${c.category} issue raised by email: ${subj.replace(/^complaint:\s*/i, "")}`, confidence: 0.82, fields: { category: c.category, location_id: c.location_id ?? undefined, description: `${subj}. ${body.split("\n").filter((l) => l.trim() && !/^(dear|hello|hi|regards|thanks)/i.test(l.trim()))[0] ?? ""}` } }];
  return [{ type: "other", summary: `Email: ${subj}`, confidence: 0.4, fields: { note: body.slice(0, 200) } }];
}

// ---------- Mapping & applying ----------

const dayOf = (ms: number) => istDate(ms);

export function mapCandidate(w: World, th: Thread, c: Candidate, engine: "mock" | "live"): ExtractedEvent {
  const db = w.db;
  const date = dayOf(th.at);
  const ev: ExtractedEvent = {
    ...baseFields(db, "EXT", w.now, th.channel === "email" ? "email_extracted" : "whatsapp_group_extracted"),
    type: c.type, message_ids: th.message_ids, summary: c.summary, fields: { ...c.fields, date, sender: th.sender }, mapped: {},
    confidence: Math.round(c.confidence * 100) / 100, review_status: c.confidence >= AUTO_ACCEPT ? "auto_accepted" : "needs_review", applied: false, engine,
  };
  const staffId = GROUP_ALIASES[th.sender];
  if (staffId) ev.mapped.staff_id = staffId;
  if (c.type === "task_completed" || (c.type === "meter_reading" && c.fields.template_id)) {
    const tpl = templateById(db, c.fields.template_id!);
    let tasks = db.tasks.filter((t) => t.template_id === c.fields.template_id && t.date === date);
    if (c.fields.towers?.length) tasks = tasks.filter((t) => c.fields.towers!.includes(t.location_id[0]) || c.fields.towers!.includes(t.location_id.slice(-1)));
    if (c.fields.location_id) tasks = tasks.filter((t) => t.location_id === c.fields.location_id);
    if (c.fields.slot_hint && tasks.length > 1) {
      const h = (t: (typeof tasks)[number]) => Number(t.slot.slice(0, 2));
      tasks = tasks.filter((t) => (c.fields.slot_hint === "morning" ? h(t) >= 6 && h(t) < 13 : c.fields.slot_hint === "evening" ? h(t) >= 13 : h(t) < 6));
    }
    ev.mapped.task_ids = tasks.map((t) => t.id);
    if (!tasks.length) {
      ev.note = `No ${tpl?.name ?? c.fields.template_id} task scheduled on ${date}.`;
      ev.confidence = Math.min(ev.confidence, 0.6);
      ev.review_status = "needs_review";
    } else {
      const toUpdate = tasks.filter((t) => t.status !== "done" && t.status !== "done_late");
      ev.note = toUpdate.length
        ? `${toUpdate.length} task(s) not recorded in the workflow (${toUpdate.map((t) => t.status).join(", ")}) will be marked done from this message.`
        : `Already recorded via the WhatsApp workflow (duplicate, no change).`;
      if (c.type === "meter_reading" && c.fields.readings) {
        const t = tasks[0];
        const diffs = Object.entries(c.fields.readings).filter(([k, v]) => t.responses[k] !== undefined && Number(t.responses[k]) !== v);
        if (diffs.length) ev.note += ` Values differ from the workflow log: ${diffs.map(([k, v]) => `${k} ${v} vs ${t.responses[k]}`).join(", ")}.`;
        else if (tasks.some((x) => x.status === "done")) ev.note = "Readings match the workflow log (duplicate, no change).";
      }
    }
  } else if (c.type === "other" && c.fields.ticket_update) {
    const tk = [...db.tickets].reverse().find((t) => t.created_at <= th.at + MIN && th.at - t.created_at < 8 * HOUR);
    if (tk) {
      ev.mapped.ticket_id = tk.id;
      ev.note = `Linked as ${c.fields.ticket_update} update on ${tk.number}.`;
    } else {
      ev.confidence = 0.5;
      ev.review_status = "needs_review";
      ev.note = "No open ticket nearby to link this update to.";
    }
  } else if (c.type === "issue_reported") {
    const loc = c.fields.location_id ?? guessLocation(c.fields.description ?? "") ?? undefined;
    ev.mapped.location_id = loc;
    const tower = loc ? db.locations.find((l) => l.id === loc)?.tower : undefined;
    const near = (t: (typeof db.tickets)[number], h: number) => t.category === c.fields.category && Math.abs(t.created_at - th.at) < h * HOUR;
    const ticketTower = (t: (typeof db.tickets)[number]) => db.locations.find((l) => l.id === t.location_id)?.tower;
    // Same category within 2 h, or same category and same place (tower or area) within 12 h.
    const match =
      db.tickets.find((t) => near(t, 2)) ??
      db.tickets.find((t) => near(t, 12) && (t.location_id === loc || (!!tower && ticketTower(t) === tower) || (!tower && !ticketTower(t))));
    if (match) {
      ev.mapped.ticket_id = match.id;
      ev.confidence = Math.max(ev.confidence, 0.9);
      ev.review_status = "auto_accepted";
      ev.note = `Matches existing ticket ${match.number}; message linked to its timeline.`;
    } else ev.note = `No matching ticket. Accepting will raise a new ${c.fields.category} ticket${loc ? ` at ${locationName(db, loc)}` : ""}.`;
  } else if (c.type === "consumable_delivery") {
    const words = (c.fields.item ?? "").toLowerCase().split(/\W+/).filter((x) => x.length > 3);
    const match = db.consumables.find((x) => x.delivery_date === date && words.some((wd) => x.item.toLowerCase().includes(wd)));
    if (match) {
      ev.mapped.consumable_id = match.id;
      ev.confidence = Math.max(ev.confidence, 0.88);
      ev.review_status = "auto_accepted";
      ev.note = `Matches delivery record (${match.item}, ${match.quantity} ${match.unit}).${match.acknowledgement ? " Acknowledged." : " ⚠ No acknowledgement on record: cannot bill until proof is captured."}${c.fields.acknowledged === false ? " Delivery note says signature pending." : ""}`;
    } else ev.note = "No matching delivery record. Accepting will add it as unacknowledged.";
  } else if (c.type === "attendance_update" && c.fields.shift) {
    const sid = { morning: "sec_m", afternoon: "sec_a", night: "sec_n" }[c.fields.shift];
    const d = c.fields.shift === "night" ? addDays(date, -1) : date;
    const recs = db.attendance.filter((a) => a.date === d && a.shift_id === sid && (a.staff_id.startsWith("guard_") || a.staff_id.startsWith("reliever_")));
    const onDuty = recs.filter((a) => a.status !== "absent").length;
    ev.note = recs.length ? (onDuty === c.fields.on_duty ? `Matches attendance records (${onDuty} on duty).` : `Attendance records show ${onDuty} on duty; message says ${c.fields.on_duty}.`) : "No attendance records for that shift.";
    if (recs.length && onDuty !== c.fields.on_duty) ev.review_status = "needs_review";
  } else if (c.type === "inspection_note") {
    const exists = db.inspections.find((i) => i.date === date && i.source === "email_extracted");
    ev.note = exists ? "Inspection already recorded." : `Accepting creates an inspection record with ${c.fields.scores?.length ?? 0} area scores.`;
  }
  return ev;
}

/** Apply an accepted event to the operational records. Idempotent. */
export function applyEvent(w: World, ev: ExtractedEvent, rawById: Map<string, RawMessage>) {
  if (ev.applied) return;
  const db = w.db;
  const first = rawById.get(ev.message_ids[0]);
  const at = first?.timestamp ?? w.now;
  const f = ev.fields as Candidate["fields"] & { date: string; sender: string };
  if ((ev.type === "task_completed" || ev.type === "meter_reading") && ev.mapped.task_ids?.length) {
    for (const id of ev.mapped.task_ids) {
      const t = db.tasks.find((x) => x.id === id);
      if (!t || t.status === "done" || t.status === "done_late") continue;
      const tpl = templateById(db, t.template_id)!;
      t.status = at <= t.due_at + tpl.grace_min * MIN ? "done" : "done_late";
      t.completed_at = at;
      t.source = ev.source;
      t.extracted_from = ev.message_ids;
      if (f.readings) Object.assign(t.responses, f.readings);
      if (ev.message_ids.length > 1) t.photos.push("/samples/generic.svg");
      t.remarks = `Inferred from ${ev.source === "email_extracted" ? "email" : "WhatsApp group"} message by ${f.sender}`;
      t.updated_at = w.now;
    }
  } else if (ev.type === "issue_reported") {
    if (ev.mapped.ticket_id) {
      const tk = db.tickets.find((x) => x.id === ev.mapped.ticket_id)!;
      if (!tk.linked_message_ids.includes(ev.message_ids[0])) {
        tk.linked_message_ids.push(...ev.message_ids);
        tk.timeline.push({ at: w.now, type: "message_linked", by: "Message intelligence", text: `Linked ${ev.source === "email_extracted" ? "email" : "group message"} from ${f.sender}: "${(first?.subject ?? first?.text ?? "").slice(0, 120)}"`, message_id: ev.message_ids[0] });
        tk.timeline.sort((a, b) => a.at - b.at);
      }
    } else {
      const c = classifyComplaint(f.description ?? "");
      const tk = createTicket(
        { db, now: w.now },
        {
          raised_by: /secretary|srinivas/i.test(f.sender) ? "client" : /committee|kavitha/i.test(f.sender) ? "resident_committee" : "internal",
          raised_by_name: f.sender, channel: ev.source === "email_extracted" ? "email" : "whatsapp_group", category: f.category ?? c.category, priority: c.priority,
          location_id: ev.mapped.location_id ?? "PRJ", description: f.description ?? ev.summary, source: ev.source, linked_message_ids: ev.message_ids,
          classification: { by: ev.engine, confidence: ev.confidence },
        },
        { notify: true },
      );
      tk.timeline[0].text += ` (extracted from message sent ${new Date(at + 330 * 60000).toISOString().slice(0, 16).replace("T", " ")})`;
      ev.mapped.ticket_id = tk.id;
    }
  } else if (ev.type === "other" && f.ticket_update && ev.mapped.ticket_id) {
    const tk = db.tickets.find((x) => x.id === ev.mapped.ticket_id)!;
    if (!tk.linked_message_ids.includes(ev.message_ids[0])) {
      tk.linked_message_ids.push(...ev.message_ids);
      tk.timeline.push({ at, type: "message_linked", by: f.sender, text: `Group message: "${first?.text ?? ""}"`, message_id: ev.message_ids[0] });
      tk.timeline.sort((a, b) => a.at - b.at);
    }
  } else if (ev.type === "consumable_delivery" && !ev.mapped.consumable_id) {
    const c = {
      ...baseFields(db, "CON", at, ev.source), item: f.item ?? "Unspecified item", quantity: f.quantity ?? 1, unit: "unit", rate: 0, delivery_date: f.date,
      vendor: "From message", acknowledgement: null, billed: false, source_ref: ev.message_ids[0],
    };
    db.consumables.push(c);
    ev.mapped.consumable_id = c.id;
  } else if (ev.type === "inspection_note" && f.scores?.length) {
    const ins: Inspection = {
      ...baseFields(db, "INS", at, "email_extracted"), inspector: "Ramesh Kulkarni", date: f.date, location_id: "PRJ", overall_score: f.overall_score ?? 0, scores: f.scores,
      observations: f.scores.filter((s) => s.score <= 6).map((s) => `${s.area}: ${s.note}`), photos: [], source_email_id: ev.message_ids[0],
    };
    db.inspections.push(ins);
    ev.mapped.inspection_id = ins.id;
  }
  ev.applied = true;
  ev.updated_at = w.now;
}

export function importStats(db: DB) {
  const ex = db.extracted;
  return {
    raw: db.rawMessages.length,
    events: ex.length,
    auto: ex.filter((e) => e.review_status === "auto_accepted").length,
    review: ex.filter((e) => e.review_status === "needs_review").length,
    accepted: ex.filter((e) => e.review_status === "accepted").length,
    rejected: ex.filter((e) => e.review_status === "rejected").length,
    inferred: db.tasks.filter((t) => t.source === "whatsapp_group_extracted" || t.source === "email_extracted").length,
    linked: ex.filter((e) => e.mapped.ticket_id).length,
  };
}

export { nid, staffName };
