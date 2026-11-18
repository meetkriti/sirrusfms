// M8: billing inputs for the monthly invoice draft. Rates are fake sample rates from config/billing_rules.json.
import type { DB } from "../types";
import { config } from "../config";
import { daysInMonth, monthDays, monthOf } from "../lib/time";
import { securityDays, securityHeadcount } from "./metrics";

export function securityBilling(db: DB, month: string) {
  const r = config.billing.security;
  const days = monthDays(month);
  const shifts = securityHeadcount(db, days[0], days[days.length - 1]);
  const perShift = ["sec_m", "sec_a", "sec_n"].map((sid) => {
    const xs = shifts.filter((s) => s.shift_id === sid);
    return {
      shift_id: sid,
      contracted: xs.length * r.contracted_guards_per_shift,
      present: xs.reduce((s, x) => s + x.present, 0),
      replacements: xs.reduce((s, x) => s + x.approvedReplacements, 0),
      halfDays: xs.reduce((s, x) => s + x.halfDays, 0),
      billable: xs.reduce((s, x) => s + x.billable, 0),
      daysRecorded: xs.length,
    };
  });
  const dayRows = securityDays(db, days[0], days[days.length - 1]);
  const guardBillable = perShift.reduce((s, x) => s + x.billable, 0);
  const guardContracted = perShift.reduce((s, x) => s + x.contracted, 0);
  const supDays = db.attendance.filter((a) => a.service_line === "security" && monthOf(a.date) === month && /^(sup_sec|sec_sup)/.test(a.staff_id) && a.status === "present").length;
  return {
    month,
    perShift,
    days: dayRows,
    shortfallDays: dayRows.filter((d) => d.below),
    unverifiedDays: dayRows.filter((d) => !d.verified),
    guardBillable,
    guardContracted,
    guardShortfall: guardContracted - guardBillable,
    supervisorBillable: supDays,
    supervisorContracted: daysInMonth(month) * 3,
    amount: guardBillable * r.guard_rate_per_man_day + supDays * r.supervisor_rate_per_man_day,
    complete: dayRows.length === daysInMonth(month),
  };
}

export function consumablesBilling(db: DB, month: string) {
  const items = db.consumables.filter((c) => monthOf(c.delivery_date) === month);
  const billable = items.filter((c) => !config.billing.consumables.require_acknowledgement || c.acknowledgement);
  const blocked = items.filter((c) => config.billing.consumables.require_acknowledgement && !c.acknowledgement);
  const value = (xs: typeof items) => xs.reduce((s, c) => s + c.quantity * c.rate, 0);
  return { items, billable, blocked, amount: value(billable), blockedAmount: value(blocked) };
}

export function projectWorkBilling(db: DB, month: string) {
  const rows: {
    quotation: (typeof db.quotations)[number];
    line: (typeof db.quotations)[number]["lines"][number];
    lineIndex: number;
    delivered: number;
    variance: number;
    amount: number;
    executions: (typeof db.executions)[number][];
    billable: boolean;
    note: string;
  }[] = [];
  for (const q of db.quotations) {
    q.lines.forEach((line, i) => {
      const ex = db.executions.filter((e) => e.quotation_id === q.id && e.line_index === i && monthOf(e.date) === month);
      if (!ex.length && q.month !== month) return;
      const delivered = ex.reduce((s, e) => s + e.quantity_delivered, 0);
      const approved = q.approval_status === "approved";
      const billable = approved || !config.billing.project_work.only_approved_quotations;
      const missingProof = ex.filter((e) => !e.proof_photo).length;
      rows.push({
        quotation: q, line, lineIndex: i, delivered, variance: delivered - line.quantity, amount: billable ? delivered * line.rate : 0, executions: ex, billable,
        note: !approved ? `Quotation ${q.approval_status}; not billable until approved` : missingProof ? `${missingProof} execution(s) without proof photo` : delivered < line.quantity ? `Delivered ${line.quantity - delivered} ${line.unit} less than quoted` : "As quoted",
      });
    });
  }
  return { rows, amount: rows.reduce((s, r) => s + r.amount, 0) };
}

export function invoiceDraft(db: DB, month: string) {
  const sec = securityBilling(db, month);
  const con = consumablesBilling(db, month);
  const pw = projectWorkBilling(db, month);
  const r = config.billing.security;
  const sections = [
    { title: "Manpower Services (fixed monthly as per agreement)", lines: config.billing.fixed_monthly.map((f) => ({ description: f.label, qty: 1, unit: "month", rate: f.amount, amount: f.amount })) },
    {
      title: "Security (billable man-days × rate)",
      lines: [
        { description: `Security guards: ${sec.guardBillable} billable man-days (contracted ${sec.guardContracted})`, qty: sec.guardBillable, unit: "man-days", rate: r.guard_rate_per_man_day, amount: sec.guardBillable * r.guard_rate_per_man_day },
        { description: `Shift supervisors: ${sec.supervisorBillable} man-days`, qty: sec.supervisorBillable, unit: "man-days", rate: r.supervisor_rate_per_man_day, amount: sec.supervisorBillable * r.supervisor_rate_per_man_day },
      ],
    },
    { title: "Consumables (acknowledged deliveries only)", lines: con.billable.map((c) => ({ description: `${c.item} (${c.delivery_date.split("-").reverse().join("-")})`, qty: c.quantity, unit: c.unit, rate: c.rate, amount: c.quantity * c.rate })) },
    { title: "Project Work (against approved quotations)", lines: pw.rows.filter((x) => x.billable && x.delivered > 0).map((x) => ({ description: `${x.quotation.number}: ${x.line.description}`, qty: x.delivered, unit: x.line.unit, rate: x.line.rate, amount: x.amount })) },
  ];
  const total = sections.reduce((s, sec) => s + sec.lines.reduce((a, l) => a + l.amount, 0), 0);
  return { month, sections, total, sec, con, pw };
}

export function billingReadiness(db: DB, month: string) {
  const sec = securityBilling(db, month);
  const con = consumablesBilling(db, month);
  const pw = projectWorkBilling(db, month);
  const blockers: { kind: string; text: string; route: string }[] = [];
  con.blocked.forEach((c) => blockers.push({ kind: "Unacknowledged delivery", text: `${c.item}, ${c.quantity} ${c.unit} on ${c.delivery_date.split("-").reverse().join("-")}: cannot bill, proof missing`, route: `/billing?month=${month}#consumables` }));
  sec.unverifiedDays.forEach((d) => blockers.push({ kind: "Attendance unverified", text: `Security attendance on ${d.date.split("-").reverse().join("-")} not verified by the supervisor`, route: `/billing?month=${month}#security` }));
  pw.rows.filter((r) => r.executions.some((e) => !e.proof_photo)).forEach((r) => blockers.push({ kind: "Project work proof missing", text: `${r.quotation.number}: execution without proof photo`, route: `/billing?month=${month}#project` }));
  if (!sec.complete) blockers.push({ kind: "Month in progress", text: `Attendance recorded for ${sec.days.length} of ${daysInMonth(month)} days`, route: `/billing?month=${month}#security` });
  return blockers;
}
