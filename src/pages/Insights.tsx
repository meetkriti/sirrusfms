import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Lightbulb } from "lucide-react";
import { useDB, useStore } from "../store";
import { computeInsights, missByWeekday, resolutionStats, ticketMatrix, type Insight } from "../engine/patterns";
import { wordInsight } from "../ai/client";
import { addDays, istAt, istDate, WEEKDAYS } from "../lib/time";
import { Badge, Card, cx, PageHeader, SeverityBadge, Td, Th } from "../components/ui";

export default function Insights() {
  const db = useDB();
  const { now, aiMode } = useStore();
  const today = istDate(now);
  const fromMs = istAt(addDays(today, -89));
  const insights = computeInsights(db, now);
  const tm = ticketMatrix(db, fromMs, now);
  const wk = missByWeekday(db, addDays(today, -89), addDays(today, -1)).slice(0, 10);
  const rs = resolutionStats(db, fromMs, now);
  return (
    <div>
      <PageHeader title="Pattern analysis · last 90 days" sub="Recurring issues that drive repeat escalations. Numbers are computed from records; wording may come from the AI but numbers never do." />
      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {insights.map((i) => (
          <InsightCard key={i.id} i={i} mode={aiMode} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Tickets by location × category (90 days)">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <Th>Location</Th>
                  {tm.cats.map((c) => <Th key={c} className="text-center">{c}</Th>)}
                </tr>
              </thead>
              <tbody>
                {tm.areas.map((a) => (
                  <tr key={a}>
                    <Td className="whitespace-nowrap text-xs font-medium">{a}</Td>
                    {tm.cats.map((c) => {
                      const n = tm.cell(a, c).length;
                      return (
                        <Td key={c} className="text-center">
                          {n ? <span title={tm.cell(a, c).map((t) => t.number).join(", ")} className={cx("inline-block min-w-[22px] rounded px-1 py-0.5 font-semibold", n >= 4 ? "bg-red-600 text-white" : n >= 2 ? "bg-amber-300 text-amber-950" : "bg-slate-100 text-slate-600")}>{n}</span> : ""}
                        </Td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-xs font-semibold uppercase text-slate-500">Ranked recurring (2 or more)</div>
          <ol className="mt-1 space-y-0.5 text-sm">
            {tm.ranked.slice(0, 8).map((r) => (
              <li key={r.area + r.category} className="flex justify-between">
                <span>{r.area} · {r.category}</span>
                <span className="flex gap-1">{r.tickets.slice(0, 5).map((t) => <Link key={t.id} to={`/tickets/${t.id}`} className="text-xs text-accent-600 hover:underline">{t.number}</Link>)}</span>
              </li>
            ))}
          </ol>
        </Card>
        <Card id="weekday" title="Missed checklists by weekday (miss rate, 90 days)">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <Th>Checklist</Th>
                {WEEKDAYS.map((d) => <Th key={d} className="text-center">{d}</Th>)}
              </tr>
            </thead>
            <tbody>
              {wk.map((r) => (
                <tr key={r.label}>
                  <Td className="max-w-[220px] truncate text-xs" >{r.label}</Td>
                  {r.byDay.map((d, i) => {
                    const rate = d.total ? d.missed / d.total : 0;
                    return (
                      <Td key={i} className="text-center">
                        <span title={`${d.missed} of ${d.total} missed`} className={cx("inline-block min-w-[34px] rounded px-1 py-0.5", rate >= 0.5 ? "bg-red-600 font-semibold text-white" : rate >= 0.25 ? "bg-amber-300" : rate > 0 ? "bg-slate-100" : "text-slate-300")}>
                          {d.total ? `${Math.round(rate * 100)}%` : "–"}
                        </span>
                      </Td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Average time to resolve by category">
          <Bars rows={rs.byCategory.map((r) => ({ label: `${r.key} (${r.count})`, v: r.avgHours }))} />
        </Card>
        <Card title="Average time to resolve by highest escalation level reached">
          <Bars rows={rs.byLevel.sort((a, b) => a.key.localeCompare(b.key)).map((r) => ({ label: `${r.key} (${r.count} tickets)`, v: r.avgHours }))} />
          <p className="mt-2 text-xs text-slate-500">Tickets that reach L3 take longest; fixing recurring causes (lift AMC, STP chamber) removes most of them.</p>
        </Card>
      </div>
    </div>
  );
}

function Bars({ rows }: { rows: { label: string; v: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2 text-xs">
          <span className="w-44 shrink-0 truncate text-slate-600">{r.label}</span>
          <span className="h-3 rounded bg-accent-500" style={{ width: `${(r.v / max) * 60}%` }} />
          <span className="text-slate-700">{r.v.toFixed(1)} h</span>
        </li>
      ))}
    </ul>
  );
}

function InsightCard({ i, mode }: { i: Insight; mode: "mock" | "live" }) {
  const [w, setW] = useState<{ text: string; suggestion: string; by: string; rejected?: string }>({ text: i.text, suggestion: i.suggestion, by: "computed" });
  useEffect(() => {
    let alive = true;
    if (mode === "live") wordInsight(mode, i).then((r) => alive && setW(r));
    else setW({ text: i.text, suggestion: i.suggestion, by: "computed" });
    return () => {
      alive = false;
    };
  }, [i.text, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={cx("rounded-xl border bg-white p-4 shadow-sm", i.severity === "high" ? "border-red-200" : "border-slate-200")}>
      <div className="mb-1 flex items-center gap-2">
        <Lightbulb size={16} className="text-amber-500" />
        <span className="font-semibold text-slate-800">{i.title}</span>
        <SeverityBadge s={i.severity} />
      </div>
      <p className="text-sm text-slate-700">{w.text}</p>
      <p className="mt-1 text-sm text-slate-500"><span className="font-medium text-slate-600">Suggested:</span> {w.suggestion}</p>
      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
        {i.evidence.slice(0, 6).map((e) => <Link key={e.route + e.label} to={e.route} className="rounded bg-slate-100 px-1.5 py-0.5 text-accent-700 hover:bg-slate-200">{e.label}</Link>)}
      </div>
      <div className="mt-2 text-[10px] text-slate-400">
        Numbers: {Object.entries(i.numbers).map(([k, v]) => `${k}=${v}`).join(", ")} · wording: <Badge tone={w.by === "live" ? "violet" : "slate"}>{w.by}</Badge> {w.rejected && <span className="text-amber-700">{w.rejected}</span>}
      </div>
    </div>
  );
}
