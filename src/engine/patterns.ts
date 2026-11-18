// M9: pattern analysis. Every number in an insight is computed here from records.
import type { DB, TicketCategory } from "../types";
import { addDays, istAt, istDate, weekday, WEEKDAYS, HOUR } from "../lib/time";
import { inr } from "../lib/format";
import { locationById, locationName, templateById } from "./core";
import { LEVEL_RANK } from "./tickets";
import { consumablesBilling, securityBilling } from "./billing";
import { securityDays } from "./metrics";

export interface Evidence {
  label: string;
  route: string;
}
export interface Insight {
  id: string;
  title: string;
  text: string;
  numbers: Record<string, number | string>;
  evidence: Evidence[];
  severity: "high" | "medium" | "low";
  suggestion: string;
}

export function ticketMatrix(db: DB, fromMs: number, toMs: number) {
  const tickets = db.tickets.filter((t) => t.created_at >= fromMs && t.created_at <= toMs);
  const area = (id: string) => {
    const l = locationById(db, id);
    return l?.tower ? `Tower ${l.tower}` : l?.name ?? id;
  };
  const cats = [...new Set(tickets.map((t) => t.category))].sort() as TicketCategory[];
  const areas = [...new Set(tickets.map((t) => area(t.location_id)))].sort();
  const cell = (a: string, c: string) => tickets.filter((t) => area(t.location_id) === a && t.category === c);
  const ranked = areas
    .flatMap((a) => cats.map((c) => ({ area: a, category: c, tickets: cell(a, c) })))
    .filter((x) => x.tickets.length >= 2)
    .sort((x, y) => y.tickets.length - x.tickets.length);
  return { cats, areas, cell, ranked, tickets };
}

export function missByWeekday(db: DB, from: string, to: string) {
  const rows = new Map<string, { label: string; template_id: string; location_id: string; byDay: { total: number; missed: number }[] }>();
  for (const t of db.tasks) {
    if (t.date < from || t.date > to) continue;
    if (!["done", "done_late", "missed"].includes(t.status)) continue;
    const k = `${t.template_id}|${t.location_id}`;
    if (!rows.has(k)) rows.set(k, { label: `${templateById(db, t.template_id)?.name} · ${locationName(db, t.location_id)}`, template_id: t.template_id, location_id: t.location_id, byDay: Array.from({ length: 7 }, () => ({ total: 0, missed: 0 })) });
    const r = rows.get(k)!.byDay[weekday(t.date)];
    r.total++;
    if (t.status === "missed") r.missed++;
  }
  return [...rows.values()]
    .map((r) => ({ ...r, worst: Math.max(...r.byDay.map((d) => (d.total ? d.missed / d.total : 0))) }))
    .sort((a, b) => b.worst - a.worst);
}

export function resolutionStats(db: DB, fromMs: number, toMs: number) {
  const done = db.tickets.filter((t) => t.created_at >= fromMs && t.created_at <= toMs && t.resolved_at);
  const by = <K extends string>(key: (t: (typeof done)[number]) => K) => {
    const m = new Map<K, number[]>();
    done.forEach((t) => m.set(key(t), [...(m.get(key(t)) ?? []), (t.resolved_at! - t.created_at) / HOUR]));
    return [...m.entries()].map(([k, xs]) => ({ key: k, count: xs.length, avgHours: xs.reduce((s, x) => s + x, 0) / xs.length })).sort((a, b) => b.avgHours - a.avgHours);
  };
  return { byCategory: by((t) => t.category), byLevel: by((t) => t.level) };
}

export function computeInsights(db: DB, now: number): Insight[] {
  const today = istDate(now);
  const from = addDays(today, -89);
  const fromMs = istAt(from);
  const out: Insight[] = [];

  // 1. Tower B lift.
  const lift = db.tickets.filter((t) => t.category === "Lift" && locationById(db, t.location_id)?.tower === "B" && t.created_at >= fromMs);
  if (lift.length >= 2) {
    const l3 = lift.filter((t) => LEVEL_RANK[t.level] >= 3).length;
    const avg = lift.filter((t) => t.resolved_at).reduce((s, t) => s + (t.resolved_at! - t.created_at) / HOUR, 0) / Math.max(1, lift.filter((t) => t.resolved_at).length);
    out.push({
      id: "lift-b", severity: "high", title: "Tower B lift breakdowns keep recurring",
      text: `Tower B lift: ${lift.length} breakdown tickets in 90 days, ${l3 === lift.length ? "all" : l3} escalated to Zonal level (L3) or above. Average time to resolve ${avg.toFixed(1)} h.`,
      numbers: { tickets: lift.length, escalated_l3: l3, avg_hours: Number(avg.toFixed(1)) },
      suggestion: "Review with the lift AMC vendor: root-cause report, controller board replacement, and a stand-by technician SLA.",
      evidence: lift.map((t) => ({ label: `${t.number} (${istDate(t.created_at).split("-").reverse().join("-")})`, route: `/tickets/${t.id}` })),
    });
  }

  // 2. Recurring misses by weekday (Tower C staircase Sunday).
  const wk = missByWeekday(db, from, addDays(today, -1));
  const worst = wk.find((r) => r.byDay.some((d) => d.total >= 4 && d.missed / d.total >= 0.5));
  if (worst) {
    const dIdx = worst.byDay.map((d, i) => ({ i, r: d.total ? d.missed / d.total : 0, ...d })).sort((a, b) => b.r - a.r)[0];
    const others = worst.byDay.filter((_, i) => i !== dIdx.i).reduce((a, d) => ({ total: a.total + d.total, missed: a.missed + d.missed }), { total: 0, missed: 0 });
    out.push({
      id: "weekday-miss", severity: "high", title: `${worst.label}: missed on ${WEEKDAYS[dIdx.i]}days`,
      text: `${worst.label} was missed on ${dIdx.missed} of ${dIdx.total} ${WEEKDAYS[dIdx.i]}days in 90 days, against ${others.missed} of ${others.total} on other days.`,
      numbers: { missed_on_day: dIdx.missed, days: dIdx.total, missed_other: others.missed, other_days: others.total },
      suggestion: "Weekly-off roster leaves this tower uncovered. Assign a reliever housekeeper on that day or stagger weekly offs.",
      evidence: [{ label: "Weekday miss matrix", route: "/insights#weekday" }, { label: "Heatmap (90 days)", route: `/dashboard?range=90&tower=${locationById(db, worst.location_id)?.tower ?? "all"}` }],
    });
  }

  // 3. Night patrol in the last week of the month.
  const patrol = db.tasks.filter((t) => t.template_id === "sec_patrol" && t.date >= from && t.date < today && ["done", "done_late", "missed"].includes(t.status));
  if (patrol.length) {
    const last = patrol.filter((t) => Number(t.date.slice(8, 10)) >= 24);
    const rest = patrol.filter((t) => Number(t.date.slice(8, 10)) < 24);
    const rate = (xs: typeof patrol) => (xs.length ? xs.filter((t) => t.status !== "missed").length / xs.length : 0);
    const a = Math.round(rate(last) * 100), b = Math.round(rate(rest) * 100);
    if (b - a >= 15)
      out.push({
        id: "patrol", severity: "medium", title: "Night patrol completion drops at month end",
        text: `Night patrol rounds were completed on ${a}% of nights in the last week of the month (days 24 onwards) versus ${b}% on other nights.`,
        numbers: { last_week_pct: a, other_pct: b, nights_last_week: last.length },
        suggestion: "Check the night-shift roster and reliever availability in the last week (salary cycle and leave patterns).",
        evidence: [{ label: "Night patrol tasks", route: "/tasks?template=sec_patrol" }],
      });
  }

  // 4. STP odour after rain.
  const odour = db.tickets.filter((t) => t.category === "STP/Odour" && t.created_at >= fromMs);
  if (odour.length) {
    const afterRain = odour.filter((t) => db.rainDays.includes(addDays(istDate(t.created_at), -1)) || db.rainDays.includes(istDate(t.created_at)));
    const nearClub = odour.filter((t) => t.location_id === "CLUBHOUSE").length;
    out.push({
      id: "odour", severity: "medium", title: "STP odour complaints follow rain",
      text: `${odour.length} STP/odour complaints in 90 days, ${nearClub} near the clubhouse; ${afterRain.length} of ${odour.length} came on or the day after a rain day.`,
      numbers: { complaints: odour.length, near_clubhouse: nearClub, after_rain: afterRain.length },
      suggestion: "Storm water is entering the clubhouse inspection chamber. Seal the chamber cover and add a pre-monsoon STP check to the checklist.",
      evidence: odour.map((t) => ({ label: t.number, route: `/tickets/${t.id}` })),
    });
  }

  // 5. Security below contract.
  const sec = securityDays(db, from, addDays(today, -1));
  const below = sec.filter((d) => d.below);
  if (below.length) {
    const shortManDays = below.reduce((s, d) => s + (d.contracted - d.onDuty), 0);
    out.push({
      id: "security", severity: "medium", title: "Security headcount below contract",
      text: `Security was below contracted headcount on ${below.length} days in 90 days (${shortManDays} guard man-days short). These days reduce billable man-days and are visible to the client.`,
      numbers: { days_below: below.length, man_days_short: shortManDays },
      suggestion: "Increase the reliever pool by 1–2 guards, especially for festival weeks.",
      evidence: [{ label: "Attendance panel", route: "/dashboard#attendance" }, { label: "Security billing", route: "/billing#security" }],
    });
  }

  // 6. Unacknowledged consumables.
  const months = [...new Set(db.consumables.map((c) => c.delivery_date.slice(0, 7)))];
  const blocked = months.flatMap((m) => consumablesBilling(db, m).blocked);
  if (blocked.length) {
    const value = blocked.reduce((s, c) => s + c.quantity * c.rate, 0);
    out.push({
      id: "consumables", severity: "low", title: "Consumable deliveries without acknowledgement",
      text: `${blocked.length} consumable deliveries have no acknowledgement (${inr(value)} at sample rates) and cannot be billed until proof is captured.`,
      numbers: { deliveries: blocked.length, value },
      suggestion: "Make a photo or signature on WhatsApp mandatory at delivery.",
      evidence: [{ label: "Billing: consumables", route: "/billing#consumables" }],
    });
  }

  // 7. Meter anomalies this cycle.
  const flagged = db.meterReadings.filter((r) => r.cycle === today.slice(0, 7) && r.flags.some((f) => /average/.test(f)));
  if (flagged.length) {
    const meters = new Map(db.meters.map((m) => [m.id, m]));
    out.push({
      id: "meters", severity: "medium", title: "Abnormal water consumption",
      text: `${flagged.length} water meter(s) show consumption above 3× the 3-month average this cycle: ${flagged.map((r) => meters.get(r.meter_id)?.unit).join(", ")}.`,
      numbers: { meters: flagged.length },
      suggestion: "Ask the technician to re-read the meter and check for leaks inside the flat before billing.",
      evidence: flagged.map((r) => ({ label: meters.get(r.meter_id)?.unit ?? r.meter_id, route: `/meters?unit=${meters.get(r.meter_id)?.unit}` })),
    });
  }
  void securityBilling;
  return out;
}

/** Numbers that an LLM-worded insight is allowed to contain. */
export function allowedNumbers(i: Insight): Set<string> {
  const s = new Set<string>();
  const add = (n: string) => s.add(n.replace(/,/g, ""));
  (i.text.match(/\d[\d,]*(\.\d+)?/g) ?? []).forEach(add);
  Object.values(i.numbers).forEach((v) => add(String(v)));
  ["90", "3", "24", "1", "2", "0", "100"].forEach(add);
  return s;
}
