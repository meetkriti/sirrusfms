// npm run smoke → headless checks of the acceptance criteria against the engine (Mock mode).
import fs from "node:fs";
import type { DB } from "../src/types";
import { advanceTo } from "../src/engine/sim";
import { handleInbound } from "../src/engine/bot";
import { SimulatedAdapter } from "../src/engine/messaging";
import { istAt, addDays } from "../src/lib/time";
import { mockAsk } from "../src/engine/ask";
import { emailsToRaw, mapCandidate, mockExtract, parseWhatsAppExport, threadMessages, applyEvent, importStats } from "../src/engine/extract";
import { recordReading, exportRows, toCSV } from "../src/engine/meters";
import { billingReadiness, invoiceDraft } from "../src/engine/billing";
import { computeInsights } from "../src/engine/patterns";
import { filterTasks, stats } from "../src/engine/metrics";

const db: DB = JSON.parse(fs.readFileSync("public/data/seed.json", "utf8"));
const today = db.meta.today;
const w = { db, now: db.meta.sim_start };
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

// 1. Patterns visible
const past = stats(db, filterTasks(db, { from: addDays(today, -89), to: addDays(today, -1) }), w.now);
check("Overall compliance 86–92%", past.compliance! > 0.86 && past.compliance! < 0.92, `${(past.compliance! * 100).toFixed(1)}%`);
const ins = computeInsights(db, w.now);
check("Insights find Tower B lift, weekday miss, patrol, odour, security", ["lift-b", "weekday-miss", "patrol", "odour", "security"].every((id) => ins.some((i) => i.id === id)), ins.map((i) => i.id).join(","));

// 2. WhatsApp reply updates task
const say = async (who: string, input: { text?: string; buttonId?: string; buttonTitle?: string; photo?: string }) => {
  const wa = new SimulatedAdapter(w);
  const { webhook } = wa.receive(who, input);
  await handleInbound(w, webhook);
};
advanceTo(w, istAt(today, "07:35"));
const stairA = db.tasks.find((t) => t.date === today && t.template_id === "hk_staircase" && t.location_id === "A-STAIR")!;
check("Tower A staircase prompt sent at 07:30", stairA.status === "sent");
await say("sup_hk", { text: "A tower ho gaya sir" });
check("Hinglish 'ho gaya' asks for photo", db.convState.sup_hk?.kind === "awaiting_photo");
await say("sup_hk", { photo: "/samples/staircase.svg" });
check("Photo completes task", stairA.status === "done", stairA.status);

// STP stepwise with out-of-range value
advanceTo(w, istAt(today, "09:05"));
const stp = db.tasks.find((t) => t.date === today && t.template_id === "stp_log" && t.slot === "10:00")!;
await say("stp_op1", { buttonId: `start:${stp.id}`, buttonTitle: "Start log" });
await say("stp_op1", { text: "9.1" });
check("pH 9.1 rejected with range message", /outside 6.5–8.5/.test(db.chat[db.chat.length - 1].text));
await say("stp_op1", { text: "rechecked, dosing pump issue" });
await say("stp_op1", { text: "3150" });
await say("stp_op1", { text: "6" });
await say("stp_op1", { photo: "/samples/stp_outlet.svg" });
check("STP log done with out-of-range flag + R4 alert", stp.status === "done" && db.alerts.some((a) => a.rule_id === "R4"), stp.status);

// 3. Reminder → FM alert → Zonal recurring alert for Tower C
advanceTo(w, istAt(today, "09:01"));
const stairC = db.tasks.find((t) => t.date === today && t.template_id === "hk_staircase" && t.location_id === "C-STAIR")!;
check("R1 reminder at due time", !!stairC.reminded && db.alerts.some((a) => a.rule_id === "R1" && a.entity.id === stairC.id));
advanceTo(w, istAt(today, "09:31"));
check("R2 alert to supervisor+FM after grace", stairC.status === "missed" && db.alerts.some((a) => a.rule_id === "R2" && a.entity.id === stairC.id));
check("R3 recurring miss to Zonal", db.alerts.some((a) => a.rule_id === "R3" && a.entity.id === stairC.id && a.targets.includes("zonal")));

// 4. P1 ticket from client escalates
await say("client_sec", { text: "Lift in B tower again stuck between 7 and 8 floor. Please check urgently" });
const tk = db.tickets[db.tickets.length - 1];
check("P1 Lift ticket created at Tower B", tk.priority === "P1" && tk.category === "Lift" && tk.location_id === "TWR-B", `${tk.number} ${tk.priority} ${tk.category} ${tk.location_id}`);
advanceTo(w, w.now + 31 * 60000);
check("Escalated to L2 at 30 min", tk.level === "L2");
advanceTo(w, w.now + 90 * 60000);
check("Escalated to L3 at 2 h", tk.level === "L3", tk.timeline.map((e) => e.type).join(">"));

// 5. Message intelligence import
const raw = parseWhatsAppExport(fs.readFileSync("public/data/whatsapp_export.txt", "utf8"));
const emails = emailsToRaw(JSON.parse(fs.readFileSync("public/data/emails.json", "utf8")));
db.rawMessages.push(...raw, ...emails);
const rawById = new Map(db.rawMessages.map((m) => [m.id, m]));
const before = db.tasks.filter((t) => t.status === "missed" && t.date < today).length;
for (const th of threadMessages(db.rawMessages)) for (const c of mockExtract(th)) {
  const ev = mapCandidate(w, th, c, "mock");
  db.extracted.push(ev);
  if (ev.review_status === "auto_accepted") applyEvent(w, ev, rawById);
}
const st = importStats(db);
check("WhatsApp export ~300 messages parsed", raw.length > 250, `${raw.length} raw, ${emails.length} emails`);
check("Events extracted, review queue populated", st.events > 100 && st.review > 5, JSON.stringify(st));
check("Inferred completions from group chat", st.inferred >= 10, `${st.inferred} tasks; missed before ${before}, after ${db.tasks.filter((t) => t.status === "missed" && t.date < today).length}`);

// 6. Meters
const labels = JSON.parse(fs.readFileSync("public/samples/meters/labels.json", "utf8"));
for (const l of labels) recordReading(w, { serial: l.serial, unit_label: l.unit_label, reading: l.reading, confidence: l.confidence }, { photo: `/samples/meters/${l.file}`, captured_by: "upload", engine: "mock" });
const b1204 = db.meterReadings.find((r) => r.meter_id === "MTR-B-1204" && r.cycle === today.slice(0, 7));
check("B-1204 anomaly flagged", b1204?.status === "needs_review" && b1204.flags.some((f) => /average/.test(f)), b1204?.flags.join(" "));
const csv = toCSV(...(Object.values(exportRows(db, today.slice(0, 7))) as [string[], Record<string, string | number>[]]));
check("CSV export in configured format", csv.startsWith("Unit No,Meter ID,Meter Type,Previous Reading"), `${csv.split("\n").length - 1} rows`);

// 7. Ask Paradigm
for (const q of ["How did Tower C housekeeping do last week?", "Which tickets breached SLA this month and who owned them?", "How many security man-days are billable for October?", "Which water meters look abnormal this month?", "What keeps going wrong in Tower B?", "Kal STP ka log fill hua tha?", "What was the diesel cost this month?"]) {
  const a = mockAsk(db, w.now, q);
  console.log(`\nQ: ${q}\n${a.text}\n  evidence: ${a.evidence.slice(0, 3).map((e) => e.label).join(" | ")}`);
}

// 8. Billing
const prevMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
const inv = invoiceDraft(db, prevMonth);
const blockers = billingReadiness(db, prevMonth);
check(`${prevMonth} billing: man-days, blocked consumables, variance`, inv.sec.guardBillable > 0 && inv.con.blocked.length === 3 && inv.pw.rows.some((r) => r.variance < 0), `billable ${inv.sec.guardBillable}/${inv.sec.guardContracted}, blocked ${inv.con.blocked.length}, total ₹${inv.total}`);
console.log("  blockers:", blockers.map((b) => b.text).join(" | "));

console.log(`\n${failures ? `${failures} FAILED` : "All checks passed"}`);
process.exit(failures ? 1 : 0);
