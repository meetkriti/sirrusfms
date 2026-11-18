import { useState } from "react";
import { Link } from "react-router-dom";
import { useDB, useStore } from "../store";
import { config } from "../config";
import { alertsForRole, targetLabels } from "../engine/alerts";
import { duration, dateTime } from "../lib/format";
import { Badge, Button, Card, Empty, PageHeader, SeverityBadge, Tabs } from "../components/ui";

export default function Alerts() {
  const db = useDB();
  const { role, now, mutate } = useStore();
  const [tab, setTab] = useState<"open" | "acknowledged" | "resolved" | "all">("open");
  const [scope, setScope] = useState<"role" | "all">("role");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const roleLabel = config.hierarchy.roles.find((r) => r.id === role)?.label;
  const base = scope === "role" ? alertsForRole(db, role) : db.alerts;
  const list = base.filter((a) => a.created_at <= now && (tab === "all" || a.status === tab)).sort((a, b) => b.created_at - a.created_at);
  const userName = role === "fm" ? "Priya Nair (FM)" : role === "zonal" ? "Karthik Rao (Zonal)" : role === "ops_head" ? "Anita Desai (Ops Head)" : roleLabel ?? role;
  const entityLink = (a: (typeof list)[number]) =>
    a.entity.type === "task" ? `/tasks?id=${a.entity.id}` : a.entity.type === "ticket" ? `/tickets/${a.entity.id}` : a.entity.type === "attendance" ? `/dashboard#attendance` : a.entity.type === "meter" ? "/meters" : "/billing";
  return (
    <div>
      <PageHeader
        title="Alert inbox"
        sub={<>Alerts from the rule engine (<Link className="text-accent-600 hover:underline" to="/settings">edit rules</Link>). Showing {scope === "role" ? `alerts for ${roleLabel}` : "all alerts"}.</>}
        actions={
          <>
            <Tabs value={scope} onChange={setScope} tabs={[{ id: "role", label: "My role" }, { id: "all", label: "All roles" }]} />
            <Tabs value={tab} onChange={setTab} tabs={(["open", "acknowledged", "resolved", "all"] as const).map((t) => ({ id: t, label: `${t[0].toUpperCase()}${t.slice(1)} (${base.filter((a) => a.created_at <= now && (t === "all" || a.status === t)).length})` }))} />
          </>
        }
      />
      {list.length === 0 ? (
        <Empty title="No alerts here">Advance the simulation clock to see reminders, alerts and escalations fire.</Empty>
      ) : (
        <div className="space-y-2">
          {list.map((a) => (
            <Card key={a.id} className={a.status === "open" ? "" : "opacity-80"}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge s={a.severity} />
                    <Badge tone="slate">{a.rule_id}</Badge>
                    {a.recurring && <Badge tone="violet">Recurring miss</Badge>}
                    {a.billing_impact && <Badge tone="amber">Billing impact</Badge>}
                    <Link to={entityLink(a)} className="font-semibold text-slate-800 hover:underline">
                      {a.title}
                    </Link>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{a.reason}</p>
                  <div className="mt-1 text-xs text-slate-400">
                    {dateTime(a.created_at)} · {duration(now - a.created_at)} ago · to {targetLabels(a.targets)} · <span className="capitalize">{a.status}</span>
                  </div>
                  {a.notes.map((n, i) => (
                    <div key={i} className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
                      {dateTime(n.at)} · {n.by}: {n.text}
                    </div>
                  ))}
                </div>
                <div className="flex w-64 flex-col gap-1.5">
                  <div className="flex gap-1.5">
                    {a.status === "open" && (
                      <Button size="sm" onClick={() => mutate(() => ((a.status = "acknowledged"), a.notes.push({ at: now, by: userName, text: "Acknowledged" })))}>
                        Acknowledge
                      </Button>
                    )}
                    {a.status !== "resolved" && (
                      <Button size="sm" variant="success" onClick={() => mutate(() => ((a.status = "resolved"), a.notes.push({ at: now, by: userName, text: "Resolved" })))}>
                        Resolve
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <input value={notes[a.id] ?? ""} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} placeholder="Add note…" className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-xs" />
                    <Button
                      size="sm"
                      onClick={() => {
                        if (!notes[a.id]?.trim()) return;
                        mutate(() => a.notes.push({ at: now, by: userName, text: notes[a.id] }));
                        setNotes({ ...notes, [a.id]: "" });
                      }}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
