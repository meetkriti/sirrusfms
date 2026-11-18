import type { ChecklistTemplate, DB, Source, TaskInstance } from "../types";
import { addDays, DAY, istAt, MIN, weekday } from "../lib/time";
import { baseFields, locationById, taskTitle, templateById, type World } from "./core";
import { raiseAlert, rule } from "./alerts";
import type { Rng } from "../lib/rng";

export const OPEN_STATUSES = new Set(["scheduled", "sent", "in_progress"]);
export const isOpen = (t: TaskInstance) => OPEN_STATUSES.has(t.status);
export const isDone = (t: TaskInstance) => t.status === "done" || t.status === "done_late";

export function occursOn(t: ChecklistTemplate, date: string): boolean {
  switch (t.frequency) {
    case "weekly":
      return weekday(date) === t.weekday;
    case "monthly":
      return Number(date.slice(8, 10)) === t.day_of_month;
    case "quarterly": {
      const diff = Math.round((istAt(date, "12:00") - istAt(t.anchor_date!, "12:00")) / DAY);
      const n = t.every_days ?? 91;
      return ((diff % n) + n) % n === 0;
    }
    default:
      return true;
  }
}

export const PHOTO_FOR: Record<string, string> = {
  hk_staircase: "/samples/staircase.svg",
  hk_lift_lobby: "/samples/lift_lobby.svg",
  hk_basement: "/samples/basement.svg",
  hk_garbage: "/samples/garbage.svg",
  hk_washroom: "/samples/washroom.svg",
  sec_patrol: "/samples/patrol.svg",
  tech_dg: "/samples/dg_panel.svg",
  tech_fire: "/samples/extinguisher.svg",
  stp_log: "/samples/stp_outlet.svg",
  land_mowing: "/samples/garden.svg",
  pest_control: "/samples/pest_report.svg",
  water_tank: "/samples/tank.svg",
};

/** Create (status "scheduled") task instances for every template slot due on `date`. */
export function tasksForDate(db: DB, date: string, source: Source = "seed"): TaskInstance[] {
  const out: TaskInstance[] = [];
  for (const t of db.templates) {
    if (!occursOn(t, date)) continue;
    for (const loc of t.locations) {
      for (const slot of t.due_times) {
        const due = istAt(date, slot);
        const assignee = t.assignee_by_time?.[slot] ?? t.assignee ?? "sup_hk";
        out.push({
          ...baseFields(db, "TSK", due - t.send_offset_min * MIN, source),
          template_id: t.id,
          location_id: loc,
          date,
          slot,
          assignee_id: assignee,
          send_at: due - t.send_offset_min * MIN,
          due_at: due,
          status: "scheduled",
          responses: {},
          photos: [],
        });
      }
    }
  }
  return out;
}

/** Plausible checklist responses for simulated (autopilot / historical) completions. */
export function plausibleResponses(t: ChecklistTemplate, rng: Rng, outOfRangeChance = 0): { responses: TaskInstance["responses"]; oor: string[] } {
  const responses: TaskInstance["responses"] = {};
  const oor: string[] = [];
  for (const it of t.items) {
    if (it.type === "yes_no") responses[it.id] = true;
    else if (it.type === "numeric_reading") {
      const lo = it.min ?? 0;
      const hi = it.max ?? lo + 10;
      let v = lo === hi ? lo : lo + (hi - lo) * rng.float(0.25, 0.75);
      if (outOfRangeChance && rng.chance(outOfRangeChance)) {
        v = hi + (hi - lo || 1) * 0.08;
        oor.push(it.id);
      }
      const decimals = hi - lo < 10 ? 1 : 0;
      responses[it.id] = Number(v.toFixed(decimals));
    } else if (it.type === "text") responses[it.id] = "All ok";
  }
  return { responses, oor };
}

export function completeTask(w: World, task: TaskInstance, opts: { source: Source; photo?: string; remarks?: string; responses?: TaskInstance["responses"] }) {
  const late = w.now > task.due_at;
  const t = templateById(w.db, task.template_id)!;
  task.status = late ? "done_late" : "done";
  task.completed_at = w.now;
  task.updated_at = w.now;
  task.source = opts.source;
  if (opts.photo) task.photos.push(opts.photo);
  if (opts.remarks) task.remarks = opts.remarks;
  if (opts.responses) Object.assign(task.responses, opts.responses);
  for (const it of t.items) if (it.type === "yes_no" && task.responses[it.id] === undefined) task.responses[it.id] = true;
  // Close open alerts for this task.
  for (const a of w.db.alerts) if (a.entity.type === "task" && a.entity.id === task.id && a.status !== "resolved" && a.rule_id !== "R4") {
    a.status = "resolved";
    a.notes.push({ at: w.now, by: "system", text: `Task completed${late ? " late" : ""} at ${new Date(w.now).toISOString()}` });
  }
}

export function missesInWindow(db: DB, task: TaskInstance, windowDays: number): TaskInstance[] {
  const from = addDays(task.date, -(windowDays - 1));
  return db.tasks.filter(
    (x) => x.template_id === task.template_id && x.location_id === task.location_id && x.status === "missed" && x.date >= from && x.date <= task.date,
  );
}

/** R2 + R3: mark a task missed and raise the configured alerts. */
export function markMissed(w: World, task: TaskInstance) {
  const db = w.db;
  task.status = "missed";
  task.updated_at = w.now;
  const t = templateById(db, task.template_id)!;
  const title = taskTitle(db, task.template_id, task.location_id);
  const r2 = rule("R2");
  if (r2?.enabled) {
    raiseAlert(
      w,
      {
        rule_id: "R2",
        severity: r2.severity,
        title: `Missed: ${title}`,
        reason: `Rule R2 fired: "${title}" was due at ${fmt(task.due_at)} and was not completed within the ${graceFor(t)} min grace period. Assigned to ${staffLabel(db, task.assignee_id)}.${task.reported_not_done ? ` Staff replied "not done"${task.remarks ? `: ${task.remarks}` : ""}.` : ""}`,
        targets: r2.notify,
        entity: { type: "task", id: task.id },
      },
      { serviceLine: t.service_line, assignee: task.assignee_id, whatsapp: r2.send_whatsapp },
    );
  }
  const r3 = rule("R3");
  if (r3?.enabled) {
    const misses = missesInWindow(db, task, r3.window_days ?? 7);
    const already = db.alerts.some((a) => a.rule_id === "R3" && a.entity.id === task.id);
    if (misses.length >= (r3.count ?? 3) && !already) {
      const loc = locationById(db, task.location_id)?.name ?? task.location_id;
      raiseAlert(
        w,
        {
          rule_id: "R3",
          severity: r3.severity,
          title: `Recurring miss: ${title}`,
          reason: `Rule R3 fired: "${t.name}" at ${loc} has been missed ${misses.length} times in the last ${r3.window_days} days (${misses
            .map((m) => m.date.slice(8, 10) + "/" + m.date.slice(5, 7))
            .join(", ")}). Threshold is ${r3.count}. Escalated for a staffing or process review.`,
          targets: r3.notify,
          entity: { type: "task", id: task.id },
          recurring: true,
        },
        { serviceLine: t.service_line, assignee: task.assignee_id, whatsapp: r3.send_whatsapp },
      );
    }
  }
}

export function graceFor(t: ChecklistTemplate): number {
  const r2 = rule("R2");
  if (r2 && !r2.use_template_grace && r2.grace_override_min != null) return r2.grace_override_min;
  return t.grace_min;
}

function fmt(ms: number) {
  const d = new Date(ms + 330 * 60000);
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}
function staffLabel(db: DB, id: string) {
  const s = db.staff.find((x) => x.id === id);
  return s ? `${s.name} (${s.title})` : id;
}
