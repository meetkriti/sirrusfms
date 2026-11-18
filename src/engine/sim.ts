// Simulation clock driven scheduler: prompts, simulated staff replies, reminders,
// alerts, shift-start attendance checks and ticket escalation.
import type { AttendanceRecord, DB, TaskInstance } from "../types";
import { config } from "../config";
import { addDays, istAt, istDate, MIN } from "../lib/time";
import { hashStr, makeRng, type Rng } from "../lib/rng";
import { baseFields, taskTitle, templateById, type World } from "./core";
import { sendReminder, sendTaskPrompt } from "./bot";
import { completeTask, graceFor, isOpen, markMissed, PHOTO_FOR, plausibleResponses, tasksForDate } from "./tasks";
import { ticketTick } from "./tickets";
import { raiseAlert, rule } from "./alerts";
import { SimulatedAdapter } from "./messaging";

const SHORT_REPLIES = ["Done sir", "ho gaya sir", "done", "Completed 👍", "aaytu sir", "Done ✅", "ok done"];

/** Decide (deterministically) how background staff will respond to a live task. */
export function planAutopilot(task: TaskInstance, rng: Rng, baseRate = 0.92) {
  const r = rng.next();
  if (r < baseRate) return { reply_at: task.due_at - rng.int(8, 50) * MIN, outcome: "done" as const };
  if (r < baseRate + 0.05) return { reply_at: task.due_at + rng.int(5, 20) * MIN, outcome: "late" as const };
  return { reply_at: task.due_at, outcome: "missed" as const };
}

export function ensureDay(db: DB, date: string) {
  if (db.tasks.some((t) => t.date === date)) return;
  const rng = makeRng(hashStr(`day:${date}`));
  const fresh = tasksForDate(db, date);
  for (const t of fresh) t.autopilot = planAutopilot(t, rng);
  db.tasks.push(...fresh);
  // Plan security attendance for the new day's shifts (full strength by default).
  for (const s of db.shifts.filter((x) => x.service_line === "security")) {
    db.plannedAttendance.push({ date, shift_id: s.id, start_at: istAt(date, s.start), guards_present: 8, replacements: rng.chance(0.3) ? 1 : 0, applied: false });
  }
}

function autopilotReply(w: World, task: TaskInstance) {
  const db = w.db;
  const tpl = templateById(db, task.template_id)!;
  const rng = makeRng(hashStr(task.id));
  const wa = new SimulatedAdapter(w);
  const photo = tpl.photo_required ? PHOTO_FOR[tpl.id] ?? "/samples/generic.svg" : undefined;
  const { responses } = plausibleResponses(tpl, rng);
  if (tpl.id === "sec_handover") {
    const plan = db.plannedAttendance.find((p) => p.date === task.date && p.start_at <= task.due_at && p.start_at > task.due_at - 60 * MIN);
    if (plan) responses.guards = plan.guards_present;
  }
  let text = rng.pick(SHORT_REPLIES);
  if (tpl.mode === "stepwise") {
    text = tpl.items
      .filter((i) => i.type === "numeric_reading")
      .map((i) => `${i.label.split(" (")[0]} ${responses[i.id]}${i.unit && i.unit !== "%" ? " " + i.unit : i.unit ?? ""}`)
      .join(", ");
    text = text || rng.pick(SHORT_REPLIES);
  }
  wa.receive(task.assignee_id, { text, photo });
  completeTask(w, task, { source: "whatsapp_workflow", photo, responses });
  wa.sendMessage(task.assignee_id, `✅ Recorded: ${taskTitle(db, task.template_id, task.location_id)} marked ${task.status === "done_late" ? "done (late)" : "done"}.`, { task_id: task.id });
}

function applyShiftStart(w: World, p: DB["plannedAttendance"][number]) {
  const db = w.db;
  p.applied = true;
  const shiftIdx = db.shifts.filter((s) => s.service_line === "security").findIndex((s) => s.id === p.shift_id);
  const guards = db.staff.filter((s) => s.id.startsWith("guard_") && s.shift === p.shift_id);
  const relievers = db.staff.filter((s) => s.id.startsWith("reliever_"));
  const contracted = config.billing.security.contracted_guards_per_shift;
  const regularsPresent = p.guards_present - p.replacements;
  const recs: AttendanceRecord[] = [];
  guards.slice(0, contracted).forEach((g, i) => {
    const present = i < regularsPresent;
    recs.push({ ...baseFields(db, "ATT", p.start_at, "whatsapp_workflow"), staff_id: g.id, date: p.date, shift_id: p.shift_id, service_line: "security", post: i + 1, status: present ? "present" : "absent", verified: true });
    if (!present && i - regularsPresent < p.replacements) {
      const r = relievers[(i + shiftIdx) % relievers.length];
      recs.push({ ...baseFields(db, "ATT", p.start_at, "whatsapp_workflow"), staff_id: r.id, date: p.date, shift_id: p.shift_id, service_line: "security", post: i + 1, status: "replacement", replacement_for: g.id, approved: true, verified: true });
    }
  });
  db.attendance.push(...recs);
  const r5 = rule("R5");
  if (r5?.enabled && p.guards_present < contracted) {
    const shift = db.shifts.find((s) => s.id === p.shift_id)!;
    raiseAlert(
      w,
      {
        rule_id: "R5",
        severity: r5.severity,
        title: `Security headcount ${p.guards_present}/${contracted} at ${shift.name} shift start`,
        reason: `Rule R5 fired: at ${shift.start} the ${shift.name} shift has ${p.guards_present} guards on duty against ${contracted} contracted (${contracted - p.guards_present} post(s) uncovered, no approved replacement). Billing impact: billable man-days for ${p.date} will be ${contracted - p.guards_present} short for this shift.`,
        targets: r5.notify,
        entity: { type: "attendance", id: `${p.date}:${p.shift_id}` },
        billing_impact: r5.billing_impact,
      },
      { serviceLine: "security", whatsapp: r5.send_whatsapp },
    );
  }
}

export function tickMinute(w: World) {
  const db = w.db;
  const now = w.now;
  const today = istDate(now);
  ensureDay(db, today);
  ensureDay(db, addDays(today, 1));
  const yesterday = addDays(today, -1);
  const r1 = rule("R1");
  for (const task of db.tasks) {
    if (task.date < yesterday || !isOpen(task)) continue;
    if (task.status === "scheduled" && task.send_at <= now) sendTaskPrompt(w, task);
    if (task.autopilot && task.autopilot.outcome !== "missed" && task.autopilot.reply_at <= now && isOpen(task)) autopilotReply(w, task);
    if (!isOpen(task)) continue;
    const tpl = templateById(db, task.template_id)!;
    if (r1?.enabled && !task.reminded && task.status === "sent" && now >= task.due_at + (r1.offset_min ?? 0) * MIN) {
      task.reminded = true;
      if (r1.send_whatsapp) sendReminder(w, task);
      raiseAlert(w, {
        rule_id: "R1",
        severity: r1.severity,
        title: `Reminder sent: ${taskTitle(db, task.template_id, task.location_id)}`,
        reason: `Rule R1 fired: not started by the due time. A WhatsApp reminder was sent to the assignee.`,
        targets: r1.notify,
        entity: { type: "task", id: task.id },
      });
    }
    if (now >= task.due_at + graceFor(tpl) * MIN) markMissed(w, task);
  }
  for (const p of db.plannedAttendance) if (!p.applied && p.start_at <= now) applyShiftStart(w, p);
  ticketTick(w);
}

/** Advance the simulation clock minute by minute, processing every event on the way. */
export function advanceTo(w: World, target: number) {
  const start = Math.floor(w.now / MIN) * MIN;
  w.now = start;
  while (w.now + MIN <= target) {
    w.now += MIN;
    tickMinute(w);
  }
  w.now = Math.max(w.now, target);
}
