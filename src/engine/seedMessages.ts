// Generates the "before" world: a noisy site WhatsApp group export and inspection /
// complaint / delivery emails, consistent with the seeded operational data.
import type { DB } from "../types";
import { addDays, dateRange, istAt, MIN, weekday, IST_OFFSET_MS } from "../lib/time";
import { hashStr, makeRng } from "../lib/rng";
import type { SeedPlan } from "./generate";

export interface SeedEmail {
  id: string;
  from: string;
  from_name: string;
  to: string;
  subject: string;
  date: number;
  body: string;
}

interface Line {
  at: number;
  sender: string;
  text: string;
}

export function waStamp(ms: number): string {
  const d = new Date(ms + IST_OFFSET_MS);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(2);
  let h = d.getUTCHours();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `[${dd}/${mm}/${yy}, ${h}:${String(d.getUTCMinutes()).padStart(2, "0")} ${ap}]`;
}

export function buildGroupExport(db: DB, plan: SeedPlan): { text: string; count: number } {
  const lines: Line[] = [];
  const days = dateRange(plan.windowFrom, addDays(plan.today, -1));
  const planted = (tpl: string, loc: string, d: string) => plan.plantedInferred.some((p) => p.template_id === tpl && p.location_id === loc && p.date === d);
  const task = (tpl: string, loc: string, d: string, slot?: string) => db.tasks.find((t) => t.template_id === tpl && t.location_id === loc && t.date === d && (!slot || t.slot === slot));
  const done = (tpl: string, loc: string, d: string, slot?: string) => {
    const t = task(tpl, loc, d, slot);
    return !!t && (t.status === "done" || t.status === "done_late");
  };
  for (const d of days) {
    const r = makeRng(hashStr(`wa:${d}`));
    const T = (hhmm: string, jitter = 6) => istAt(d, hhmm) + r.int(0, jitter) * MIN;
    const add = (at: number, sender: string, text: string) => lines.push({ at, sender, text });

    // Night shift summary (night shift that started the previous evening).
    const night = db.attendance.filter((a) => a.date === addDays(d, -1) && a.shift_id === "sec_n" && a.staff_id.startsWith("guard_"));
    const nAbs = night.filter((a) => a.status === "absent").length;
    const nRep = db.attendance.filter((a) => a.date === addDays(d, -1) && a.shift_id === "sec_n" && a.status === "replacement").length;
    if (night.length) {
      add(T("06:05", 15), "Raghu Night Sup", nAbs === 0 ? `Night shift 8 guards reported, all posts ok` : `Night shift ${8 - nAbs + nRep} guards reported, ${nAbs} absent${nRep ? ` replacement arranged` : `, post vacant`}`);
      if (done("sec_patrol", "PRJ", d)) add(T("06:12", 5), "Raghu Night Sup", r.pick(["Patrol rounds 12 checkpoints done", "Night patrol done all checkpoints sir", "rounds complete 12/12"]));
    }
    // Greetings and noise.
    add(T("06:40", 15), "Ravi HK Sup", "Good morning sir 🙏");
    if (r.chance(0.7)) add(T("06:45", 15), "Priya FM", r.pick(["Good morning all", "Good morning team 🙏", "GM all, pls share updates on time"]));
    if (r.chance(0.5)) add(T("06:50", 20), "Anil Security", "🙏🙏");
    // Morning security shift.
    const morning = db.attendance.filter((a) => a.date === d && a.shift_id === "sec_m" && a.staff_id.startsWith("guard_"));
    const mAbs = morning.filter((a) => a.status === "absent").length;
    const mRep = db.attendance.filter((a) => a.date === d && a.shift_id === "sec_m" && a.status === "replacement").length;
    add(T("07:05", 10), "Anil Security", mAbs === 0 ? "Morning shift 8 guards reported. All posts manned" : `Morning shift ${8 - mAbs + mRep} guards on duty, ${mAbs} leave${mRep ? `, reliever arranged` : `, 1 post vacant`}`);
    // Garden watering.
    if (planted("land_watering", "GARDEN", d) || (done("land_watering", "GARDEN", d) && r.chance(0.35))) add(T("07:35", 15), "Venkatesh Garden", r.pick(["Garden watering done", "watering done sir lawn and pots", "Garden ki watering ho gaya"]));
    // Staircases.
    const towers = ["A", "B", "C", "D"];
    const stairDone = towers.filter((t) => done("hk_staircase", `${t}-STAIR`, d) || planted("hk_staircase", `${t}-STAIR`, d));
    const anyPlanted = towers.some((t) => planted("hk_staircase", `${t}-STAIR`, d));
    if (anyPlanted || r.chance(0.6)) {
      const missC = !stairDone.includes("C");
      let msg = stairDone.length === 4 ? r.pick(["All towers stairs done sir 👍", "A B C D stairs mopping done", "Stairs cleaning done all 4 towers"]) : `Tower ${stairDone.join(" ")} stairs done sir`;
      if (missC) msg += r.pick([". C tower staff leave today", ". C tower pending, staff leave", ". C tower ki staff nahi aaya"]);
      const at = T("08:50", 25);
      add(at, "Ravi HK Sup", msg);
      add(at + r.int(1, 3) * MIN, "Ravi HK Sup", "<photo>");
      if (missC && r.chance(0.6)) add(T("09:20", 10), "Priya FM", "Ravi pls arrange someone for C tower today itself");
    }
    if (planted("hk_lift_lobby", "A-LOBBY", d)) add(T("09:25", 4), "Ravi HK Sup", "A tower lift lobby and lift car cleaning done");
    else if (r.chance(0.25)) add(T("09:40", 15), "Ravi HK Sup", "Lift lobby cleaning done all towers");
    if (planted("hk_basement", "BASE-1", d)) {
      const at = T("10:40", 10);
      add(at, "Ravi HK Sup", "Basement 1 sweeping done sir");
      add(at + MIN, "Ravi HK Sup", "<photo>");
    }
    // Pump room.
    const pump = task("tech_pump", "PUMP-ROOM", d);
    if (pump && (pump.status === "done" || pump.status === "done_late") && r.chance(0.7)) add(T("08:25", 10), "Manjunath Tech", `Pump room ok. Pressure ${pump.responses.pressure} bar, run ${pump.responses.run_hours} hrs`);
    // STP morning readings.
    const stp = task("stp_log", "STP-ROOM", d, "10:00");
    if (stp && (stp.status === "done" || stp.status === "done_late")) {
      const noise = r.chance(0.2);
      const at = T("09:55", 15);
      add(at, "Suresh STP", `pH ${stp.responses.ph} MLSS ${stp.responses.mlss} outlet clear.${noise ? " Blower 2 noise coming" : ""}`);
      add(at + r.int(1, 2) * MIN, "Suresh STP", "<photo>");
      if (noise) add(T("10:20", 10), "Priya FM", "@Manjunath pls check blower 2 today");
    }
    const stpE = task("stp_log", "STP-ROOM", d, "18:00");
    if (stpE && (stpE.status === "done" || stpE.status === "done_late") && r.chance(0.4)) add(T("17:55", 10), "Imran STP", `evening log pH ${stpE.responses.ph} mlss ${stpE.responses.mlss} ok`);
    // DG on Saturday, mowing on Friday.
    if (weekday(d) === 6 && done("tech_dg", "DG-YARD", d)) {
      const dg = task("tech_dg", "DG-YARD", d)!;
      add(T("10:50", 20), "Manjunath Tech", `DG 1 test run done ${dg.responses.run_min} min, diesel ${dg.responses.fuel}%`);
    }
    if (weekday(d) === 5 && done("land_mowing", "GARDEN", d)) add(T("15:40", 20), "Venkatesh Garden", r.pick(["Lawn mowing done, hedge trimming tomorrow", "Grass cutting done central lawn"]));
    // Tickets raised that day on WhatsApp appear in the group too.
    for (const tk of db.tickets.filter((t) => t.channel === "whatsapp" && new Date(t.created_at + IST_OFFSET_MS).toISOString().slice(0, 10) === d)) {
      const sender = tk.raised_by_name.startsWith("Kavitha") ? "Kavitha Committee" : "Secretary LG";
      add(tk.created_at, sender, tk.description);
      const ownerAlias = tk.category === "Housekeeping" ? "Ravi HK Sup" : tk.category === "Security" ? "Anil Security" : tk.category === "Landscaping" ? "Venkatesh Garden" : "Manjunath Tech";
      if (tk.acknowledged_at) add(tk.acknowledged_at, ownerAlias, r.pick(["Checking sir", "Ok sir, attending", "Noted sir, team sent", tk.category === "Lift" ? "Checking sir, AMC person called" : "On it sir"]));
      if (tk.resolved_at && tk.resolved_at < istAt(d, "23:59")) add(tk.resolved_at, ownerAlias, r.pick(["Done sir, issue solved", "Completed sir, pls check", tk.category === "Lift" ? "Lift working now sir" : "Rectified sir"]));
    }
    if (d === plan.groupOnlyIssueDate) {
      add(T("19:10", 5), "Secretary LG", "Water dripping from B tower terrace pipe near 16th floor, pls check");
      add(T("19:25", 5), "Manjunath Tech", "Will check tomorrow morning sir, nale first thing");
    }
    // Consumable deliveries.
    for (const c of db.consumables.filter((x) => x.delivery_date === d)) {
      const at = T("11:35", 20);
      add(at, "Ravi HK Sup", `Received ${c.item.split(" (")[0].toLowerCase()} ${c.quantity} ${c.unit}${c.quantity > 1 ? "s" : ""} from Shree Hygiene`);
      if (c.acknowledgement) add(at + MIN, "Ravi HK Sup", "<photo>");
    }
    // Afternoon and evening security.
    const aft = db.attendance.filter((a) => a.date === d && a.shift_id === "sec_a" && a.staff_id.startsWith("guard_"));
    const aAbs = aft.filter((a) => a.status === "absent").length;
    const aRep = db.attendance.filter((a) => a.date === d && a.shift_id === "sec_a" && a.status === "replacement").length;
    if (aAbs !== aRep || r.chance(0.5)) add(T("14:20", 15), "Anil Security", aAbs === aRep ? "Afternoon shift full strength 8 guards" : `Afternoon shift ${8 - aAbs + aRep} guards only, ${aAbs - aRep} post vacant sir`);
    if (r.chance(0.6)) add(T("18:30", 25), "Anil Security", r.pick(["Night shift 7 guards reported, 1 absent replacement arranged", "Visitor register checked ok", "Vehicle register updated"]));
    // Pure noise.
    if (r.chance(0.45)) add(T("12:10", 200), r.pick(["Anil Security", "Ravi HK Sup", "Manjunath Tech"]), r.pick([
      "Forwarded: Good afternoon 🌸🌸",
      "Forwarded: BESCOM power shutdown tomorrow 10 AM to 2 PM in Whitefield sub-division",
      "Forwarded: Traffic diversion on ORR near Marathahalli bridge",
      "Forwarded: Happy Kannada Rajyotsava 💛❤️",
    ]));
    if (r.chance(0.3)) add(T("15:00", 120), r.pick(["Anil Security", "Raghu Night Sup"]), "<voice note>");
    if (r.chance(0.5)) add(T("13:30", 60), "Ravi HK Sup", r.pick(["Clubhouse washroom cleaning done", "Garbage handed over to BBMP vehicle", "Kasa segregation done sir"]));
    if (r.chance(0.4)) add(T("20:05", 30), "Anil Security", r.pick(["Visitor register checked, all entries ok", "Main gate CCTV working fine", "Delivery boys stopped at gate as per rule"]));
    if (r.chance(0.35)) add(T("21:30", 40), "Priya FM", r.pick(["Tomorrow inspection by QA team, pls keep logs ready", "Good work team today 👏", "Pls ensure STP log photos daily"]));
    for (let k = 0; k < r.int(3, 6); k++) add(T("12:00", 420), r.pick(["Priya FM", "Ravi HK Sup", "Manjunath Tech", "Anil Security"]), r.pick(["ok", "Noted", "👍", "ok sir", "Noted sir", "Pls share photos also", "Thanks"]));
  }
  lines.sort((a, b) => a.at - b.at);
  const text = lines.map((l) => `${waStamp(l.at)} ${l.sender}: ${l.text}`).join("\n") + "\n";
  return { text, count: lines.length };
}

export function buildEmails(db: DB, plan: SeedPlan): SeedEmail[] {
  const out: SeedEmail[] = [];
  const W = (off: number) => addDays(plan.today, off);
  let n = 0;
  const E = (date: string, hhmm: string, from: string, from_name: string, subject: string, body: string) =>
    out.push({ id: `EML-${String(++n).padStart(3, "0")}`, from, from_name, to: "fm.lakeshore@paradigm.example", subject, date: istAt(date, hhmm), body });
  const insp = (off: number, c: number, stp: number) => {
    const d = W(off);
    const rows = [
      ["Staircase – Tower A", 8, "Clean, minor dust at landings"],
      ["Staircase – Tower B", 8, "Good"],
      ["Staircase – Tower C", c, c <= 5 ? "Landings dusty, not mopped since weekend" : "Fair, cobwebs at mid-landings"],
      ["Staircase – Tower D", 9, "Well maintained"],
      ["Lift lobbies", 8, "Glass smudges in B lobby"],
      ["Clubhouse washrooms", 7, "Hand wash refill empty in gents"],
      ["Basements", 7, "Oil stains near B2 ramp"],
      ["Central garden", 8, "Healthy, hedge near D overgrown"],
      ["STP room", stp, stp <= 6 ? "Blower 2 vibration and noise, log book ok" : "Log book up to date"],
      ["Main gate & register", 9, "Register complete"],
    ] as const;
    const overall = Math.round((rows.reduce((s, r) => s + r[1], 0) / 100) * 100);
    E(d, "17:30", "ramesh.kulkarni@paradigm.example", "Ramesh Kulkarni", `Site inspection report – Lakeshore Greens – ${d.split("-").reverse().join("-")}`,
      `Dear Priya,\n\nPlease find the inspection summary for Lakeshore Greens (visit on ${d.split("-").reverse().join("-")}).\n\nOverall score: ${overall}%\n\n${rows.map((r) => `${r[0]}: ${r[1]}/10 – ${r[2]}`).join("\n")}\n\nKey observations:\n- ${c <= 6 ? "Tower C staircase needs attention, especially after weekends." : "Housekeeping standards maintained."}\n- ${stp <= 6 ? "Blower 2 noise at STP to be checked by technical team." : "STP parameters within range."}\n\nRegards,\nRamesh Kulkarni\nQuality & Audit Head`);
  };
  insp(-13, 5, 7);
  insp(-10, 6, 6);
  insp(-6, 7, 6);
  insp(-2, 4, 8);
  const odour = db.tickets.find((t) => t.category === "STP/Odour" && t.created_at >= istAt(plan.windowFrom));
  E(odour ? new Date(odour.created_at + IST_OFFSET_MS).toISOString().slice(0, 10) : W(-11), "13:10", "secretary.lakeshoregreens@example.org", "Srinivas Murthy",
    "Complaint: sewage smell near clubhouse",
    "Dear Paradigm team,\n\nFor the third time in recent weeks there is a strong sewage smell near the clubhouse and pool after the rain. Residents are unable to use the clubhouse in the evening. Please treat this as urgent and share the root cause and corrective action.\n\nRegards,\nSrinivas Murthy\nSecretary, Lakeshore Greens AOA");
  E(W(-7), "10:45", "secretary.lakeshoregreens@example.org", "Srinivas Murthy", "Dried plants near clubhouse",
    "Dear Priya,\n\nSeveral of the new seasonal plants near the clubhouse entrance have dried up. These were installed only last month. Please check watering and replace the dead plants.\n\nThanks,\nSrinivas");
  E(W(-4), "21:05", "kavitha.rao@example.org", "Kavitha Rao", "Guards using mobile at main gate",
    "Hello,\n\nI noticed the guards at the main gate busy on their mobile phones at around 8:30 PM yesterday and visitors were walking in without entry. Please look into it.\n\nKavitha Rao\nCommittee member");
  const deliveries = db.consumables.filter((c) => c.delivery_date >= plan.windowFrom && c.delivery_date < plan.today);
  const byDate = new Map<string, typeof deliveries>();
  deliveries.forEach((c) => byDate.set(c.delivery_date, [...(byDate.get(c.delivery_date) ?? []), c]));
  for (const [d, items] of byDate) {
    const acked = items.every((i) => i.acknowledgement);
    E(d, "12:15", "dispatch@shreehygiene.example", "Shree Hygiene Supplies (sample vendor)", `Delivery note DN-${d.replace(/-/g, "")} – Lakeshore Greens`,
      `Delivery note DN-${d.replace(/-/g, "")}\nSite: Lakeshore Greens, Bengaluru\nDate: ${d.split("-").reverse().join("-")}\n\n${items.map((i) => `${i.item} – Qty ${i.quantity} ${i.unit} @ Rs ${i.rate}`).join("\n")}\n\nReceived by: ${acked ? "Ravi Kumar (signed)" : "______ (signature pending)"}\n\nShree Hygiene Supplies`);
  }
  E(W(-4), "16:20", "service@liftamc.example", "Lift AMC (sample vendor)", "AMC visit report – Lakeshore Greens – Tower B",
    "Visit date: " + W(-4).split("-").reverse().join("-") + "\nTower B lift: door sensor cleaned, brake coil adjusted. Recommend controller board replacement (quotation to follow). Towers A, C, D: routine checks ok.\n\nTechnician: S. Kumar");
  E(W(-8), "18:00", "ops@paradigm.example", "Security agency desk", "Security attendance shortfall",
    `Shortfall noted on ${plan.shortfallDays.filter((d) => d >= plan.windowFrom).map((d) => d.split("-").reverse().join("-")).join(", ") || "n/a"}: 1 guard short in one shift. Reliever pool is stretched due to festival leave.`);
  E(W(-12), "09:30", "secretary.lakeshoregreens@example.org", "Srinivas Murthy", "Approved: Q-2026-033 Diwali extra manpower",
    "Dear Priya,\n\nThe committee approves quotation Q-2026-033 for 6 extra housekeepers for 4 days during Diwali.\n\nRegards,\nSrinivas Murthy");
  E(W(-3), "08:00", "newsletter@paradigm.example", "Paradigm HSE Desk", "Monthly HSE newsletter – November",
    "This month: ladder safety, PPE for STP operators, and festival fire safety tips. Please circulate to site teams.");
  E(W(-9), "19:45", "fm.lakeshore@paradigm.example", "Priya Nair", "Weekly site report – Lakeshore Greens",
    "Team,\n\nWeek summary: housekeeping on track except Tower C staircase on Sunday (staff weekly off without cover). STP blower 2 noise under observation. Security short by 1 guard on one shift during the week. Diwali extra manpower deployed as per approved quotation.\n\nPriya");
  E(W(-1), "11:20", "kavitha.rao@example.org", "Kavitha Rao", "Request: pest control schedule",
    "Hi Priya,\n\nCould you share the pest control schedule for this month? Residents in Tower A report cockroaches near the garbage room.\n\nKavitha");
  return out.sort((a, b) => a.date - b.date).slice(0, 15);
}
