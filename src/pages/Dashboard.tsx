import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bar, BarChart, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useDB, useStore } from "../store";
import type { ServiceLineId, TaskInstance } from "../types";
import { addDays, dateRange, istDate, weekday, WEEKDAYS } from "../lib/time";
import { dayLabel, pct, shortDate, time12, dmy } from "../lib/format";
import { cellState, filterTasks, heatmapRows, securityDays, slaBreachesInMonth, staffAttendance, stats, trend } from "../engine/metrics";
import { ACTIVE_TICKET } from "../engine/tickets";
import { taskTitle, locationName } from "../engine/core";
import { currentCycle } from "../engine/meters";
import { Card, cx, Kpi, Modal, PageHeader, Select, STATUS_META, Empty } from "../components/ui";
import TaskDetail from "../components/TaskDetail";
import TodayBoard from "../components/TodayBoard";

const SL_OPTIONS: { value: ServiceLineId | "all"; label: string }[] = [
  { value: "all", label: "All service lines" },
  { value: "housekeeping", label: "Housekeeping" },
  { value: "security", label: "Security" },
  { value: "technical", label: "Technical" },
  { value: "water", label: "Water pump" },
  { value: "stp", label: "STP" },
  { value: "landscaping", label: "Landscaping" },
  { value: "electromechanical", label: "Electromechanical" },
];

export default function Dashboard() {
  const db = useDB();
  const now = useStore((s) => s.now);
  const today = istDate(now);
  const [sp, setSp] = useSearchParams();
  const range = sp.get("range") ?? "30";
  const to = sp.get("to") ?? today;
  const from = sp.get("from") ?? addDays(to, -(Number(range) - 1));
  const sl = (sp.get("sl") ?? "all") as ServiceLineId | "all";
  const tower = sp.get("tower") ?? "all";
  const shift = (sp.get("shift") ?? "all") as "all";
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (k === "range") {
      n.delete("from");
      n.delete("to");
    }
    n.set(k, v);
    setSp(n, { replace: true });
  };
  const [cell, setCell] = useState<TaskInstance[] | null>(null);

  const f = { from, to, serviceLine: sl, tower, shift };
  const rangeStats = stats(db, filterTasks(db, f), now);
  const todayStats = stats(db, filterTasks(db, { ...f, from: today, to: today }), now);
  const open = db.tickets.filter((t) => ACTIVE_TICKET.has(t.status));
  const byP = (p: string) => open.filter((t) => t.priority === p).length;
  const breaches = slaBreachesInMonth(db, today.slice(0, 7));
  const secToday = securityDays(db, today, today)[0];
  const startedShifts = secToday?.shifts.length ?? 0;
  const cycle = currentCycle(db);
  const waterMeters = db.meters.filter((m) => m.type === "water");
  const captured = new Set(db.meterReadings.filter((r) => r.cycle === cycle && r.meter_id.startsWith("MTR-") && waterMeters.some((m) => m.id === r.meter_id)).map((r) => r.meter_id)).size;
  const rev = useStore((s) => s.rev);
  const heat = useMemo(() => heatmapRows(db, f), [db, from, to, sl, tower, shift, rev]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader
        title="Operations dashboard · Lakeshore Greens"
        sub={`Bengaluru East · 4 towers, 384 units · ${dmy(from)} to ${dmy(to)}. Every number links to the records behind it.`}
        actions={
          <>
            <Select label="Range" value={sp.get("from") ? "custom" : range} onChange={(v) => v !== "custom" && set("range", v)} options={[{ value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" }, ...(sp.get("from") ? [{ value: "custom", label: `${dmy(from)} – ${dmy(to)}` }] : [])]} />
            <Select label="Service line" value={sl} onChange={(v) => set("sl", v)} options={SL_OPTIONS} />
            <Select label="Tower" value={tower} onChange={(v) => set("tower", v)} options={[{ value: "all", label: "All" }, ...["A", "B", "C", "D"].map((t) => ({ value: t, label: `Tower ${t}` }))]} />
            <Select label="Shift" value={shift} onChange={(v) => set("shift", v)} options={[{ value: "all", label: "All" }, { value: "morning", label: "Morning" }, { value: "afternoon", label: "Afternoon" }, { value: "night", label: "Night" }] as never} />
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Checklist compliance" value={rangeStats.compliance === null ? "–" : pct(rangeStats.compliance, 1, 1)} sub={`${rangeStats.done + rangeStats.late} of ${rangeStats.done + rangeStats.late + rangeStats.missed} settled tasks`} tone={rangeStats.compliance !== null && rangeStats.compliance < 0.85 ? "amber" : "green"} to={`/tasks?from=${from}&to=${to}&sl=${sl}&tower=${tower}`} />
        <Kpi label="On-time" value={rangeStats.onTime === null ? "–" : pct(rangeStats.onTime, 1, 1)} sub={`${rangeStats.late} done late`} to={`/tasks?from=${from}&to=${to}&status=done_late`} />
        <Kpi label="Missed today" value={todayStats.missed} sub={`${todayStats.done + todayStats.late} done · ${todayStats.pending} pending`} tone={todayStats.missed ? "red" : "green"} to={`/tasks?from=${today}&to=${today}&status=missed`} />
        <Kpi label="Open tickets" value={open.length} sub={`P1 ${byP("P1")} · P2 ${byP("P2")} · P3 ${byP("P3")}`} tone={byP("P1") ? "red" : "slate"} to="/tickets?status=open" />
        <Kpi label="SLA breaches (month)" value={breaches.length} sub="response or resolution" tone={breaches.length ? "amber" : "green"} to="/tickets?breached=1" />
        <Kpi label="Security today" value={secToday ? `${secToday.onDuty}/${secToday.contracted}` : "–"} sub={`guards on duty vs contract (${startedShifts} shift${startedShifts === 1 ? "" : "s"} started)`} tone={secToday?.below ? "red" : "green"} to="#attendance" />
        <Kpi label="Meter readings" value={`${captured}/${waterMeters.length}`} sub={`water meters captured, cycle ${cycle}`} tone={captured < waterMeters.length ? "amber" : "green"} to="/meters" />
      </div>

      <Card title="Today's board" className="mb-4" action={<Link to="/tasks" className="text-xs text-accent-600 hover:underline">All tasks →</Link>}>
        <TodayBoard compact filter={(t) => (sl === "all" || db.templates.find((x) => x.id === t.template_id)?.service_line === sl) && (tower === "all" || t.location_id.startsWith(tower + "-") || t.location_id === `TWR-${tower}`)} />
      </Card>

      <Card title={`Compliance heatmap · ${heat.days.length} days`} className="mb-4" action={<Legend />}>
        {heat.rows.length === 0 ? (
          <Empty title="No checklists match these filters" />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="border-separate border-spacing-[2px] text-[10px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white" />
                  {heat.days.map((d) => (
                    <th key={d} className={cx("w-5 font-normal text-slate-400", weekday(d) === 0 && "text-slate-700")} title={dayLabel(d)}>
                      <div>{WEEKDAYS[weekday(d)][0]}</div>
                      <div>{d.slice(8)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heat.rows.map((r) => (
                  <tr key={r.key}>
                    <td className="sticky left-0 z-10 max-w-[260px] truncate whitespace-nowrap bg-white pr-2 text-xs text-slate-600" title={r.label}>
                      {r.label}
                    </td>
                    {heat.days.map((d) => {
                      const c = r.cells[d];
                      const st = cellState(c);
                      const m = STATUS_META[st];
                      return (
                        <td key={d}>
                          <button disabled={!c} onClick={() => setCell(c!)} className={cx("flex h-5 w-5 items-center justify-center rounded-sm", m.cell, c && "hover:ring-2 hover:ring-slate-700")} title={`${r.label} · ${dayLabel(d)} · ${m.label}${c && c.length > 1 ? ` (${c.length} slots)` : ""}`}>
                            {st !== "na" && st !== "done" ? m.icon : null}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {(["housekeeping", "security", "technical", "water", "stp", "landscaping", "electromechanical"] as ServiceLineId[]).map((s) => (
          <ServiceLineCard key={s} sl={s} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <AttendancePanel from={addDays(to, -29)} to={to} />
        <EvidenceGallery />
      </div>

      <Modal open={!!cell} onClose={() => setCell(null)} title={cell ? `${taskTitle(db, cell[0].template_id, cell[0].location_id)} · ${dayLabel(cell[0].date)}` : ""} wide>
        <div className="space-y-3">{cell?.map((t) => <TaskDetail key={t.id} task={db.tasks.find((x) => x.id === t.id)!} />)}</div>
      </Modal>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
      {(["done", "late", "missed", "pending", "na"] as const).map((k) => (
        <span key={k} className="flex items-center gap-1">
          <span className={cx("inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm", STATUS_META[k].cell)}>{k !== "done" && k !== "na" ? STATUS_META[k].icon : null}</span>
          {STATUS_META[k].label}
        </span>
      ))}
    </div>
  );
}

const SL_NAMES: Record<string, string> = { housekeeping: "Housekeeping", security: "Security", technical: "Technical", water: "Water pump", stp: "STP operation", landscaping: "Landscaping", electromechanical: "Electromechanical (DG)" };

function ServiceLineCard({ sl }: { sl: ServiceLineId }) {
  const db = useDB();
  const now = useStore((s) => s.now);
  const today = istDate(now);
  const data = trend(db, sl, 30, today, now);
  const s30 = stats(db, filterTasks(db, { from: addDays(today, -29), to: today, serviceLine: sl }), now);
  const s7 = stats(db, filterTasks(db, { from: addDays(today, -6), to: today, serviceLine: sl }), now);
  return (
    <Link to={`/dashboard?sl=${sl}&range=30`} className="block rounded-xl border border-slate-200 bg-white p-3 shadow-sm hover:border-accent-500/50">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-semibold text-slate-700">{SL_NAMES[sl]}</div>
        <div className={cx("text-lg font-semibold", (s30.compliance ?? 1) < 0.88 ? "text-amber-700" : "text-emerald-700")}>{s30.compliance === null ? "–" : pct(s30.compliance, 1, 1)}</div>
      </div>
      <div className="text-[11px] text-slate-500">
        30 days · {s30.missed} missed · last 7 days {s7.compliance === null ? "–" : pct(s7.compliance, 1, 0)}
      </div>
      <div className="h-10">
        <ResponsiveContainer>
          <LineChart data={data}>
            <YAxis hide domain={[50, 100]} />
            <Line type="monotone" dataKey="value" stroke="#1d4ed8" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
            <Tooltip formatter={(v) => [`${v}%`, "Compliance"]} labelFormatter={(_, p) => (p?.[0] ? dayLabel(p[0].payload.date) : "")} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Link>
  );
}

function AttendancePanel({ from, to }: { from: string; to: string }) {
  const db = useDB();
  const days = securityDays(db, from, to);
  const below = days.filter((d) => d.below);
  const others = staffAttendance(db, to);
  const data = days.map((d) => ({ date: d.date, label: shortDate(d.date), onDuty: d.onDuty, contracted: d.contracted, below: d.below }));
  return (
    <Card id="attendance" title="Security headcount vs contract · last 30 days" action={<Link to={`/billing?month=${to.slice(0, 7)}#security`} className="text-xs text-accent-600 hover:underline">Billing impact →</Link>}>
      <div className="h-44">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ left: -20, right: 4 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={3} />
            <YAxis domain={[18, 26]} tick={{ fontSize: 10 }} />
            <ReferenceLine y={24} stroke="#334155" strokeDasharray="4 3" label={{ value: "Contract 24", fontSize: 10, position: "insideTopRight" }} />
            <Tooltip formatter={(v, n) => [v, n === "onDuty" ? "Guards on duty" : n]} labelFormatter={(_, p) => (p?.[0] ? `${dayLabel(p[0].payload.date)}${p[0].payload.below ? " · BELOW CONTRACT" : ""}` : "")} />
            <Bar dataKey="onDuty" isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.date} fill={d.below ? "#dc2626" : "#94a3b8"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 text-sm text-slate-600">
        <span className="font-semibold text-red-700">{below.length} day(s) below contract</span>
        {below.length > 0 && <>: {below.map((d) => `${dmy(d.date)} (${d.onDuty}/${d.contracted})`).join(", ")}</>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {Object.entries(others).map(([k, v]) => (
          <div key={k} className="rounded-lg bg-slate-50 p-2">
            <div className="capitalize text-slate-500">{k}</div>
            <div className="font-semibold text-slate-800">
              {v.present}/{db.project.contracted_headcount[k as ServiceLineId] ?? v.total} <span className="font-normal text-slate-400">present today</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function EvidenceGallery() {
  const db = useDB();
  const now = useStore((s) => s.now);
  const items = db.tasks.filter((t) => t.photos.length && t.completed_at && t.completed_at <= now).sort((a, b) => b.completed_at! - a.completed_at!).slice(0, 12);
  const [open, setOpen] = useState<TaskInstance | null>(null);
  return (
    <Card title="Evidence gallery · latest proof photos">
      {items.length === 0 ? (
        <Empty title="No photos yet" />
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((t) => (
            <button key={t.id} onClick={() => setOpen(t)} className="overflow-hidden rounded-lg border text-left hover:ring-2 hover:ring-accent-500">
              <img src={t.photos[t.photos.length - 1]} alt="" className="h-20 w-full object-cover" />
              <div className="px-1.5 py-1 text-[10px] leading-tight">
                <div className="truncate font-medium text-slate-700">{locationName(db, t.location_id)}</div>
                <div className="text-slate-500">
                  {shortDate(t.date)} {time12(t.completed_at!)}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title="Proof photo">
        {open && <TaskDetail task={open} />}
      </Modal>
    </Card>
  );
}

export { dateRange };
