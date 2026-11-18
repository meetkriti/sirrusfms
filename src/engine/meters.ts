// M6: meter reading capture → matching → validation → export.
import type { DB, Meter, MeterReading } from "../types";
import { config } from "../config";
import { istDate } from "../lib/time";
import { dmy } from "../lib/format";
import { nid, PROJECT_ID, staffName, type World } from "./core";
import { raiseAlert } from "./alerts";

export interface MeterExtraction {
  serial: string | null;
  unit_label: string | null;
  reading: number | null;
  confidence: number;
}

export const currentCycle = (db: DB) => db.meta.today.slice(0, 7);

export function matchMeter(db: DB, ex: MeterExtraction): { meter: Meter | null; how: string } {
  if (ex.serial) {
    const m = db.meters.find((x) => x.meter_id.toUpperCase() === ex.serial!.toUpperCase().replace(/\s/g, ""));
    if (m) return { meter: m, how: `serial ${m.meter_id}` };
  }
  if (ex.unit_label && /^[A-D]-\d{4}$/.test(ex.unit_label)) {
    const m = db.meters.find((x) => x.unit === ex.unit_label);
    if (m) return { meter: m, how: `unit label ${m.unit} (serial not matched)` };
  }
  return { meter: null, how: "no match in meter master" };
}

export function validate(db: DB, meter: Meter, value: number, confidence: number, cycle: string, opts: { replaced?: boolean } = {}) {
  const prior = db.meterReadings.filter((r) => r.meter_id === meter.id && r.cycle < cycle && r.status !== "rejected").sort((a, b) => b.cycle.localeCompare(a.cycle))[0];
  const previous = prior?.value ?? null;
  const consumption = previous === null ? null : Math.round((value - previous) * 10) / 10;
  const flags: string[] = [];
  let status: MeterReading["status"] = "ok";
  if (consumption !== null && consumption < 0 && !opts.replaced) {
    flags.push(`Reading ${value} is lower than previous ${previous}. Meter replaced? Otherwise a misread.`);
    status = "rejected";
  }
  const avg = meter.avg_consumption_3m ?? 0;
  if (consumption !== null && consumption >= 0) {
    if (avg > 0 && consumption > 3 * avg) {
      flags.push(`Consumption ${consumption} ${meter.uom} is ${(consumption / avg).toFixed(1)}× the 3-month average (${avg} ${meter.uom}). Possible leak or misread.`);
      status = "needs_review";
    }
    if (consumption === 0) {
      flags.push("Zero consumption this cycle (vacant flat or stuck meter?).");
      status = "needs_review";
    }
  }
  if (confidence < 0.8) {
    flags.push(`Extraction confidence ${confidence.toFixed(2)} is below 0.80.`);
    if (status === "ok") status = "needs_review";
  }
  return { previous, consumption, flags, status };
}

/** Store a captured reading (from WhatsApp or batch upload) with matching and validation. */
export function recordReading(w: World, ex: MeterExtraction, ctx: { photo: string; captured_by: string; engine: "mock" | "live" }): { reading: MeterReading; meter: Meter | null; how: string } {
  const db = w.db;
  const cycle = currentCycle(db);
  const { meter, how } = matchMeter(db, ex);
  const base = { id: nid(db, "MR"), project_id: PROJECT_ID, created_at: w.now, updated_at: w.now, source: (ctx.captured_by === "upload" ? "dashboard" : "whatsapp_workflow") as MeterReading["source"] };
  if (!meter || ex.reading === null) {
    const reading: MeterReading = {
      ...base, meter_id: "UNMATCHED", cycle, value: ex.reading ?? 0, previous: null, consumption: null, reading_date: istDate(w.now), photo: ctx.photo, captured_by: ctx.captured_by,
      confidence: ex.confidence, status: "needs_review", flags: [ex.reading === null ? "Reading could not be extracted." : `Meter not found: serial "${ex.serial ?? "?"}", unit label "${ex.unit_label ?? "?"}". Match manually.`],
    };
    db.meterReadings.push(reading);
    return { reading, meter: null, how };
  }
  // Replace any earlier reading for the same meter and cycle.
  db.meterReadings = db.meterReadings.filter((r) => !(r.meter_id === meter.id && r.cycle === cycle));
  const v = validate(db, meter, ex.reading, ex.confidence, cycle);
  const reading: MeterReading = { ...base, meter_id: meter.id, cycle, value: ex.reading, previous: v.previous, consumption: v.consumption, reading_date: istDate(w.now), photo: ctx.photo, captured_by: ctx.captured_by, confidence: ex.confidence, status: v.status, flags: v.flags };
  if (how.startsWith("unit")) reading.flags.push("Matched by unit label only; serial not in master.");
  db.meterReadings.push(reading);
  if (v.status !== "ok" && v.flags.some((f) => /average|lower than previous/.test(f))) {
    raiseAlert(w, {
      rule_id: "M1", severity: "warning", title: `Meter anomaly: ${meter.unit} (${meter.meter_id})`,
      reason: `Meter validation: ${v.flags.join(" ")}`, targets: ["fm", "tech_supervisor", "finance"], entity: { type: "meter", id: reading.id },
    });
  }
  return { reading, meter, how };
}

export function exportRows(db: DB, cycle: string, types: Meter["type"][] = ["water"]) {
  const fmt = config.exportFormat;
  const cols = fmt.columns.filter((c) => c.enabled);
  const meters = new Map(db.meters.map((m) => [m.id, m]));
  const rows = db.meterReadings
    .filter((r) => r.cycle === cycle && (r.meter_id === "UNMATCHED" || types.includes(meters.get(r.meter_id)?.type ?? "water")))
    .sort((a, b) => (meters.get(a.meter_id)?.unit ?? "zz").localeCompare(meters.get(b.meter_id)?.unit ?? "zz"))
    .map((r) => {
      const m = meters.get(r.meter_id);
      const values: Record<string, string | number> = {
        unit: m?.unit ?? "UNMATCHED", meter_id: m?.meter_id ?? "?", meter_type: m?.type ?? "water", previous: r.previous ?? "", current: r.value, consumption: r.consumption ?? "",
        reading_date: dmy(r.reading_date), captured_by: staffName(db, r.captured_by), photo: r.photo, status: r.status, flags: r.flags.join(" | "), confidence: r.confidence,
      };
      return Object.fromEntries(cols.map((c) => [c.header, values[c.key] ?? ""]));
    });
  return { headers: cols.map((c) => c.header), rows };
}

export function toCSV(headers: string[], rows: Record<string, string | number>[]) {
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}
