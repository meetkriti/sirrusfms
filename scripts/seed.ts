// npm run seed  →  writes deterministic sample data for "Lakeshore Greens" (fictional).
// Optional: SEED_TODAY=YYYY-MM-DD npm run seed  (defaults to today's IST date).
import fs from "node:fs";
import path from "node:path";
import { generateSeed } from "../src/engine/generate";
import { istDate } from "../src/lib/time";

const today = process.env.SEED_TODAY ?? istDate(Date.now());
const t0 = Date.now();
const out = generateSeed(today);
const dataDir = path.resolve("public/data");
const meterDir = path.resolve("public/samples/meters");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(meterDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, "seed.json"), JSON.stringify(out.db));
fs.writeFileSync(path.join(dataDir, "whatsapp_export.txt"), out.whatsappExport);
fs.writeFileSync(path.join(dataDir, "emails.json"), JSON.stringify(out.emails, null, 2));
fs.writeFileSync(path.join(meterDir, "labels.json"), JSON.stringify(out.meterUploads, null, 2));

const db = out.db;
const past = db.tasks.filter((t) => t.date < today);
const done = past.filter((t) => t.status === "done" || t.status === "done_late").length;
console.log(`Seeded Lakeshore Greens (sample data) for ${db.meta.days} days ending ${today} in ${Date.now() - t0} ms`);
console.log(`  tasks ${db.tasks.length} (history compliance ${((done / past.length) * 100).toFixed(1)}%), attendance ${db.attendance.length}, tickets ${db.tickets.length}`);
console.log(`  meters ${db.meters.length}, readings ${db.meterReadings.length}, consumables ${db.consumables.length}, quotations ${db.quotations.length}`);
console.log(`  whatsapp export lines ${out.whatsappExport.trim().split("\n").length}, emails ${out.emails.length}, chat ${db.chat.length}, alerts ${db.alerts.length}`);
console.log(`  shortfall days: ${out.plan.shortfallDays.join(", ")}`);
console.log(`  sim clock starts ${new Date(db.meta.sim_start).toISOString()} (07:00 IST)`);
