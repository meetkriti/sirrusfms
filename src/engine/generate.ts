// Deterministic synthetic data for ONE fictional residential project ("Lakeshore Greens").
// 90 days of history ending today, with the operational patterns from the brief planted in it.
import { config } from "../config";
import type {
  AttendanceRecord, ConsumableDelivery, DB, Inspection, Location, Meter, MeterReading, Project,
  ProjectWorkExecution, Quotation, ServiceLineId, Shift, SOP, Staff, TaskInstance, TicketCategory, Priority,
} from "../types";
import { addDays, dateRange, istAt, MIN, monthOf, weekday, HOUR } from "../lib/time";
import { hashStr, makeRng, type Rng } from "../lib/rng";
import { baseFields, PROJECT_ID } from "./core";
import { time12 } from "../lib/format";
import { markMissedHistorical, settleTask } from "./settle";
import { tasksForDate } from "./tasks";
import { advanceTo, planAutopilot } from "./sim";
import { buildHistoricalTicket, type NewTicket } from "./tickets";
import { buildGroupExport, buildEmails, type SeedEmail } from "./seedMessages";

export const SEED = 20261116;
export const SIM_START_HHMM = "07:00";

export interface MeterUploadLabel {
  file: string;
  serial: string;
  unit_label: string;
  reading: number;
  confidence: number;
  note: string;
}

export interface SeedOutput {
  db: DB;
  whatsappExport: string;
  emails: SeedEmail[];
  meterUploads: MeterUploadLabel[];
  plan: SeedPlan;
}

export interface SeedPlan {
  today: string;
  windowFrom: string;
  plantedInferred: { template_id: string; location_id: string; date: string; slot?: string }[];
  forcedCMiss: string[];
  shortfallDays: string[];
  groupOnlyIssueDate: string;
}

const NAMES = {
  hk: ["Lakshmi", "Shanthamma", "Gowramma", "Saroja", "Manjula", "Renuka", "Yashoda", "Parvathi", "Kamala", "Sunitha", "Bhagya", "Roopa", "Savitha", "Nagamma", "Shobha", "Pushpa", "Jayamma", "Radha", "Mangala", "Vimala"],
  guards: ["Ramesh", "Shivaraj", "Prakash", "Naveen", "Dinesh", "Mallikarjun", "Hanumanthu", "Santosh", "Ravi Teja", "Mohan", "Siddappa", "Ashok", "Lokesh", "Girish", "Umesh", "Basavaraj K", "Kiran", "Manoj", "Rajesh", "Srikanth", "Venu", "Chetan", "Harish", "Nagaraj"],
  surnames: ["Gowda", "Naik", "Patil", "Reddy", "Kumar", "Shetty", "Rao", "Hegde", "Swamy", "Murthy"],
};

const phone = (n: number) => `+91 90000 ${String(10000 + n).slice(-5)}`;

function buildProject(today: string): Project {
  return {
    id: PROJECT_ID, project_id: PROJECT_ID, created_at: istAt("2024-04-01"), updated_at: istAt(today), source: "seed",
    name: "Lakeshore Greens", city: "Bengaluru", zone: "Bengaluru East",
    client_name: "Lakeshore Greens Apartment Owners' Association", agreement_start: "2024-04-01",
    towers: ["A", "B", "C", "D"], floors_per_tower: 16, units_per_floor: 6, units_count: 384, stp_capacity_kld: 350,
    contracted_headcount: { housekeeping: 20, security: 27, technical: 6, stp: 3, landscaping: 4 },
  };
}

function buildLocations(db: DB): Location[] {
  const at = istAt("2024-04-01");
  const L = (id: string, name: string, kind: Location["kind"], parent: string | null, tower?: string): Location => ({
    id, project_id: PROJECT_ID, created_at: at, updated_at: at, source: "seed", name, kind, parent_id: parent, tower,
  });
  const out: Location[] = [L("PRJ", "Lakeshore Greens (site-wide)", "project", null)];
  for (const t of ["A", "B", "C", "D"]) {
    out.push(L(`TWR-${t}`, `Tower ${t}`, "tower", "PRJ", t));
    out.push(L(`${t}-STAIR`, `Tower ${t} staircase`, "area", `TWR-${t}`, t));
    out.push(L(`${t}-LOBBY`, `Tower ${t} lift lobby`, "area", `TWR-${t}`, t));
  }
  out.push(
    L("BASE-1", "Basement 1", "area", "PRJ"), L("BASE-2", "Basement 2", "area", "PRJ"),
    L("CLUBHOUSE", "Clubhouse", "area", "PRJ"), L("CLUB-WR", "Clubhouse washrooms", "area", "CLUBHOUSE"),
    L("STP-ROOM", "STP (350 KLD)", "area", "PRJ"), L("PUMP-ROOM", "Pump room", "area", "PRJ"),
    L("DG-YARD", "DG yard (2 DG sets)", "area", "PRJ"), L("GARDEN", "Central garden", "area", "PRJ"),
    L("MAIN-GATE", "Main gate", "area", "PRJ"), L("SERVICE-GATE", "Service gate", "area", "PRJ"),
    L("GARBAGE-PT", "Garbage collection point", "area", "PRJ"),
  );
  return out;
}

function buildShifts(): Shift[] {
  return [
    { id: "sec_m", service_line: "security", name: "morning", start: "06:00", end: "14:00" },
    { id: "sec_a", service_line: "security", name: "afternoon", start: "14:00", end: "22:00" },
    { id: "sec_n", service_line: "security", name: "night", start: "22:00", end: "06:00" },
    { id: "stp_m", service_line: "stp", name: "morning", start: "06:00", end: "14:00" },
    { id: "stp_a", service_line: "stp", name: "afternoon", start: "14:00", end: "22:00" },
    { id: "stp_n", service_line: "stp", name: "night", start: "22:00", end: "06:00" },
    { id: "gen", service_line: "housekeeping", name: "general", start: "07:00", end: "16:00" },
  ];
}

function buildStaff(): Staff[] {
  const at = istAt("2024-04-01");
  let n = 0;
  const S = (id: string, name: string, role: Staff["role"], title: string, level: Staff["level"], sl: ServiceLineId | null, reports: string | null, shift: string | null, tower?: string): Staff => ({
    id, project_id: PROJECT_ID, created_at: at, updated_at: at, source: "seed", name, role, title, level, service_line: sl, phone: phone(++n), reports_to: reports, shift, tower,
  });
  const out: Staff[] = [
    S("ops_head", "Anita Desai", "ops_head", "Operations Head", "L4", null, null, null),
    S("zonal", "Karthik Rao", "zonal", "Zonal Manager, Bengaluru East", "L3", null, "ops_head", null),
    S("fm", "Priya Nair", "fm", "Facility Manager", "L2", null, "zonal", null),
    S("finance", "Deepak Jain", "finance", "Billing Executive", "-", null, "ops_head", null),
    S("inspector", "Ramesh Kulkarni", "inspector", "Quality & Audit Head", "L3", null, "ops_head", null),
    S("sup_hk", "Ravi Kumar", "supervisor", "Housekeeping Supervisor", "L1", "housekeeping", "fm", "gen"),
    S("sup_sec", "Anil Shetty", "supervisor", "Security Supervisor (morning shift lead)", "L1", "security", "fm", "sec_m"),
    S("sup_tech", "Manjunath Gowda", "supervisor", "Technical Supervisor", "L1", "technical", "fm", "gen"),
    S("sup_land", "Venkatesh Naik", "supervisor", "Landscaping Supervisor", "L1", "landscaping", "fm", "gen"),
    S("sec_sup2", "Mahesh Patil", "supervisor", "Shift Supervisor (afternoon)", "L1", "security", "sup_sec", "sec_a"),
    S("sec_sup3", "Raghu Hegde", "supervisor", "Shift Supervisor (night)", "L1", "security", "sup_sec", "sec_n"),
    S("stp_op1", "Suresh Reddy", "ground", "STP Operator (morning)", "L0", "stp", "sup_tech", "stp_m"),
    S("stp_op2", "Imran Pasha", "ground", "STP Operator (evening)", "L0", "stp", "sup_tech", "stp_a"),
    S("stp_op3", "Basavaraj M", "ground", "STP Operator (night)", "L0", "stp", "sup_tech", "stp_n"),
    S("client_sec", "Srinivas Murthy", "client", "Secretary, Lakeshore Greens AOA", "-", null, null, null),
    S("committee", "Kavitha Rao", "client", "Committee member, AOA", "-", null, null, null),
  ];
  NAMES.hk.forEach((nm, i) => out.push(S(`hk_${String(i + 1).padStart(2, "0")}`, `${nm}`, "ground", "Housekeeper", "L0", "housekeeping", "sup_hk", "gen", ["A", "B", "C", "D"][Math.floor(i / 5)])));
  NAMES.guards.forEach((nm, i) => out.push(S(`guard_${String(i + 1).padStart(2, "0")}`, `${nm}`, "ground", "Security Guard", "L0", "security", "sup_sec", ["sec_m", "sec_a", "sec_n"][Math.floor(i / 8)])));
  ["Yellappa", "Sunil", "Anand", "Ganesh"].forEach((nm, i) => out.push(S(`reliever_${i + 1}`, `${nm} (reliever)`, "ground", "Reliever Guard", "L0", "security", "sup_sec", null)));
  ["Shankar", "Prasad", "Mujeeb", "Kumaraswamy", "Rakesh"].forEach((nm, i) => out.push(S(`tech_${i + 1}`, nm, "ground", ["Electrician", "Plumber", "Multi-technician", "Electrician", "Plumber"][i], "L0", "technical", "sup_tech", "gen")));
  ["Thimmaiah", "Rangappa", "Hanumakka"].forEach((nm, i) => out.push(S(`land_${i + 1}`, nm, "ground", "Gardener", "L0", "landscaping", "sup_land", "gen")));
  return out;
}

function buildSOPs(): SOP[] {
  return config.templates.map((t) => ({
    id: t.sop,
    title: `SOP: ${t.name}`,
    service_line: t.service_line,
    template_id: t.id,
    text: `Frequency: ${t.frequency.replace("_", " ")}${t.due_times.length ? ` (due ${t.due_times.join(", ")})` : ""}. Steps: ${t.items.map((i, k) => `${k + 1}) ${i.label}`).join(" ")}. ${t.photo_required ? "Photo proof required." : "No photo required."} Escalate any deviation to the supervisor on WhatsApp.`,
  }));
}

const SL_RATE: Partial<Record<ServiceLineId, number>> = { housekeeping: 0.92, security: 0.93, technical: 0.94, water: 0.94, electromechanical: 0.95, stp: 0.9, landscaping: 0.87 };

export function generateSeed(today: string, seed = SEED): SeedOutput {
  const rng = makeRng(seed);
  const start = addDays(today, -89);
  const simStart = istAt(today, SIM_START_HHMM);
  const db: DB = {
    meta: { seed, generated_at: new Date().toISOString(), today, sim_start: simStart, days: 90 },
    project: buildProject(today),
    locations: [], serviceLines: [
      { id: "housekeeping", name: "Housekeeping" }, { id: "security", name: "Security" }, { id: "technical", name: "Technical / Engineering" },
      { id: "water", name: "Water Pump" }, { id: "stp", name: "STP Operation" }, { id: "landscaping", name: "Landscaping" },
      { id: "electromechanical", name: "Electromechanical" }, { id: "consumables", name: "Consumables" },
    ],
    staff: buildStaff(), shifts: buildShifts(), attendance: [], plannedAttendance: [], sops: buildSOPs(),
    templates: JSON.parse(JSON.stringify(config.templates)), tasks: [], inspections: [], tickets: [], meters: [], meterReadings: [],
    consumables: [], quotations: [], executions: [], rawMessages: [], extracted: [], alerts: [], chat: [], convState: {},
    rainDays: [], audit: [], counters: {},
  };
  db.locations = buildLocations(db);

  // ---------- Plan the planted patterns ----------
  const windowFrom = addDays(today, -14);
  const plan: SeedPlan = {
    today,
    windowFrom,
    plantedInferred: [
      ...[-13, -9, -5].flatMap((o) => ["A", "B"].map((t) => ({ template_id: "hk_staircase", location_id: `${t}-STAIR`, date: addDays(today, o) }))),
      ...[-12, -7, -3].map((o) => ({ template_id: "land_watering", location_id: "GARDEN", date: addDays(today, o) })),
      { template_id: "hk_lift_lobby", location_id: "A-LOBBY", date: addDays(today, -11), slot: "09:30" },
    ],
    forcedCMiss: [addDays(today, -1), addDays(today, -4)],
    shortfallDays: [],
    groupOnlyIssueDate: addDays(today, -6),
  };
  // Basement sweeping inferred completion on the Wednesday inside the window.
  const wed = dateRange(windowFrom, addDays(today, -1)).find((d) => weekday(d) === 3 && d >= addDays(today, -7));
  if (wed) plan.plantedInferred.push({ template_id: "hk_basement", location_id: "BASE-1", date: wed });

  const history = dateRange(start, addDays(today, -1));
  const candidates = rng.shuffle(history.filter((d) => d < addDays(today, -2)));
  plan.shortfallDays = candidates.slice(0, 10).sort();
  if (!plan.shortfallDays.some((d) => d >= addDays(today, -9))) plan.shortfallDays[plan.shortfallDays.length - 1] = addDays(today, -8);
  plan.shortfallDays.sort();

  // Rain days (Bengaluru: wetter Aug–Oct, fewer in Nov).
  for (const d of history) {
    const m = Number(d.slice(5, 7));
    const p = m === 11 ? 0.15 : m === 10 ? 0.35 : 0.3;
    if (rng.chance(p)) db.rainDays.push(d);
  }

  // ---------- Tasks (history) ----------
  const plantedKey = new Set(plan.plantedInferred.map((p) => `${p.template_id}|${p.location_id}|${p.date}|${p.slot ?? ""}`));
  for (const d of history) {
    const tasks = tasksForDate(db, d);
    for (const t of tasks) {
      const tpl = db.templates.find((x) => x.id === t.template_id)!;
      const key = `${t.template_id}|${t.location_id}|${t.date}|`;
      const keySlot = `${t.template_id}|${t.location_id}|${t.date}|${t.slot}`;
      let pDone = SL_RATE[tpl.service_line] ?? 0.9;
      const day = Number(d.slice(8, 10));
      if (t.template_id === "hk_staircase" && t.location_id === "C-STAIR" && weekday(d) === 0) pDone = 0.15;
      if (t.template_id === "sec_patrol" && day >= 24) pDone = 0.55;
      if (t.template_id === "hk_lift_lobby") pDone = 0.95;
      const forcedMiss =
        plantedKey.has(key) || plantedKey.has(keySlot) || (t.template_id === "hk_staircase" && t.location_id === "C-STAIR" && plan.forcedCMiss.includes(d));
      if (forcedMiss) markMissedHistorical(t);
      else settleTask(t, tpl, rng, pDone);
    }
    db.tasks.push(...tasks);
  }

  // ---------- Attendance (history + today's already-started shifts) ----------
  for (const d of history) buildAttendanceDay(db, d, rng, plan.shortfallDays.includes(d), d === addDays(today, -40));
  buildAttendanceDay(db, today, rng, false, false, { securityShifts: [] });
  db.plannedAttendance.push(
    { date: today, shift_id: "sec_m", start_at: istAt(today, "06:00"), guards_present: 8, replacements: 1, applied: false },
    { date: today, shift_id: "sec_a", start_at: istAt(today, "14:00"), guards_present: 7, replacements: 0, applied: false },
    { date: today, shift_id: "sec_n", start_at: istAt(today, "22:00"), guards_present: 8, replacements: 1, applied: false },
  );

  // ---------- Tickets ----------
  buildTickets(db, rng, today, simStart);

  // ---------- Inspections (before the email window; later ones arrive by email) ----------
  for (const off of [-88, -74, -60, -46, -32, -18]) buildInspection(db, addDays(today, off), rng);

  // ---------- Meters ----------
  const meterUploads = buildMeters(db, rng, today);

  // ---------- Consumables & project work ----------
  buildConsumables(db, rng, today);
  buildQuotations(db, today);

  // ---------- Historical alerts for the last 3 days ----------
  for (const t of db.tasks) {
    if (t.status !== "missed" || t.date < addDays(today, -3)) continue;
    const tpl = db.templates.find((x) => x.id === t.template_id)!;
    db.alerts.push({
      id: `ALR-H${db.alerts.length + 1}`, rule_id: "R2", severity: "warning",
      title: `Missed: ${tpl.name}, ${db.locations.find((l) => l.id === t.location_id)?.name}`,
      reason: `Rule R2 fired: due at ${time12(t.due_at)} on ${t.date.split("-").reverse().join("-")} and not completed within the ${tpl.grace_min} min grace period. Assigned to ${db.staff.find((s) => s.id === t.assignee_id)?.name}.`,
      targets: ["supervisor", "fm"], created_at: t.due_at + tpl.grace_min * MIN,
      status: t.date === addDays(today, -1) ? "open" : "resolved",
      notes: t.date === addDays(today, -1) ? [] : [{ at: t.due_at + 26 * HOUR, by: "Priya Nair", text: "Discussed with supervisor in daily huddle." }],
      entity: { type: "task", id: t.id },
    });
  }

  // ---------- Today: live tasks with simulated staff behaviour ----------
  const todays = tasksForDate(db, today);
  const prng = makeRng(hashStr(`day:${today}`));
  for (const t of todays) {
    t.autopilot = planAutopilot(t, prng, 0.95);
    if (t.template_id === "hk_staircase" && (t.location_id === "A-STAIR" || t.location_id === "C-STAIR")) {
      t.autopilot = null;
      t.reserved_for_demo = true;
    }
    if (t.template_id === "hk_staircase" && (t.location_id === "B-STAIR" || t.location_id === "D-STAIR")) t.autopilot = { reply_at: istAt(today, t.location_id === "B-STAIR" ? "08:18" : "08:41"), outcome: "done" };
    if (t.template_id === "stp_log" && t.slot === "10:00") {
      t.autopilot = null;
      t.reserved_for_demo = true;
    }
    if (t.template_id === "sec_handover" || t.template_id === "land_watering") t.autopilot = { reply_at: t.due_at - 12 * MIN, outcome: "done" };
  }
  db.tasks.push(...todays);

  // Run the live engine from midnight to the demo start so phones and alerts look lived-in.
  const w = { db, now: istAt(today, "00:00") };
  advanceTo(w, simStart);

  const { text: whatsappExport } = buildGroupExport(db, plan);
  const emails = buildEmails(db, plan);
  return { db, whatsappExport, emails, meterUploads, plan };
}

// ---------------------------------------------------------------------------

function buildAttendanceDay(db: DB, d: string, rng: Rng, shortfall: boolean, unverifiedDay: boolean, opts: { securityShifts?: string[] } = {}) {
  const at = istAt(d, "06:00");
  const rec = (staff_id: string, shift_id: string, sl: ServiceLineId, status: AttendanceRecord["status"], extra: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
    ...baseFields(db, "ATT", at, "whatsapp_workflow"), staff_id, date: d, shift_id, service_line: sl, status, verified: true, ...extra,
  });
  const secShifts = opts.securityShifts ?? ["sec_m", "sec_a", "sec_n"];
  const shortShift = shortfall ? rng.pick(["sec_m", "sec_a", "sec_n"]) : null;
  const shortCount = shortfall ? rng.int(1, 2) : 0;
  let relieverIdx = 0;
  for (const sh of secShifts) {
    const guards = db.staff.filter((s) => s.id.startsWith("guard_") && s.shift === sh);
    let uncovered = sh === shortShift ? shortCount : 0;
    guards.forEach((g, i) => {
      const forcedAbsent = uncovered > 0 && i >= guards.length - shortCount;
      const absent = forcedAbsent || rng.chance(0.06);
      const verified = !(unverifiedDay && sh === "sec_n");
      if (!absent) {
        db.attendance.push(rec(g.id, sh, "security", rng.chance(0.005) ? "half_day" : "present", { post: i + 1, verified }));
        return;
      }
      db.attendance.push(rec(g.id, sh, "security", "absent", { post: i + 1, verified }));
      if (forcedAbsent) {
        uncovered--;
        return;
      }
      const r = `reliever_${(relieverIdx++ % 4) + 1}`;
      db.attendance.push(rec(r, sh, "security", "replacement", { post: i + 1, replacement_for: g.id, approved: true, verified }));
    });
    const sup = { sec_m: "sup_sec", sec_a: "sec_sup2", sec_n: "sec_sup3" }[sh as "sec_m"];
    db.attendance.push(rec(sup, sh, "security", "present", { verified: !(unverifiedDay && sh === "sec_n") }));
  }
  const sunday = weekday(d) === 0;
  for (const s of db.staff) {
    if (s.id.startsWith("hk_")) {
      // Tower C housekeepers take their weekly off on Sunday with no cover (the staffing gap behind the Sunday misses).
      const off = sunday && s.tower === "C" && Number(s.id.slice(3)) % 5 !== 0;
      db.attendance.push(rec(s.id, "gen", "housekeeping", off || rng.chance(0.05) ? "absent" : "present"));
    } else if (s.id.startsWith("tech_") || s.id === "sup_tech") db.attendance.push(rec(s.id, "gen", "technical", rng.chance(0.04) ? "absent" : "present"));
    else if (s.id.startsWith("land_") || s.id === "sup_land") db.attendance.push(rec(s.id, "gen", "landscaping", rng.chance(0.05) ? "absent" : "present"));
    else if (s.id.startsWith("stp_op")) db.attendance.push(rec(s.id, s.shift!, "stp", rng.chance(0.03) ? "absent" : "present"));
  }
}

// ---------------------------------------------------------------------------

function buildTickets(db: DB, rng: Rng, today: string, simStart: number) {
  type Spec = NewTicket & { created_at: number; ack_after_min: number; resolve_after_min: number | null; progress_note?: string; resolution_note?: string };
  const specs: Spec[] = [];
  const client = { raised_by: "client" as const, raised_by_name: "Srinivas Murthy (Secretary, AOA)", channel: "whatsapp" as const };
  const committee = { raised_by: "resident_committee" as const, raised_by_name: "Kavitha Rao (Committee member)", channel: "whatsapp" as const };
  const internal = { raised_by: "internal" as const, raised_by_name: "Priya Nair (FM)", channel: "dashboard" as const };
  const who = () => {
    const r = rng.next();
    return r < 0.6 ? client : r < 0.75 ? committee : internal;
  };
  const resolveFor = (p: Priority, breach: boolean) => {
    const sla = config.sla[p];
    if (breach) return Math.round(sla.resolution_min * rng.float(1.1, 1.5));
    return p === "P1" ? rng.int(50, 200) : p === "P2" ? rng.int(120, 1300) : rng.int(240, 3600);
  };
  const ackFor = (p: Priority, breach = false) => {
    const r = config.sla[p].response_min;
    return breach ? Math.round(r * rng.float(1.2, 1.6)) : Math.max(2, Math.round(r * rng.float(0.15, 0.85)));
  };
  const at = (d: string, hhmm: string) => istAt(d, hhmm);
  const randTime = () => `${String(rng.int(7, 19)).padStart(2, "0")}:${String(rng.int(0, 59)).padStart(2, "0")}`;
  const history = dateRange(addDays(today, -89), addDays(today, -2));

  // Planted: recurring Tower B lift breakdowns, all reaching L3 (escalation at 2 h, resolved after 2–3.5 h).
  const liftNotes = [
    "Lift stuck between 7th and 8th floor, 2 residents inside. Rescued by AMC technician.",
    "Tower B lift stopped at 11th floor, door not opening.",
    "B tower lift again stuck between floors. Kids inside for 10 min!",
    "Lift in B tower again stuck between 7 and 8 floor. Please check urgently",
  ];
  [-80, -56, -30, -10].forEach((o, i) => {
    specs.push({
      ...client, category: "Lift", priority: "P1", location_id: "TWR-B", description: liftNotes[i], source: "seed",
      created_at: at(addDays(today, o), ["09:15", "18:40", "08:05", "09:15"][i]), ack_after_min: rng.int(4, 12),
      resolve_after_min: rng.int(140, 215), progress_note: "AMC (sample vendor) technician called, ETA 45 min.",
      resolution_note: ["Door sensor re-aligned by AMC.", "Controller card reset; AMC to replace relay.", "Relay replaced by AMC.", "Brake coil adjusted; AMC root-cause report requested."][i],
    });
  });

  // Planted: STP odour complaints near the clubhouse the day after rain (2–3 a month).
  const months = [...new Set(history.map(monthOf))];
  for (const m of months) {
    const rainy = db.rainDays.filter((d) => monthOf(d) === m && addDays(d, 1) <= addDays(today, -2));
    const picks = rng.shuffle(rainy).slice(0, m === monthOf(today) ? 2 : rng.int(2, 3));
    for (const d of picks) {
      const nov = m === monthOf(today);
      specs.push({
        ...(rng.chance(0.7) ? client : committee), category: "STP/Odour", priority: "P2", location_id: "CLUBHOUSE", source: "seed",
        description: rng.pick(["Bad smell near clubhouse again after rain", "Strong sewage odour near clubhouse and pool side", "Clubhouse side drain smelling badly since morning"]),
        created_at: at(addDays(d, 1), randTime()), ack_after_min: ackFor("P2"),
        resolve_after_min: nov && picks.indexOf(d) === 0 ? Math.round(1440 * 1.25) : rng.int(180, 900),
        progress_note: "STP operator checking aeration and the clubhouse inspection chamber.",
        resolution_note: "Storm water had entered the inspection chamber; chamber cleaned, blower 2 run extended, bio-culture dosed.",
      });
    }
  }

  // Generic tickets across categories.
  const pool: { c: TicketCategory; p: Priority; n: number; d: string[]; loc: () => string }[] = [
    { c: "Housekeeping", p: "P3", n: 10, d: ["Garbage not cleared near Tower {T} service lift", "Cobwebs in Tower {T} 9th floor corridor", "Clubhouse washroom not cleaned since morning", "Spit stains in Tower {T} staircase", "Tower {T} lift lobby floor sticky"], loc: () => `${rng.pick(["A", "B", "C", "D"])}-LOBBY` },
    { c: "Plumbing", p: "P2", n: 6, d: ["Water leakage from ceiling in Tower {T} 5th floor corridor", "Tap leaking in clubhouse washroom", "Drain blocked near Tower {T} entrance"], loc: () => `TWR-${rng.pick(["A", "B", "C", "D"])}` },
    { c: "Electrical", p: "P2", n: 6, d: ["Common area lights not working Tower {T} 3rd floor", "Garden lamp posts off near central lawn", "Basement 1 lights flickering"], loc: () => rng.pick(["TWR-A", "TWR-C", "GARDEN", "BASE-1"]) },
    { c: "Water Supply", p: "P1", n: 2, d: ["No water in Tower {T} since morning"], loc: () => `TWR-${rng.pick(["A", "D"])}` },
    { c: "Landscaping", p: "P3", n: 4, d: ["Plants near clubhouse drying", "Grass overgrown near play area"], loc: () => "GARDEN" },
    { c: "Pest Control", p: "P3", n: 3, d: ["Cockroaches in Tower {T} garbage room", "Mosquito problem near STP and garden"], loc: () => rng.pick(["GARBAGE-PT", "GARDEN"]) },
    { c: "Security", p: "P2", n: 3, d: ["Unknown vendor entered without entry at main gate", "Guard not at post near Tower {T} at night"], loc: () => "MAIN-GATE" },
    { c: "Lift", p: "P2", n: 1, d: ["Tower D lift door making grinding noise"], loc: () => "TWR-D" },
  ];
  for (const g of pool) {
    for (let i = 0; i < g.n; i++) {
      const d = rng.pick(history);
      const loc = g.loc();
      const tower = loc.match(/([A-D])/)?.[1] ?? "A";
      const breach = rng.chance(0.12);
      specs.push({
        ...who(), category: g.c, priority: g.p, location_id: loc, source: "seed",
        description: rng.pick(g.d).replace("{T}", tower), created_at: at(d, randTime()),
        ack_after_min: ackFor(g.p, rng.chance(0.08)), resolve_after_min: resolveFor(g.p, breach),
        resolution_note: "Attended and closed by site team.",
      });
    }
  }
  // Forced breaches in the current month (for "which tickets breached SLA this month").
  const m0 = `${monthOf(today)}-0`;
  specs.push(
    { ...client, category: "Plumbing", priority: "P2", location_id: "TWR-C", source: "seed", description: "Water leakage from C tower terrace tank overflow pipe", created_at: at(`${m0}4`, "11:20"), ack_after_min: 35, resolve_after_min: 1700, progress_note: "Plumber waiting for float valve spare.", resolution_note: "Float valve replaced." },
    { ...committee, category: "Housekeeping", priority: "P3", location_id: "C-STAIR", source: "seed", description: "Tower C staircase not cleaned on Sunday again", created_at: at(`${m0}9`, "10:05"), ack_after_min: 300, resolve_after_min: 1500, resolution_note: "Staircase cleaned Monday morning; Sunday cover under discussion." },
  );
  // Open tickets right now.
  specs.push(
    { ...committee, category: "Landscaping", priority: "P3", location_id: "GARDEN", source: "seed", description: "Hedge near Tower D entrance overgrown, blocking walkway", created_at: at(addDays(today, -2), "16:30"), ack_after_min: 50, resolve_after_min: null, progress_note: "Will trim on next mowing day." },
    { ...client, category: "Housekeeping", priority: "P3", location_id: "A-LOBBY", source: "seed", description: "Cobwebs in Tower A 9th floor lobby corridor", created_at: at(addDays(today, -1), "18:05"), ack_after_min: 40, resolve_after_min: null },
    { ...internal, category: "Electrical", priority: "P2", location_id: "TWR-D", source: "seed", description: "Common area light not working near Tower D entrance", created_at: at(today, "06:10"), ack_after_min: 25, resolve_after_min: null },
  );

  specs.sort((a, b) => a.created_at - b.created_at);
  for (const s of specs) {
    const t = buildHistoricalTicket(db, { ...s, as_of: simStart });
    t.number = `LG-${String((db.counters["TKT_NO"] = (db.counters["TKT_NO"] ?? 0) + 1)).padStart(4, "0")}`;
    db.tickets.push(t);
  }
}

// ---------------------------------------------------------------------------

function buildInspection(db: DB, d: string, rng: Rng): Inspection {
  const areas = ["Staircase – Tower A", "Staircase – Tower B", "Staircase – Tower C", "Staircase – Tower D", "Lift lobbies", "Clubhouse washrooms", "Basements", "Central garden", "STP room", "Main gate & register"];
  const notes: Record<string, string[]> = {
    "Staircase – Tower C": ["Landings dusty, mop marks on 9–12th floor", "Not mopped since Saturday", "Cobwebs at mid-landings"],
    "STP room": ["Log book up to date", "Blower 2 vibration noted", "Housekeeping of STP room fair"],
  };
  const scores = areas.map((a) => {
    const base = a === "Staircase – Tower C" ? rng.int(4, 6) : a === "STP room" ? rng.int(6, 8) : rng.int(7, 9);
    return { area: a, score: base, max: 10, note: rng.pick(notes[a] ?? ["Satisfactory", "Good", "Minor dust in corners", "Well maintained"]) };
  });
  const overall = Math.round((scores.reduce((s, x) => s + x.score, 0) / (scores.length * 10)) * 100);
  const ins: Inspection = {
    ...baseFields(db, "INS", istAt(d, "11:00"), "seed"), inspector: "Ramesh Kulkarni", date: d, location_id: "PRJ",
    overall_score: overall, scores, observations: scores.filter((s) => s.score <= 6).map((s) => `${s.area}: ${s.note}`), photos: ["/samples/staircase.svg"],
  };
  db.inspections.push(ins);
  return ins;
}

// ---------------------------------------------------------------------------

export function unitList(): string[] {
  const out: string[] = [];
  for (const t of ["A", "B", "C", "D"]) for (let f = 1; f <= 16; f++) for (let u = 1; u <= 6; u++) out.push(`${t}-${String(f).padStart(2, "0")}${String(u).padStart(2, "0")}`);
  return out;
}

export function meterCycles(today: string): string[] {
  const [y, m] = today.split("-").map(Number);
  const out: string[] = [];
  for (let k = 4; k >= 0; k--) {
    const d = new Date(Date.UTC(y, m - 1 - k, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

const UPLOAD_UNITS = ["B-1204", "A-0302", "A-0705", "B-0601", "C-1103", "C-1506", "D-0204", "D-0902", "C-0805"];

function buildMeters(db: DB, rng: Rng, today: string): MeterUploadLabel[] {
  const cycles = meterCycles(today); // baseline + 3 complete + current
  const current = cycles[cycles.length - 1];
  const units = unitList();
  const at0 = istAt("2024-04-01");
  const vacant = new Set(rng.shuffle(units).slice(0, 5));
  vacant.delete("B-1204");
  const capturers = ["tech_1", "tech_3", "tech_4"];
  // Choose which units are still missing in the current cycle: 72 of 384, including all upload units.
  const missing = new Set<string>(UPLOAD_UNITS);
  for (const u of rng.shuffle(units)) {
    if (missing.size >= 72) break;
    if (!vacant.has(u)) missing.add(u);
  }
  for (const unit of units) {
    const tower = unit[0];
    const serial = `WM-${String(100000 + (hashStr(unit) % 900000)).slice(0, 6)}`;
    const avg = vacant.has(unit) ? 0.2 : rng.float(9, 19);
    let value = Math.round(rng.float(300, 2400) * 10) / 10;
    const meter: Meter = {
      id: `MTR-${unit}`, project_id: PROJECT_ID, created_at: at0, updated_at: at0, source: "seed",
      meter_id: serial, type: "water", unit, location_id: `TWR-${tower}`, multiplier: 1, uom: "KL", last_reading: value,
    };
    let prev: number | null = null;
    const cons: number[] = [];
    cycles.forEach((cy, i) => {
      if (i === cycles.length - 1 && missing.has(unit)) return;
      if (i > 0) {
        const c = vacant.has(unit) ? 0 : Math.round(avg * rng.float(0.8, 1.2) * 10) / 10;
        value = Math.round((value + c) * 10) / 10;
        cons.push(c);
      }
      const isCur = cy === current;
      const day = isCur ? rng.int(10, Math.min(15, Number(today.slice(8, 10)) - 1)) : rng.int(9, 12);
      const consumption = prev === null ? null : Math.round((value - prev) * 10) / 10;
      const flags: string[] = [];
      let status: MeterReading["status"] = "ok";
      if (consumption === 0 && i > 0) {
        flags.push("Zero consumption (vacant flat?)");
        status = isCur ? "needs_review" : "ok";
      }
      db.meterReadings.push({
        id: `MR-${unit}-${cy}`, project_id: PROJECT_ID, created_at: istAt(`${cy}-${String(day).padStart(2, "0")}`, "11:00"), updated_at: istAt(`${cy}-${String(day).padStart(2, "0")}`, "11:00"),
        source: i === 0 ? "seed" : "whatsapp_workflow", meter_id: meter.id, cycle: cy, value, previous: prev, consumption,
        reading_date: `${cy}-${String(day).padStart(2, "0")}`, photo: "/samples/meters/meter_generic.svg", captured_by: rng.pick(capturers),
        confidence: Math.round(rng.float(0.88, 0.99) * 100) / 100, status, flags,
      });
      prev = value;
    });
    meter.last_reading = prev ?? value;
    const last3 = cons.slice(0, 3);
    meter.avg_consumption_3m = last3.length ? Math.round((last3.reduce((s, x) => s + x, 0) / last3.length) * 10) / 10 : 0;
    db.meters.push(meter);
  }
  // Common-area meters (monthly).
  const common: [string, Meter["type"], string, string, string, number, number][] = [
    ["EM-A-COMMON", "electricity_common", "Tower A common", "TWR-A", "kWh", 48210, 2900],
    ["EM-B-COMMON", "electricity_common", "Tower B common", "TWR-B", "kWh", 51034, 3100],
    ["EM-C-COMMON", "electricity_common", "Tower C common", "TWR-C", "kWh", 46790, 2850],
    ["EM-D-COMMON", "electricity_common", "Tower D common", "TWR-D", "kWh", 49902, 3000],
    ["DG-1-HRS", "dg", "DG set 1", "DG-YARD", "h", 1820, 9],
    ["DG-2-HRS", "dg", "DG set 2", "DG-YARD", "h", 1544, 6],
    ["BWM-INLET", "bulk_water_inlet", "Bulk water inlet (tanker + BWSSB)", "PUMP-ROOM", "KL", 88210, 5200],
    ["STP-FLOW", "stp_flow", "STP treated water flow", "STP-ROOM", "KL", 61005, 4100],
  ];
  for (const [serial, type, unit, loc, uom, startV, monthly] of common) {
    let v = startV;
    let prev: number | null = null;
    const m: Meter = { id: `MTR-${serial}`, project_id: PROJECT_ID, created_at: at0, updated_at: at0, source: "seed", meter_id: serial, type, unit, location_id: loc, multiplier: 1, uom, last_reading: v, avg_consumption_3m: monthly };
    cycles.forEach((cy, i) => {
      if (i > 0) v = Math.round(v + monthly * rng.float(0.85, 1.15));
      db.meterReadings.push({
        id: `MR-${serial}-${cy}`, project_id: PROJECT_ID, created_at: istAt(`${cy}-10`, "10:00"), updated_at: istAt(`${cy}-10`, "10:00"), source: i === 0 ? "seed" : "whatsapp_workflow",
        meter_id: m.id, cycle: cy, value: v, previous: prev, consumption: prev === null ? null : v - prev, reading_date: `${cy}-10`, photo: "/samples/meters/meter_generic.svg",
        captured_by: "sup_tech", confidence: 0.97, status: "ok", flags: [],
      });
      prev = v;
    });
    m.last_reading = v;
    db.meters.push(m);
  }
  // Labels for the sample meter photos (used by Mock mode and to render the images).
  const byUnit = (u: string) => db.meters.find((m) => m.unit === u)!;
  const L = (unit: string, reading: number, conf: number, note: string, serialOverride?: string, unitLabel?: string): MeterUploadLabel => ({
    file: `meter_${unit.replace("-", "")}.png`, serial: serialOverride ?? byUnit(unit).meter_id, unit_label: unitLabel ?? unit, reading: Math.round(reading * 10) / 10, confidence: conf, note,
  });
  const up = (u: string, k = 1) => byUnit(u).last_reading + (byUnit(u).avg_consumption_3m ?? 12) * k;
  const labels: MeterUploadLabel[] = [
    L("B-1204", up("B-1204", 3.8), 0.95, "Abnormal jump: ~3.8× the 3-month average (possible leak or misread)"),
    L("A-0302", up("A-0302", 1.05), 0.97, "Normal"),
    L("A-0705", up("A-0705", 0.9), 0.96, "Normal"),
    L("B-0601", up("B-0601", 1.1), 0.98, "Normal"),
    L("C-1103", up("C-1103", 0.95), 0.96, "Normal"),
    L("C-1506", up("C-1506", 1.0), 0.95, "Normal"),
    L("D-0204", up("D-0204", 1.12), 0.97, "Normal"),
    L("D-0902", byUnit("D-0902").last_reading - 7.4, 0.94, "Reading lower than previous (meter replaced or misread)"),
    L("C-0805", up("C-0805", 1.0), 0.62, "Blurred photo, low confidence"),
    { file: "meter_unknown.png", serial: "WM-999999", unit_label: "?-??0?", reading: 742.6, confidence: 0.9, note: "Serial not in meter master, unit label smudged" },
  ];
  return labels;
}

// ---------------------------------------------------------------------------

export const CONSUMABLE_CATALOGUE = [
  { item: "Floor cleaner (5 L can)", unit: "can", rate: 650 },
  { item: "Phenyl (5 L can)", unit: "can", rate: 420 },
  { item: "Garbage bags, large (pack of 50)", unit: "pack", rate: 380 },
  { item: "Hand wash refill (5 L)", unit: "can", rate: 540 },
  { item: "Toilet rolls (pack of 10)", unit: "pack", rate: 360 },
  { item: "Mop refills", unit: "pc", rate: 120 },
  { item: "Chlorine tablets for STP", unit: "kg", rate: 290 },
  { item: "Glass cleaner (5 L)", unit: "can", rate: 480 },
  { item: "Bleaching powder (25 kg bag)", unit: "bag", rate: 1150 },
];

function buildConsumables(db: DB, rng: Rng, today: string) {
  const months = [...new Set(dateRange(addDays(today, -89), addDays(today, -1)).map(monthOf))];
  const prevMonth = months[months.length - 2];
  const curMonth = months[months.length - 1];
  for (const m of months) {
    for (const day of ["03", "10", "17", "24"]) {
      const d = `${m}-${day}`;
      if (d < addDays(today, -89) || d >= today) continue;
      const picks = rng.shuffle(CONSUMABLE_CATALOGUE.slice()).slice(0, 2);
      for (const c of picks) {
        const qty = c.unit === "kg" ? rng.int(10, 25) : c.unit === "bag" ? rng.int(2, 4) : rng.int(6, 24);
        db.consumables.push({
          ...baseFields(db, "CON", istAt(d, "11:30"), "seed"), item: c.item, quantity: qty, unit: c.unit, rate: c.rate, delivery_date: d,
          vendor: "Shree Hygiene Supplies (sample vendor)", acknowledgement: { type: rng.chance(0.6) ? "signature" : "photo", by: "Ravi Kumar", ref: `DC-${d.replace(/-/g, "")}-${c.unit}` },
          billed: m < prevMonth,
        });
      }
    }
  }
  // Planted: 3 unacknowledged deliveries last month, 1 this month.
  const unack = (m: string, n: number) => db.consumables.filter((c) => monthOf(c.delivery_date) === m).slice(-n).forEach((c) => (c.acknowledgement = null));
  unack(prevMonth, 3);
  unack(curMonth, 1);
}

function buildQuotations(db: DB, today: string) {
  const months = [...new Set(dateRange(addDays(today, -89), addDays(today, -1)).map(monthOf))];
  const prev = months[months.length - 2];
  const cur = months[months.length - 1];
  const client = db.project.client_name;
  const mk = (num: string, desc: string, month: string, lines: Quotation["lines"], status: Quotation["approval_status"], approved_on?: string): Quotation => ({
    ...baseFields(db, "QUO", istAt(`${month}-01`, "10:00"), "seed"), number: num, client, description: desc, lines,
    amount: lines.reduce((s, l) => s + l.quantity * l.rate, 0), approval_status: status, approved_on, month,
  });
  const q1 = mk("Q-2026-031", "Seasonal plants for Clubhouse garden", prev, [
    { description: "Seasonal flowering plants (marigold, vinca, petunia) in 8\" pots", quantity: 120, unit: "pots", rate: 85 },
    { description: "Organic compost (25 kg bags)", quantity: 10, unit: "bags", rate: 450 },
  ], "approved", `${prev}-06`);
  const q2 = mk("Q-2026-032", "Fertiliser application for central lawn", prev, [
    { description: "Lawn fertiliser NPK 19:19:19 (5 kg)", quantity: 8, unit: "bags", rate: 640 },
  ], "approved", `${prev}-04`);
  const q3 = mk("Q-2026-033", "Extra housekeeping manpower for Diwali", cur, [
    { description: "Additional housekeepers (man-days)", quantity: 24, unit: "man-days", rate: 900 },
  ], "approved", `${cur}-02`);
  const q4 = mk("Q-2026-034", "Repainting of basement parking markings", cur, [
    { description: "Road marking paint and labour (sq.m)", quantity: 420, unit: "sq.m", rate: 95 },
  ], "submitted");
  db.quotations.push(q1, q2, q3, q4);
  const ex = (q: Quotation, line: number, date: string, qty: number, proof: string | null): ProjectWorkExecution => ({
    ...baseFields(db, "PWE", istAt(date, "15:00"), "seed"), quotation_id: q.id, line_index: line, date, quantity_delivered: qty, proof_photo: proof,
  });
  db.executions.push(
    ex(q1, 0, `${prev}-14`, 60, "/samples/garden.svg"),
    ex(q1, 0, `${prev}-21`, 50, "/samples/garden.svg"),
    ex(q1, 1, `${prev}-14`, 10, "/samples/garden.svg"),
    ex(q2, 0, `${prev}-09`, 8, "/samples/garden.svg"),
    ex(q3, 0, `${cur}-06`, 6, null),
    ex(q3, 0, `${cur}-07`, 6, "/samples/staircase.svg"),
    ex(q3, 0, `${cur}-08`, 6, "/samples/staircase.svg"),
  );
}
