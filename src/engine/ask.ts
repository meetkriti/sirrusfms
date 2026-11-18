// M7: "Ask Paradigm". Tools over the data layer (no free-form SQL). Mock mode routes
// questions to tools with deterministic rules; Live mode lets Claude call the same tools.
import type { DB, ServiceLineId, TicketCategory } from "../types";
import { addDays, istAt, istDate, monthDays, monthLabel, MONTHS_LONG, weekStart, HOUR, dateRange } from "../lib/time";
import { dmy, pct, inr } from "../lib/format";
import { locationById, locationName, staffName, taskTitle, templateById } from "./core";
import { filterTasks, stats } from "./metrics";
import { isBreached } from "./tickets";
import { securityBilling } from "./billing";
import { computeInsights, type Evidence } from "./patterns";
import { extractTowers } from "./nlp";
import { currentCycle } from "./meters";

export interface ToolResult {
  result: unknown;
  evidence: Evidence[];
}

const SL: Record<string, ServiceLineId> = {
  housekeeping: "housekeeping", hk: "housekeeping", cleaning: "housekeeping", safai: "housekeeping",
  security: "security", guard: "security", guards: "security",
  technical: "technical", maintenance: "technical", engineering: "technical",
  stp: "stp", sewage: "stp", landscaping: "landscaping", garden: "landscaping", pump: "water", water: "water", dg: "electromechanical",
};

export const TOOL_DEFS = [
  {
    name: "get_compliance",
    description: "Checklist compliance for a date range, optionally filtered by service line, tower (A-D) or checklist template. Returns counts of done, late, missed and the list of missed tasks.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
        service_line: { type: "string", enum: ["housekeeping", "security", "technical", "water", "stp", "landscaping", "electromechanical"] },
        tower: { type: "string", enum: ["A", "B", "C", "D"] },
        template_id: { type: "string" },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "list_tickets",
    description: "Tickets (complaints/issues) raised in a date range with category, location, priority, escalation level, owner and SLA breach flags.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string" }, to: { type: "string" },
        breached_only: { type: "boolean" }, open_only: { type: "boolean" },
        tower: { type: "string", enum: ["A", "B", "C", "D"] }, category: { type: "string" },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "get_security_attendance",
    description: "Security guard attendance and billable man-days for a calendar month (YYYY-MM): contracted vs billable, days below contract, unverified days.",
    input_schema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM" } }, required: ["month"], additionalProperties: false },
  },
  {
    name: "get_meter_readings",
    description: "Water meter readings for a billing cycle (YYYY-MM): captured vs total, and flagged readings (abnormal, zero, lower than previous, low confidence).",
    input_schema: { type: "object", properties: { cycle: { type: "string" }, flagged_only: { type: "boolean" }, unit: { type: "string" } }, required: [], additionalProperties: false },
  },
  {
    name: "get_alerts",
    description: "Alerts raised by the rule engine in a date range with rule, severity and status.",
    input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"], additionalProperties: false },
  },
  {
    name: "get_tasks",
    description: "Individual checklist task instances on a date (status, responses/readings, completion time, assignee). Template ids: " + "hk_staircase, hk_lift_lobby, hk_basement, hk_garbage, hk_washroom, sec_handover, sec_patrol, sec_register, tech_pump, tech_dg, tech_fire, tech_lift_amc, stp_log, land_watering, land_mowing, pest_control, water_tank.",
    input_schema: { type: "object", properties: { date: { type: "string" }, template_id: { type: "string" } }, required: ["date"], additionalProperties: false },
  },
  {
    name: "get_patterns",
    description: "Computed recurring patterns and insights over the last 90 days (recurring tickets, weekday misses, escalations), optionally for one tower.",
    input_schema: { type: "object", properties: { tower: { type: "string", enum: ["A", "B", "C", "D"] } }, required: [], additionalProperties: false },
  },
];

const towerOfLoc = (db: DB, id: string) => locationById(db, id)?.tower;

export function runTool(db: DB, now: number, name: string, input: Record<string, unknown>): ToolResult {
  const today = istDate(now);
  switch (name) {
    case "get_compliance": {
      const from = String(input.from), to = String(input.to);
      const tasks = filterTasks(db, { from, to, serviceLine: (input.service_line as ServiceLineId) ?? "all", tower: (input.tower as string) ?? "all", templateId: input.template_id as string | undefined });
      const s = stats(db, tasks, now);
      const missed = tasks.filter((t) => t.status === "missed");
      const byTpl = new Map<string, { name: string; done: number; late: number; missed: number }>();
      for (const t of tasks) {
        const k = taskTitle(db, t.template_id, t.location_id);
        const b = byTpl.get(k) ?? { name: k, done: 0, late: 0, missed: 0 };
        if (t.status === "done") b.done++;
        if (t.status === "done_late") b.late++;
        if (t.status === "missed") b.missed++;
        byTpl.set(k, b);
      }
      return {
        result: {
          from, to, filters: { service_line: input.service_line ?? "all", tower: input.tower ?? "all" }, total_tasks: s.total, done_on_time: s.done, done_late: s.late, missed: s.missed, pending: s.pending,
          compliance_pct: s.compliance === null ? null : Math.round(s.compliance * 1000) / 10, on_time_pct: s.onTime === null ? null : Math.round(s.onTime * 1000) / 10,
          missed_tasks: missed.map((t) => ({ id: t.id, task: taskTitle(db, t.template_id, t.location_id), date: t.date, due: t.slot, remarks: t.remarks ?? null })),
          by_checklist: [...byTpl.values()].sort((a, b) => b.missed - a.missed).slice(0, 8),
        },
        evidence: missed.slice(0, 8).map((t) => ({ label: `Missed: ${taskTitle(db, t.template_id, t.location_id)} (${dmy(t.date)})`, route: `/tasks?id=${t.id}` })).concat([{ label: "Compliance heatmap", route: `/dashboard?from=${from}&to=${to}${input.tower ? `&tower=${input.tower}` : ""}${input.service_line ? `&sl=${input.service_line}` : ""}` }]),
      };
    }
    case "list_tickets": {
      const fromMs = istAt(String(input.from)), toMs = istAt(String(input.to), "23:59");
      let ts = db.tickets.filter((t) => t.created_at >= fromMs && t.created_at <= toMs);
      if (input.breached_only) ts = ts.filter(isBreached);
      if (input.open_only) ts = ts.filter((t) => !["resolved", "closed"].includes(t.status));
      if (input.tower) ts = ts.filter((t) => towerOfLoc(db, t.location_id) === input.tower);
      if (input.category) ts = ts.filter((t) => t.category.toLowerCase() === String(input.category).toLowerCase());
      return {
        result: {
          count: ts.length,
          tickets: ts.map((t) => ({
            number: t.number, category: t.category, location: locationName(db, t.location_id), priority: t.priority, status: t.status, level_reached: t.level, owner: staffName(db, t.owner_id),
            l1_owner: staffName(db, t.timeline.find((e) => e.type === "assigned")?.text.match(/to (.+?) \(L1\)/)?.[1] ?? ""), raised: dmy(istDate(t.created_at)), description: t.description,
            response_breached: !!t.response_breached, resolution_breached: !!t.resolution_breached, hours_to_resolve: t.resolved_at ? Math.round(((t.resolved_at - t.created_at) / HOUR) * 10) / 10 : null,
          })),
        },
        evidence: ts.slice(0, 12).map((t) => ({ label: `${t.number} ${t.category}`, route: `/tickets/${t.id}` })),
      };
    }
    case "get_security_attendance": {
      const month = String(input.month);
      const b = securityBilling(db, month);
      return {
        result: {
          month, days_recorded: b.days.length, days_in_month: monthDays(month).length, contracted_guard_man_days: b.guardContracted, billable_guard_man_days: b.guardBillable, shortfall_man_days: b.guardShortfall,
          supervisor_man_days: b.supervisorBillable, days_below_contract: b.shortfallDays.map((d) => ({ date: d.date, on_duty: d.onDuty, contracted: d.contracted })), unverified_days: b.unverifiedDays.map((d) => d.date),
          billing_rule: "billable = present + approved replacements + half-days × 0.5 (configurable)", per_shift: b.perShift,
        },
        evidence: [{ label: `Security billing ${monthLabel(month)}`, route: `/billing?month=${month}#security` }, ...b.shortfallDays.slice(0, 4).map((d) => ({ label: `Below contract ${dmy(d.date)}`, route: `/dashboard?from=${d.date}&to=${d.date}#attendance` }))],
      };
    }
    case "get_meter_readings": {
      const cycle = String(input.cycle ?? currentCycle(db));
      const meters = new Map(db.meters.map((m) => [m.id, m]));
      let rs = db.meterReadings.filter((r) => r.cycle === cycle && (r.meter_id === "UNMATCHED" || meters.get(r.meter_id)?.type === "water"));
      const water = db.meters.filter((m) => m.type === "water").length;
      const captured = new Set(rs.filter((r) => r.meter_id !== "UNMATCHED").map((r) => r.meter_id)).size;
      if (input.unit) rs = rs.filter((r) => meters.get(r.meter_id)?.unit === input.unit);
      const flagged = rs.filter((r) => r.flags.length || r.status !== "ok");
      const list = (input.flagged_only ? flagged : rs).slice(0, 40);
      return {
        result: {
          cycle, captured, total_water_meters: water, flagged_count: flagged.length,
          readings: list.map((r) => ({ unit: meters.get(r.meter_id)?.unit ?? "UNMATCHED", previous: r.previous, current: r.value, consumption: r.consumption, three_month_avg: meters.get(r.meter_id)?.avg_consumption_3m ?? null, status: r.status, flags: r.flags })),
        },
        evidence: list.slice(0, 10).map((r) => ({ label: `${meters.get(r.meter_id)?.unit ?? "Unmatched"}: ${r.status.replace("_", " ")}`, route: `/meters?unit=${meters.get(r.meter_id)?.unit ?? ""}` })),
      };
    }
    case "get_alerts": {
      const fromMs = istAt(String(input.from)), toMs = istAt(String(input.to), "23:59");
      const as = db.alerts.filter((a) => a.created_at >= fromMs && a.created_at <= toMs);
      return { result: { count: as.length, alerts: as.slice(-30).map((a) => ({ rule: a.rule_id, severity: a.severity, title: a.title, status: a.status, at: dmy(istDate(a.created_at)) })) }, evidence: [{ label: "Alert inbox", route: "/alerts" }] };
    }
    case "get_tasks": {
      const date = String(input.date);
      let ts = db.tasks.filter((t) => t.date === date);
      if (input.template_id) ts = ts.filter((t) => t.template_id === input.template_id);
      return {
        result: {
          date,
          tasks: ts.map((t) => ({ id: t.id, task: taskTitle(db, t.template_id, t.location_id), due: t.slot, status: t.status, assignee: staffName(db, t.assignee_id), completed_at: t.completed_at ? new Date(t.completed_at + 330 * 60000).toISOString().slice(11, 16) : null, responses: t.responses, photos: t.photos.length, out_of_range: t.out_of_range ?? [] })),
        },
        evidence: ts.slice(0, 6).map((t) => ({ label: `${taskTitle(db, t.template_id, t.location_id)} ${t.slot}: ${t.status.replace("_", " ")}`, route: `/tasks?id=${t.id}` })),
      };
    }
    case "get_patterns": {
      const tower = input.tower as string | undefined;
      const from = istAt(addDays(today, -89));
      const ts = db.tickets.filter((t) => t.created_at >= from && (!tower || towerOfLoc(db, t.location_id) === tower));
      const byCat = new Map<string, typeof ts>();
      ts.forEach((t) => byCat.set(t.category, [...(byCat.get(t.category) ?? []), t]));
      const insights = computeInsights(db, now).filter((i) => !tower || i.text.includes(`Tower ${tower}`));
      const tasks = filterTasks(db, { from: addDays(today, -89), to: addDays(today, -1), tower: tower ?? "all" });
      const misses = new Map<string, number>();
      tasks.filter((t) => t.status === "missed").forEach((t) => misses.set(taskTitle(db, t.template_id, t.location_id), (misses.get(taskTitle(db, t.template_id, t.location_id)) ?? 0) + 1));
      return {
        result: {
          tower: tower ?? "all", period_days: 90, tickets_total: ts.length,
          tickets_by_category: [...byCat.entries()].map(([c, xs]) => ({ category: c, count: xs.length, escalated_to_L3_or_above: xs.filter((t) => t.level === "L3" || t.level === "L4").length, numbers: xs.map((t) => t.number) })).sort((a, b) => b.count - a.count),
          most_missed_checklists: [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([task, n]) => ({ task, missed: n })),
          insights: insights.map((i) => ({ title: i.title, finding: i.text, suggestion: i.suggestion })),
        },
        evidence: [...ts.filter((t) => (byCat.get(t.category)?.length ?? 0) >= 2).slice(0, 8).map((t) => ({ label: `${t.number} ${t.category}`, route: `/tickets/${t.id}` })), { label: "Pattern analysis", route: "/insights" }],
      };
    }
  }
  return { result: { error: `Unknown tool ${name}` }, evidence: [] };
}

// ---------------------------------------------------------------------------
// Mock-mode router: deterministic, explainable, and honest about gaps.

export interface Period {
  from: string;
  to: string;
  label: string;
}

export function parsePeriod(q: string, today: string, fallback: "last7" | "month" = "last7"): Period {
  const s = q.toLowerCase();
  if (/last week|pichle hafte|previous week|kale week/.test(s)) {
    const to = addDays(weekStart(today), -1);
    return { from: addDays(to, -6), to, label: `last week (${dmy(addDays(to, -6))} to ${dmy(to)})` };
  }
  if (/this week|is hafte/.test(s)) return { from: weekStart(today), to: today, label: "this week" };
  if (/yesterday|\bkal\b|ninne/.test(s)) return { from: addDays(today, -1), to: addDays(today, -1), label: `yesterday (${dmy(addDays(today, -1))})` };
  if (/today|\baaj\b|ivattu/.test(s)) return { from: today, to: today, label: "today" };
  if (/last month|pichle mahine/.test(s)) {
    const m = istDate(istAt(`${today.slice(0, 7)}-01`) - 12 * HOUR).slice(0, 7);
    const d = monthDays(m);
    return { from: d[0], to: d[d.length - 1], label: monthLabel(m) };
  }
  const mi = MONTHS_LONG.findIndex((m) => new RegExp(`\\b(${m.toLowerCase()}|${m.slice(0, 3).toLowerCase()})\\b`).test(s));
  if (mi >= 0) {
    let y = Number(today.slice(0, 4));
    if (`${y}-${String(mi + 1).padStart(2, "0")}` > today.slice(0, 7)) y--;
    const m = `${y}-${String(mi + 1).padStart(2, "0")}`;
    const d = monthDays(m);
    return { from: d[0], to: d[d.length - 1] < today ? d[d.length - 1] : today, label: monthLabel(m) };
  }
  if (/this month|is mahine|current month/.test(s) || fallback === "month") return { from: `${today.slice(0, 7)}-01`, to: today, label: `this month (${monthLabel(today.slice(0, 7))})` };
  if (/last (30|thirty) days/.test(s)) return { from: addDays(today, -29), to: today, label: "the last 30 days" };
  if (/last (90|ninety) days|quarter/.test(s)) return { from: addDays(today, -89), to: today, label: "the last 90 days" };
  return { from: addDays(today, -6), to: today, label: "the last 7 days" };
}

const UNTRACKED = /(diesel cost|fuel cost|salary|salaries|payroll|profit|margin|maintenance (charges|dues)|resident (dues|billing)|rent|property tax|electricity bill amount|bescom bill|gst|share price|weather forecast|vendor payment|cctv footage|insurance)/;

export interface MockAnswer {
  text: string;
  calls: { name: string; input: Record<string, unknown>; result: unknown }[];
  evidence: Evidence[];
}

export function mockAsk(db: DB, now: number, question: string): MockAnswer {
  const q = question.toLowerCase();
  const today = istDate(now);
  const calls: MockAnswer["calls"] = [];
  const evidence: Evidence[] = [];
  const call = (name: string, input: Record<string, unknown>) => {
    const r = runTool(db, now, name, input);
    calls.push({ name, input, result: r.result });
    evidence.push(...r.evidence);
    return r.result as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const towers = extractTowers(question);
  const tower = towers[0];
  const slKey = Object.keys(SL).find((k) => new RegExp(`\\b${k}\\b`).test(q));
  const sl = slKey ? SL[slKey] : undefined;

  if (UNTRACKED.test(q)) {
    const what = q.match(UNTRACKED)![0];
    return { text: `That is not available in the data. The prototype tracks checklists, tickets, alerts, attendance, meter readings, consumable deliveries and quotation-based work, but not "${what}".`, calls, evidence };
  }

  // Specific log on a specific day ("Kal STP ka log fill hua tha?")
  if (/\blog\b|checklist|filled|fill|hua tha|ho gaya tha|done (yesterday|today)/.test(q) && /yesterday|\bkal\b|today|\baaj\b|\d{1,2}(st|nd|rd|th)?/.test(q)) {
    const p = parsePeriod(q, today);
    const tpl = /stp/.test(q) ? "stp_log" : /pump/.test(q) ? "tech_pump" : /patrol/.test(q) ? "sec_patrol" : /stair/.test(q) ? "hk_staircase" : /dg/.test(q) ? "tech_dg" : /lobby/.test(q) ? "hk_lift_lobby" : /handover/.test(q) ? "sec_handover" : undefined;
    const r = call("get_tasks", { date: p.from, ...(tpl ? { template_id: tpl } : {}) });
    if (!r.tasks.length) return { text: `No ${tpl ? templateById(db, tpl)?.name : "checklist"} was scheduled on ${dmy(p.from)}.`, calls, evidence };
    const done = r.tasks.filter((t: any) => t.status === "done" || t.status === "done_late");
    const lines = r.tasks.map((t: any) => `- ${t.due} (${t.assignee}): **${t.status.replace("_", " ")}**${t.completed_at ? ` at ${t.completed_at}` : ""}${Object.keys(t.responses).length ? `. ${Object.entries(t.responses).filter(([, v]) => typeof v === "number").map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}${t.out_of_range.length ? ` ⚠ out of range: ${t.out_of_range.join(", ")}` : ""}`);
    const hinglish = /\bkal\b|hua|tha|ka\b/.test(q);
    const head = hinglish
      ? `${done.length === r.tasks.length ? "Haan" : done.length ? "Partly" : "Nahi"}: ${p.label} ${tpl ? templateById(db, tpl)?.name : "checklists"} ${done.length} of ${r.tasks.length} slots fill hue.`
      : `${done.length} of ${r.tasks.length} ${tpl ? templateById(db, tpl)?.name : "checklist"} slots were completed on ${dmy(p.from)}.`;
    return { text: `${head}\n${lines.join("\n")}`, calls, evidence };
  }

  // Recurring problems ("What keeps going wrong in Tower B?")
  if (/keeps? going wrong|keep going wrong|recurring|repeat|again and again|baar baar|pattern|what.*(wrong|problem)|kya problem/.test(q)) {
    const r = call("get_patterns", tower ? { tower } : {});
    if (!r.tickets_total) return { text: `No tickets recorded${tower ? ` for Tower ${tower}` : ""} in the last 90 days.`, calls, evidence };
    const top = r.tickets_by_category.slice(0, 3);
    const lines = top.map((c: any) => `- **${c.category}**: ${c.count} ticket(s)${c.escalated_to_L3_or_above ? `, ${c.escalated_to_L3_or_above} escalated to Zonal level or above` : ""} (${c.numbers.slice(0, 5).join(", ")})`);
    const miss = r.most_missed_checklists.slice(0, 2).map((m: any) => `- ${m.task}: missed ${m.missed} times`);
    const ins = r.insights[0] ? `\n\nSuggested action: ${r.insights[0].suggestion}` : "";
    return { text: `In the last 90 days${tower ? ` Tower ${tower}` : ""} had ${r.tickets_total} tickets. Most frequent:\n${lines.join("\n")}${miss.length ? `\n\nMost missed checklists:\n${miss.join("\n")}` : ""}${ins}`, calls, evidence };
  }

  // Tickets & SLA
  if (/ticket|sla|complaint|escalat|breach/.test(q)) {
    const p = parsePeriod(q, today, "month");
    const r = call("list_tickets", { from: p.from, to: p.to, breached_only: /breach|sla/.test(q), ...(tower ? { tower } : {}), open_only: /\bopen\b|pending/.test(q) });
    if (!r.count) return { text: `No ${/breach|sla/.test(q) ? "SLA-breached " : ""}tickets in ${p.label}.`, calls, evidence };
    const lines = r.tickets.map((t: any) => `- **${t.number}** ${t.category}, ${t.location} (${t.priority}, raised ${t.raised}): ${[t.response_breached && "response SLA breached", t.resolution_breached && "resolution SLA breached"].filter(Boolean).join(", ") || t.status}. Owner at L1: ${t.l1_owner || "–"}; reached ${t.level_reached} (${t.owner}).`);
    return { text: `${r.count} ${/breach|sla/.test(q) ? "tickets breached SLA" : "tickets"} in ${p.label}:\n${lines.join("\n")}`, calls, evidence };
  }

  // Security man-days / attendance
  if (/man-?days?|billable|attendance|headcount|guards? (present|short)|security.*(short|below)/.test(q)) {
    const p = parsePeriod(q, today, "month");
    const month = p.from.slice(0, 7);
    const r = call("get_security_attendance", { month });
    return {
      text: `${monthLabel(month)}: **${r.billable_guard_man_days} billable guard man-days** against ${r.contracted_guard_man_days} contracted (${r.shortfall_man_days} short), plus ${r.supervisor_man_days} supervisor man-days.${r.days_recorded < r.days_in_month ? ` Attendance is recorded for ${r.days_recorded} of ${r.days_in_month} days so far.` : ""}\n- Days below contract: ${r.days_below_contract.length ? r.days_below_contract.map((d: any) => `${dmy(d.date)} (${d.on_duty}/${d.contracted})`).join(", ") : "none"}\n- Unverified days: ${r.unverified_days.length ? r.unverified_days.map(dmy).join(", ") : "none"}\n- Rule used: ${r.billing_rule}`,
      calls, evidence,
    };
  }

  // Meters
  if (/meter|consumption|water reading|reading/.test(q)) {
    const p = parsePeriod(q, today, "month");
    const r = call("get_meter_readings", { cycle: p.from.slice(0, 7), flagged_only: /abnormal|unusual|flag|anomal|high|wrong|leak/.test(q) || !/all/.test(q) });
    const abnormal = r.readings.filter((x: any) => x.flags.some((f: string) => /average/.test(f)));
    const other = r.readings.filter((x: any) => !x.flags.some((f: string) => /average/.test(f)));
    const fmt = (x: any) => `- **${x.unit}**: ${x.previous ?? "–"} → ${x.current} (${x.consumption ?? "–"} KL${x.three_month_avg ? `, 3-month avg ${x.three_month_avg}` : ""}). ${x.flags.join(" ")}`;
    return {
      text: `Cycle ${monthLabel(r.cycle)}: ${r.captured} of ${r.total_water_meters} water meters captured; ${r.flagged_count} reading(s) flagged.${abnormal.length ? `\n\nAbnormal consumption:\n${abnormal.map(fmt).join("\n")}` : "\n\nNo reading is above 3× its 3-month average yet (upload the pending meter photos on the Meters page)."}${other.length ? `\n\nOther flags:\n${other.slice(0, 6).map(fmt).join("\n")}` : ""}`,
      calls, evidence,
    };
  }

  // Alerts
  if (/alert/.test(q)) {
    const p = parsePeriod(q, today);
    const r = call("get_alerts", { from: p.from, to: p.to });
    return { text: `${r.count} alerts in ${p.label}. Latest:\n${r.alerts.slice(-6).reverse().map((a: any) => `- ${a.at} ${a.rule} (${a.severity}, ${a.status}): ${a.title}`).join("\n")}`, calls, evidence };
  }

  // Compliance / performance
  if (sl || tower || /how did|perform|compliance|kaisa|kaise|status|missed|checklist/.test(q)) {
    const p = parsePeriod(q, today);
    const r = call("get_compliance", { from: p.from, to: p.to, ...(sl ? { service_line: sl } : {}), ...(tower ? { tower } : {}) });
    if (!r.total_tasks) return { text: `No ${sl ?? ""} checklists were scheduled${tower ? ` in Tower ${tower}` : ""} in ${p.label}.`, calls, evidence };
    const scope = [tower && `Tower ${tower}`, sl && (slKey === "hk" ? "housekeeping" : sl)].filter(Boolean).join(" ") || "All service lines";
    const missedLines = r.missed_tasks.slice(0, 6).map((m: any) => `- ${m.task}, ${dmy(m.date)} (due ${m.due})${m.remarks ? `: "${m.remarks}"` : ""}`);
    return {
      text: `${scope}, ${p.label}: **${r.compliance_pct ?? "–"}% compliance** (${r.done_on_time + r.done_late} of ${r.done_on_time + r.done_late + r.missed} checklists done; ${r.done_late} late, ${r.missed} missed${r.pending ? `, ${r.pending} still pending` : ""}). On-time rate ${r.on_time_pct ?? "–"}%.${missedLines.length ? `\n\nMissed:\n${missedLines.join("\n")}` : ""}`,
      calls, evidence,
    };
  }

  return {
    text: "That is not available in the data I can query. I can answer questions about checklist compliance, tickets and SLAs, alerts, security attendance and billable man-days, meter readings, and recurring patterns.",
    calls, evidence,
  };
}

export { pct, inr, dateRange };
export type { TicketCategory };
