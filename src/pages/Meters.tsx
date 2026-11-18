import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { ArrowDown, ArrowUp, Download, Upload } from "lucide-react";
import { useDB, useStore } from "../store";
import { config } from "../config";
import type { MeterReading } from "../types";
import { currentCycle, exportRows, recordReading, toCSV, validate } from "../engine/meters";
import { meterCycles } from "../engine/generate";
import { processMeterPhotos, sampleMeterPhotos } from "../actions";
import { dmy, monthLabelShort } from "./_fmt";
import { staffName } from "../engine/core";
import { Badge, Button, Card, cx, Empty, PageHeader, Select, Td, Th, Warn } from "../components/ui";

const tone = (r?: MeterReading) => (!r ? "bg-white text-slate-300 border-dashed" : r.status === "ok" ? "bg-emerald-500 text-white" : r.status === "needs_review" ? "bg-amber-400 text-amber-950" : "bg-red-500 text-white");

export default function Meters() {
  const db = useDB();
  const { mutate, now } = useStore();
  const [sp, setSp] = useSearchParams();
  const cycles = meterCycles(db.meta.today).slice(1);
  const [cycle, setCycle] = useState(currentCycle(db));
  const unit = sp.get("unit");
  const water = db.meters.filter((m) => m.type === "water");
  const byMeter = new Map(db.meterReadings.filter((r) => r.cycle === cycle).map((r) => [r.meter_id, r]));
  const captured = water.filter((m) => byMeter.has(m.id)).length;
  const cycleReadings = db.meterReadings.filter((r) => r.cycle === cycle);
  const review = cycleReadings.filter((r) => r.status !== "ok");
  const recent = db.meterReadings.filter((r) => r.created_at >= db.meta.sim_start - 60000 && r.cycle === currentCycle(db) && (r.photo.includes("/meters/meter_") || r.photo.startsWith("data:"))).sort((a, b) => b.created_at - a.created_at);
  const meterOf = (id: string) => db.meters.find((m) => m.id === id);
  const selMeter = unit ? db.meters.find((m) => m.unit === unit) : null;

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const urls = await Promise.all(Array.from(files).map((f) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); })));
    await processMeterPhotos(urls);
  };
  const exportFile = (kind: "csv" | "xlsx") => {
    const { headers, rows } = exportRows(db, cycle);
    const name = config.exportFormat.file_name.replace("{cycle}", cycle);
    if (kind === "csv") {
      const blob = new Blob([toCSV(headers, rows)], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${name}.csv`;
      a.click();
    } else {
      const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Readings");
      XLSX.writeFile(wb, `${name}.xlsx`);
    }
  };

  return (
    <div>
      <PageHeader
        title="Meter reading automation"
        sub="Photo → reading and serial extracted → matched to the unit → validated → billing-ready export."
        actions={
          <>
            <Select label="Cycle" value={cycle} onChange={setCycle} options={cycles.map((c) => ({ value: c, label: monthLabelShort(c) }))} />
            <Button variant="primary" onClick={() => processMeterPhotos(sampleMeterPhotos())}>
              <Upload size={14} /> Upload 10 sample meter photos
            </Button>
            <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              Upload your own
              <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
            </label>
          </>
        }
      />
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-1 flex justify-between text-sm">
          <span className="font-semibold text-slate-800">{captured} of {water.length} water meters captured · {monthLabelShort(cycle)}</span>
          <span className="text-slate-500">{review.filter((r) => r.status === "needs_review").length} need review · {review.filter((r) => r.status === "rejected").length} rejected · {cycleReadings.filter((r) => r.meter_id === "UNMATCHED").length} unmatched</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-emerald-500" style={{ width: `${(captured / water.length) * 100}%` }} />
        </div>
        <p className="mt-1 text-xs text-slate-500">Also sent by technicians on WhatsApp: pick "Manjunath" in the phone and send a meter photo.</p>
      </div>

      {recent.length > 0 && (
        <Card title={`Just captured · ${recent.length} photos`} className="mb-4">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
            {recent.map((r) => {
              const m = meterOf(r.meter_id);
              return (
                <div key={r.id} className={cx("rounded-lg border p-2 text-xs", r.status === "ok" ? "border-emerald-200" : r.status === "rejected" ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50")}>
                  <img src={r.photo} alt="" className="mb-1 h-24 w-full rounded object-cover" />
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{m?.unit ?? "Unmatched"}</span>
                    <Badge tone={r.status === "ok" ? "green" : r.status === "rejected" ? "red" : "amber"}>{r.status.replace("_", " ")}</Badge>
                  </div>
                  <div className="text-slate-600">{m?.meter_id ?? "—"} · {r.value} KL · conf {r.confidence.toFixed(2)}</div>
                  <div className="text-slate-600">{r.previous ?? "–"} → {r.value}{r.consumption !== null ? ` (${r.consumption} KL)` : ""}</div>
                  {r.flags.map((f, i) => <div key={i} className="mt-0.5 text-[11px] text-red-800">⚠ {f}</div>)}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-3">
        <Card title="Reading grid · water meters by tower, floor and unit" className="2xl:col-span-2" action={<span className="flex gap-2 text-[11px] text-slate-500"><span>■ <span className="text-emerald-600">captured</span></span><span className="text-amber-600">■ review</span><span className="text-red-600">■ rejected</span><span>□ missing</span></span>}>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {["A", "B", "C", "D"].map((t) => (
              <div key={t}>
                <div className="mb-1 text-xs font-semibold text-slate-600">Tower {t}</div>
                <div className="grid grid-cols-6 gap-[2px]">
                  {Array.from({ length: 16 }, (_, i) => 16 - i).flatMap((f) =>
                    Array.from({ length: 6 }, (_, u) => {
                      const id = `${t}-${String(f).padStart(2, "0")}${String(u + 1).padStart(2, "0")}`;
                      const r = byMeter.get(`MTR-${id}`);
                      return (
                        <button key={id} onClick={() => setSp({ unit: id })} title={`${id}: ${r ? `${r.value} KL, ${r.status}` : "missing"}`} className={cx("h-4 rounded-[2px] border text-[7px]", tone(r), unit === id && "ring-2 ring-slate-900")} />
                      );
                    }),
                  )}
                </div>
                <div className="mt-0.5 flex justify-between text-[9px] text-slate-400"><span>units 01–06 · floor 16 at top</span></div>
              </div>
            ))}
          </div>
        </Card>
        <Card title={selMeter ? `${selMeter.unit} · ${selMeter.meter_id}` : "Unit history"}>
          {!selMeter ? (
            <Empty title="Click a unit in the grid" />
          ) : (
            <>
              <table className="w-full">
                <thead><tr><Th>Cycle</Th><Th>Reading</Th><Th>Use (KL)</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {db.meterReadings.filter((r) => r.meter_id === selMeter.id).sort((a, b) => a.cycle.localeCompare(b.cycle)).map((r) => (
                    <tr key={r.id}>
                      <Td>{monthLabelShort(r.cycle)}</Td>
                      <Td>{r.value}</Td>
                      <Td>{r.consumption ?? "–"}</Td>
                      <Td><Badge tone={r.status === "ok" ? "green" : r.status === "rejected" ? "red" : "amber"}>{r.status.replace("_", " ")}</Badge></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">3-month average: {selMeter.avg_consumption_3m} KL. Readings must not go down unless the meter was replaced; above 3× average or zero is flagged.</p>
            </>
          )}
        </Card>
      </div>

      <Card title={`Review · ${review.length} readings in ${monthLabelShort(cycle)}`} className="mt-4">
        {review.length === 0 ? (
          <Empty title="Nothing to review" />
        ) : (
          <table className="w-full">
            <thead><tr><Th>Unit</Th><Th>Photo</Th><Th>Prev → Current</Th><Th>Flags</Th><Th>Captured by</Th><Th>Action</Th></tr></thead>
            <tbody>
              {review.map((r) => {
                const m = meterOf(r.meter_id);
                return (
                  <tr key={r.id}>
                    <Td className="font-medium">{m?.unit ?? "UNMATCHED"}</Td>
                    <Td><img src={r.photo} alt="" className="h-10 rounded" /></Td>
                    <Td>{r.previous ?? "–"} → {r.value}{r.consumption !== null ? ` (${r.consumption})` : ""}</Td>
                    <Td className="max-w-md text-xs text-slate-600">{r.flags.join(" ")}</Td>
                    <Td className="text-xs">{staffName(db, r.captured_by)}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {m ? (
                          <>
                            <Button size="sm" variant="success" onClick={() => mutate(() => { r.status = "ok"; r.flags.push(`Approved by reviewer at ${dmy(now)}`); })}>Approve</Button>
                            {r.status === "rejected" && <Button size="sm" onClick={() => mutate(() => { const v = validate(db, m, r.value, r.confidence, r.cycle, { replaced: true }); r.meter_replaced = true; r.status = v.status; r.flags = ["Meter replaced (new meter starts from this reading)."]; r.consumption = null; })}>Meter replaced</Button>}
                            <Button size="sm" variant="ghost" onClick={() => mutate(() => { r.status = "rejected"; r.flags.push("Rejected by reviewer: re-read requested."); })}>Re-read</Button>
                          </>
                        ) : (
                          <AssignUnit onAssign={(u) => mutate((w) => { w.db.meterReadings = w.db.meterReadings.filter((x) => x.id !== r.id); const mm = w.db.meters.find((x) => x.unit === u)!; recordReading(w, { serial: mm.meter_id, unit_label: u, reading: r.value, confidence: Math.max(r.confidence, 0.8) }, { photo: r.photo, captured_by: r.captured_by, engine: "mock" }); })} />
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ExportFormat onExport={exportFile} cycle={cycle} />
        <Card title="Common-area meters">
          <table className="w-full">
            <thead><tr><Th>Meter</Th><Th>Type</Th><Th>{monthLabelShort(cycle)}</Th><Th>Use</Th></tr></thead>
            <tbody>
              {db.meters.filter((m) => m.type !== "water").map((m) => {
                const r = byMeter.get(m.id);
                return (
                  <tr key={m.id}>
                    <Td>{m.unit}<div className="text-[11px] text-slate-400">{m.meter_id}</div></Td>
                    <Td className="text-xs">{m.type.replace(/_/g, " ")}</Td>
                    <Td>{r ? `${r.value} ${m.uom}` : "—"}</Td>
                    <Td>{r?.consumption ?? "–"} {m.uom}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

function AssignUnit({ onAssign }: { onAssign: (unit: string) => void }) {
  const [u, setU] = useState("");
  return (
    <span className="flex gap-1">
      <input value={u} onChange={(e) => setU(e.target.value.toUpperCase())} placeholder="e.g. A-0101" className="w-24 rounded border px-1 text-xs" />
      <Button size="sm" disabled={!/^[A-D]-\d{4}$/.test(u)} onClick={() => onAssign(u)}>Match</Button>
    </span>
  );
}

function ExportFormat({ onExport, cycle }: { onExport: (k: "csv" | "xlsx") => void; cycle: string }) {
  const { mutate } = useStore();
  const cols = config.exportFormat.columns;
  const move = (i: number, d: number) => mutate(() => { const j = i + d; if (j < 0 || j >= cols.length) return; [cols[i], cols[j]] = [cols[j], cols[i]]; });
  return (
    <Card title="Billing export format" action={<div className="flex gap-1"><Button size="sm" onClick={() => onExport("csv")}><Download size={12} /> CSV</Button><Button size="sm" onClick={() => onExport("xlsx")}><Download size={12} /> XLSX</Button></div>}>
      <Warn>Paradigm's billing software format is not known yet. Rename, reorder or hide columns to match its import template (saved for this session; defaults in config/meter_export_format.json).</Warn>
      <table className="mt-2 w-full">
        <thead><tr><Th>On</Th><Th>Field</Th><Th>Column header</Th><Th>Order</Th></tr></thead>
        <tbody>
          {cols.map((c, i) => (
            <tr key={c.key}>
              <Td><input type="checkbox" checked={c.enabled} onChange={(e) => mutate(() => (c.enabled = e.target.checked))} /></Td>
              <Td className="font-mono text-xs text-slate-500">{c.key}</Td>
              <Td><input value={c.header} onChange={(e) => mutate(() => (c.header = e.target.value))} className="w-full rounded border px-1 py-0.5 text-sm" /></Td>
              <Td>
                <button onClick={() => move(i, -1)} className="p-0.5 text-slate-500 hover:text-slate-900"><ArrowUp size={13} /></button>
                <button onClick={() => move(i, 1)} className="p-0.5 text-slate-500 hover:text-slate-900"><ArrowDown size={13} /></button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">File: {config.exportFormat.file_name.replace("{cycle}", cycle)}.csv · dates as {config.exportFormat.date_format}</p>
    </Card>
  );
}
