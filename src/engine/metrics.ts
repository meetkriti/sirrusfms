// All dashboard numbers are computed here, in code, from the records. The LLM never computes them.
import type { DB, ServiceLineId, TaskInstance } from "../types";
import { config } from "../config";
import { addDays, dateRange, istDate, MIN } from "../lib/time";
import { locationById, templateById } from "./core";
import { isBreached } from "./tickets";

export interface TaskFilter {
  from: string;
  to: string;
  serviceLine?: ServiceLineId | "all";
  tower?: string | "all";
  shift?: "morning" | "afternoon" | "night" | "all";
  templateId?: string;
}

export function shiftOfSlot(slot: string): "morning" | "afternoon" | "night" {
  const h = Number(slot.slice(0, 2));
  if (h >= 6 && h < 14) return "morning";
  if (h >= 14 && h < 22) return "afternoon";
  return "night";
}

export function filterTasks(db: DB, f: TaskFilter): TaskInstance[] {
  return db.tasks.filter((t) => {
    if (t.date < f.from || t.date > f.to) return false;
    if (f.templateId && t.template_id !== f.templateId) return false;
    const tpl = templateById(db, t.template_id);
    if (f.serviceLine && f.serviceLine !== "all" && tpl?.service_line !== f.serviceLine) return false;
    if (f.tower && f.tower !== "all" && locationById(db, t.location_id)?.tower !== f.tower) return false;
    if (f.shift && f.shift !== "all" && shiftOfSlot(t.slot) !== f.shift) return false;
    return true;
  });
}

/** A task is "settled" once completed, missed or past its due time + grace. */
export function isSettled(db: DB, t: TaskInstance, now: number) {
  if (t.status === "done" || t.status === "done_late" || t.status === "missed" || t.status === "not_applicable") return true;
  const tpl = templateById(db, t.template_id);
  return now >= t.due_at + (tpl?.grace_min ?? 30) * MIN;
}

export interface Stats {
  total: number;
  done: number;
  late: number;
  missed: number;
  pending: number;
  compliance: number | null; // (done + late) / settled
  onTime: number | null; // done / (done + late)
}

export function stats(db: DB, tasks: TaskInstance[], now: number): Stats {
  let done = 0, late = 0, missed = 0, pending = 0;
  for (const t of tasks) {
    if (t.status === "done") done++;
    else if (t.status === "done_late") late++;
    else if (t.status === "missed") missed++;
    else if (t.status !== "not_applicable") pending++;
  }
  const settled = done + late + missed;
  return { total: tasks.length, done, late, missed, pending, compliance: settled ? (done + late) / settled : null, onTime: done + late ? done / (done + late) : null };
}

export type CellState = "done" | "late" | "missed" | "pending" | "na";

export function heatmapRows(db: DB, f: TaskFilter) {
  const tasks = filterTasks(db, f);
  const days = dateRange(f.from, f.to);
  const rows = new Map<string, { key: string; template_id: string; location_id: string; label: string; cells: Record<string, TaskInstance[]> }>();
  for (const t of tasks) {
    const key = `${t.template_id}|${t.location_id}`;
    if (!rows.has(key)) {
      const tpl = templateById(db, t.template_id)!;
      const loc = locationById(db, t.location_id)!;
      rows.set(key, { key, template_id: t.template_id, location_id: t.location_id, label: loc.kind === "project" ? tpl.name : `${tpl.name} · ${loc.name.replace(" staircase", "").replace(" lift lobby", "")}`, cells: {} });
    }
    const r = rows.get(key)!;
    (r.cells[t.date] ??= []).push(t);
  }
  const order = db.templates.map((t) => t.id);
  return {
    days,
    rows: [...rows.values()].sort((a, b) => order.indexOf(a.template_id) - order.indexOf(b.template_id) || a.location_id.localeCompare(b.location_id)),
  };
}

export function cellState(cell: TaskInstance[] | undefined): CellState {
  if (!cell || !cell.length) return "na";
  if (cell.some((t) => t.status === "missed")) return "missed";
  if (cell.some((t) => t.status === "scheduled" || t.status === "sent" || t.status === "in_progress")) return "pending";
  if (cell.some((t) => t.status === "done_late")) return "late";
  return "done";
}

// ---------- Security attendance ----------

export interface ShiftHeadcount {
  date: string;
  shift_id: string;
  present: number;
  replacements: number;
  approvedReplacements: number;
  halfDays: number;
  absent: number;
  onDuty: number; // present + replacements + half-days
  billable: number;
  contracted: number;
  verified: boolean;
}

export function securityHeadcount(db: DB, from: string, to: string): ShiftHeadcount[] {
  const rules = config.billing.security;
  const out = new Map<string, ShiftHeadcount>();
  for (const a of db.attendance) {
    if (a.service_line !== "security" || a.date < from || a.date > to) continue;
    if (!a.staff_id.startsWith("guard_") && !a.staff_id.startsWith("reliever_")) continue;
    const k = `${a.date}|${a.shift_id}`;
    const h = out.get(k) ?? { date: a.date, shift_id: a.shift_id, present: 0, replacements: 0, approvedReplacements: 0, halfDays: 0, absent: 0, onDuty: 0, billable: 0, contracted: rules.contracted_guards_per_shift, verified: true };
    if (a.status === "present") h.present++;
    else if (a.status === "replacement") {
      h.replacements++;
      if (a.approved) h.approvedReplacements++;
    } else if (a.status === "half_day") h.halfDays++;
    else h.absent++;
    if (!a.verified) h.verified = false;
    out.set(k, h);
  }
  for (const h of out.values()) {
    h.onDuty = h.present + h.replacements + h.halfDays;
    h.billable =
      h.present +
      h.halfDays * rules.half_day_factor +
      (rules.count_approved_replacements ? h.approvedReplacements : 0) +
      (rules.count_unapproved_replacements ? h.replacements - h.approvedReplacements : 0);
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date) || a.shift_id.localeCompare(b.shift_id));
}

export function securityDays(db: DB, from: string, to: string) {
  const byDay = new Map<string, { date: string; onDuty: number; billable: number; contracted: number; shifts: ShiftHeadcount[]; below: boolean; verified: boolean }>();
  for (const h of securityHeadcount(db, from, to)) {
    const d = byDay.get(h.date) ?? { date: h.date, onDuty: 0, billable: 0, contracted: 0, shifts: [], below: false, verified: true };
    d.onDuty += h.onDuty;
    d.billable += h.billable;
    d.contracted += h.contracted;
    d.shifts.push(h);
    if (h.onDuty < h.contracted) d.below = true;
    if (!h.verified) d.verified = false;
    byDay.set(h.date, d);
  }
  return [...byDay.values()];
}

export function staffAttendance(db: DB, date: string) {
  const out: Record<string, { present: number; total: number }> = {};
  for (const a of db.attendance) {
    if (a.date !== date || a.service_line === "security") continue;
    const o = (out[a.service_line] ??= { present: 0, total: 0 });
    o.total++;
    if (a.status === "present" || a.status === "replacement") o.present++;
  }
  return out;
}

// ---------- Tickets ----------

export function ticketsInRange(db: DB, fromMs: number, toMs: number) {
  return db.tickets.filter((t) => t.created_at >= fromMs && t.created_at <= toMs);
}

export function slaBreachesInMonth(db: DB, month: string) {
  return db.tickets.filter((t) => istDate(t.created_at).startsWith(month) && isBreached(t));
}

export function trend(db: DB, serviceLine: ServiceLineId, days: number, today: string, now: number) {
  return dateRange(addDays(today, -(days - 1)), today).map((d) => {
    const s = stats(db, filterTasks(db, { from: d, to: d, serviceLine }), now);
    return { date: d, value: s.compliance === null ? null : Math.round(s.compliance * 1000) / 10 };
  });
}
