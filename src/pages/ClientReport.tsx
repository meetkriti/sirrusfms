import { useSearchParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { useDB, useStore } from "../store";
import type { ServiceLineId } from "../types";
import { filterTasks, securityDays, stats } from "../engine/metrics";
import { isBreached } from "../engine/tickets";
import { locationName, taskTitle } from "../engine/core";
import { occursOn } from "../engine/tasks";
import { addDays, HOUR, istAt, istDate, monthDays, monthLabel } from "../lib/time";
import { dmy, pct } from "../lib/format";
import { Button, PageHeader, Select } from "../components/ui";

const LINES: { id: ServiceLineId; name: string }[] = [
  { id: "housekeeping", name: "Housekeeping" },
  { id: "security", name: "Security" },
  { id: "technical", name: "Technical" },
  { id: "water", name: "Water pump" },
  { id: "stp", name: "STP operation" },
  { id: "landscaping", name: "Landscaping" },
  { id: "electromechanical", name: "DG / electromechanical" },
];

const CORRECTIVE: Record<string, string> = {
  "hk_staircase|C-STAIR": "Most misses fell on Sundays (Tower C housekeepers' weekly off without cover). Weekly-off roster revised; a reliever covers Tower C on Sundays.",
  hk_staircase: "Supervisor now confirms staircase photos by 9:30 AM; a reliever is assigned when a housekeeper is on leave.",
  hk_lift_lobby: "Second-round lobby cleaning moved earlier in the shift; supervisor checks photos by 5 PM.",
  sec_patrol: "Night patrol completion reviewed with the security agency; reliever pool increased for the last week of the month.",
  stp_log: "Evening STP log now prompted at shift start; missing entries escalated to the Technical Supervisor.",
  land_watering: "Watering reported in the group chat is now captured in the checklist workflow.",
};

export default function ClientReport() {
  const db = useDB();
  const now = useStore((s) => s.now);
  const [sp, setSp] = useSearchParams();
  const today = istDate(now);
  const months = [...new Set(db.tasks.map((t) => t.date.slice(0, 7)))].sort().filter((m) => m <= today.slice(0, 7));
  const month = sp.get("month") ?? addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const days = monthDays(month);
  const from = days[0];
  const to = days[days.length - 1] < today ? days[days.length - 1] : addDays(today, -1);
  const all = stats(db, filterTasks(db, { from, to }), now);
  const lines = LINES.map((l) => ({ ...l, s: stats(db, filterTasks(db, { from, to, serviceLine: l.id }), now) })).filter((l) => l.s.total);
  const sec = securityDays(db, from, to);
  const secContract = sec.reduce((s, d) => s + d.contracted, 0);
  const secOnDuty = sec.reduce((s, d) => s + d.onDuty, 0);
  const below = sec.filter((d) => d.below);
  const fromMs = istAt(from), toMs = istAt(to, "23:59");
  const tickets = db.tickets.filter((t) => t.created_at >= fromMs && t.created_at <= toMs);
  const resolved = tickets.filter((t) => t.resolved_at);
  const avgRes = resolved.length ? resolved.reduce((s, t) => s + (t.resolved_at! - t.created_at), 0) / resolved.length / HOUR : 0;
  const met = tickets.filter((t) => !isBreached(t)).length;
  const byCat = new Map<string, number>();
  tickets.forEach((t) => byCat.set(t.category, (byCat.get(t.category) ?? 0) + 1));
  const missed = filterTasks(db, { from, to }).filter((t) => t.status === "missed");
  const missGroups = new Map<string, { tpl: string; loc: string; n: number; label: string }>();
  missed.forEach((t) => {
    const k = `${t.template_id}|${t.location_id}`;
    const g = missGroups.get(k) ?? { tpl: t.template_id, loc: t.location_id, n: 0, label: taskTitle(db, t.template_id, t.location_id) };
    g.n++;
    missGroups.set(k, g);
  });
  const topMisses = [...missGroups.values()].sort((a, b) => b.n - a.n).slice(0, 4);
  const inspections = db.inspections.filter((i) => i.date >= from && i.date <= to);
  const generic = (t: (typeof resolved)[number]) => /Attended and closed by site team/.test(t.timeline.find((e) => e.type === "resolved")?.text ?? "");
  const actions = [...resolved.filter((t) => !generic(t)), ...resolved.filter((t) => generic(t) && t.priority !== "P3")].slice(0, 4);
  const photos = db.tasks.filter((t) => t.date >= from && t.date <= to && t.photos.length && t.status === "done").filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 4)) === 0).slice(0, 4);
  const nextMonth = addDays(days[days.length - 1], 1).slice(0, 7);
  const planned = db.templates.flatMap((tpl) => (["monthly", "quarterly", "weekly"].includes(tpl.frequency) ? monthDays(nextMonth).filter((d) => occursOn(tpl, d)).slice(0, tpl.frequency === "weekly" ? 1 : 2).map((d) => ({ d, tpl })) : []));
  const pendingQ = db.quotations.filter((q) => q.approval_status === "submitted");

  return (
    <div>
      <div className="no-print">
        <PageHeader
          title="Client monthly service report"
          sub="One page for the AOA committee. Neutral and factual; misses are shown with the corrective action."
          actions={
            <>
              <Select label="Month" value={month} onChange={(v) => setSp({ month: v })} options={months.map((m) => ({ value: m, label: monthLabel(m) }))} />
              <Button variant="primary" onClick={() => window.print()}>
                <Printer size={14} /> Print / save as PDF
              </Button>
            </>
          }
        />
      </div>
      <article className="print-area mx-auto w-[210mm] bg-white p-[12mm] text-[12px] leading-snug text-slate-800 shadow-md ring-1 ring-slate-200">
        <header className="mb-3 flex items-start justify-between border-b-2 border-slate-800 pb-2">
          <div>
            <div className="text-lg font-bold tracking-tight">Paradigm Services</div>
            <div className="text-[11px] text-slate-500">Integrated Facility Management · Bengaluru · Hyderabad · Pune</div>
          </div>
          <div className="flex h-12 w-28 items-center justify-center border border-dashed border-slate-300 text-[10px] text-slate-400">Logo</div>
        </header>
        <h1 className="text-base font-semibold">Monthly service report · {monthLabel(month)}</h1>
        <div className="mb-3 text-[11px] text-slate-600">
          {db.project.client_name} · {db.project.name}, {db.project.city} · Period {dmy(from)} to {dmy(to)}
        </div>

        <h2 className="mb-1 mt-2 font-semibold uppercase tracking-wide text-slate-500">Summary</h2>
        <p>
          {all.done + all.late} of {all.done + all.late + all.missed} scheduled checklists were completed ({pct(all.done + all.late, all.done + all.late + all.missed, 1)}), {all.late} of them after the due time and {all.missed} missed.
          {" "}Security deployment was {pct(secOnDuty, secContract, 1)} of contracted guard man-days, with {below.length} day(s) below contract.
          {" "}{tickets.length} issues were raised; {resolved.length} were resolved, in {avgRes.toFixed(1)} hours on average, and {pct(met, tickets.length, 0)} were handled within the agreed SLA.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-4">
          <section>
            <h2 className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Checklist compliance by service</h2>
            <table className="w-full">
              <thead><tr className="border-b text-left text-[10px] uppercase text-slate-500"><th>Service</th><th className="text-right">Done</th><th className="text-right">Late</th><th className="text-right">Missed</th><th className="text-right">Compliance</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100"><td>{l.name}</td><td className="text-right">{l.s.done}</td><td className="text-right">{l.s.late}</td><td className="text-right">{l.s.missed}</td><td className="text-right font-medium">{l.s.compliance === null ? "–" : pct(l.s.compliance, 1, 1)}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
          <section>
            <h2 className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Attendance vs contract</h2>
            <table className="w-full">
              <tbody>
                <tr className="border-b border-slate-100"><td>Security guard man-days</td><td className="text-right">{secOnDuty} / {secContract}</td></tr>
                <tr className="border-b border-slate-100"><td>Days below contract</td><td className="text-right">{below.length ? below.map((d) => dmy(d.date).slice(0, 5)).join(", ") : "None"}</td></tr>
                {(["housekeeping", "technical", "stp", "landscaping"] as ServiceLineId[]).map((sl) => {
                  const recs = db.attendance.filter((a) => a.service_line === sl && a.date >= from && a.date <= to);
                  const present = recs.filter((a) => a.status !== "absent").length;
                  const daysN = new Set(recs.map((a) => a.date)).size || 1;
                  return <tr key={sl} className="border-b border-slate-100"><td className="capitalize">{sl === "stp" ? "STP" : sl} (avg present / contract)</td><td className="text-right">{(present / daysN).toFixed(1)} / {db.project.contracted_headcount[sl]}</td></tr>;
                })}
              </tbody>
            </table>
          </section>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-4">
          <section>
            <h2 className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Issues raised and resolved</h2>
            <table className="w-full">
              <tbody>
                <tr className="border-b border-slate-100"><td>Raised / resolved</td><td className="text-right">{tickets.length} / {resolved.length}</td></tr>
                <tr className="border-b border-slate-100"><td>Average resolution time</td><td className="text-right">{avgRes.toFixed(1)} h</td></tr>
                <tr className="border-b border-slate-100"><td>Within SLA</td><td className="text-right">{met} of {tickets.length}</td></tr>
                {[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => <tr key={c} className="border-b border-slate-100 text-slate-600"><td className="pl-2">{c}</td><td className="text-right">{n}</td></tr>)}
              </tbody>
            </table>
          </section>
          <section>
            <h2 className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Misses and corrective action</h2>
            {topMisses.length === 0 ? <p>No checklists missed.</p> : (
              <ul className="space-y-1">
                {topMisses.map((m) => (
                  <li key={m.label}><span className="font-medium">{m.label}: missed {m.n} time{m.n > 1 ? "s" : ""}.</span> <span className="text-slate-600">{CORRECTIVE[`${m.tpl}|${m.loc}`] ?? CORRECTIVE[m.tpl] ?? "Reviewed with the supervisor; reminders and escalation now automatic."}</span></li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="mt-3">
          <h2 className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Key actions taken</h2>
          <ul className="list-disc space-y-0.5 pl-4">
            {actions.map((t) => <li key={t.id}>{t.number}, {t.category} at {locationName(db, t.location_id)}: {t.timeline.find((e) => e.type === "resolved")?.text.replace(/^Resolved: /, "").replace(/\s*\(.*after raising\)$/, "")}</li>)}
            {inspections.length > 0 && <li>{inspections.length} quality inspection(s); average score {Math.round(inspections.reduce((s, i) => s + i.overall_score, 0) / inspections.length)}%.</li>}
          </ul>
        </section>

        {photos.length > 0 && (
          <section className="mt-3">
            <h2 className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Photo highlights</h2>
            <div className="grid grid-cols-4 gap-2">
              {photos.map((t) => (
                <figure key={t.id}>
                  <img src={t.photos[0]} alt="" className="h-20 w-full rounded object-cover" />
                  <figcaption className="text-[10px] text-slate-500">{locationName(db, t.location_id)}, {dmy(t.date)}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        <section className="mt-3">
          <h2 className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Planned for {monthLabel(nextMonth)}</h2>
          <ul className="list-disc space-y-0.5 pl-4">
            {planned.filter((p) => p.tpl.frequency !== "weekly").slice(0, 4).map((p) => <li key={p.tpl.id + p.d}>{p.tpl.name} ({dmy(p.d)})</li>)}
            <li>Weekly: {planned.filter((p) => p.tpl.frequency === "weekly").map((p) => p.tpl.name.toLowerCase()).join(", ")}</li>
            {pendingQ.map((q) => <li key={q.id}>Awaiting committee approval: {q.number}, {q.description}</li>)}
          </ul>
        </section>
        <footer className="mt-4 border-t pt-1 text-[10px] text-slate-400">Prepared from Paradigm's operational records (checklists, tickets, attendance). PROTOTYPE · sample data · not a real report.</footer>
      </article>
    </div>
  );
}
