import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useDB, useStore } from "../store";
import { config } from "../config";
import type { Priority, TicketCategory } from "../types";
import { ACTIVE_TICKET, createTicket, isBreached, LEVEL_RANK } from "../engine/tickets";
import { locationById, locationName, staffName } from "../engine/core";
import { classify } from "../ai/client";
import { dateTime, duration, dmyFromMs } from "../lib/format";
import { HOUR } from "../lib/time";
import { Badge, Button, Card, Empty, Modal, PageHeader, Tabs, Td, Th, Spinner } from "../components/ui";

const CATS: TicketCategory[] = ["Housekeeping", "Security", "Plumbing", "Electrical", "Lift", "STP/Odour", "Water Supply", "Landscaping", "Pest Control", "Other"];

export function PriorityBadge({ p }: { p: Priority }) {
  return <Badge tone={p === "P1" ? "red" : p === "P2" ? "amber" : "slate"}>{p}</Badge>;
}
export function LevelBadge({ l }: { l: string }) {
  return <Badge tone={l === "L1" ? "slate" : l === "L2" ? "blue" : l === "L3" ? "violet" : "red"}>{l}</Badge>;
}

export default function Tickets() {
  const db = useDB();
  const now = useStore((s) => s.now);
  const [sp, setSp] = useSearchParams();
  const view = (sp.get("view") ?? "all") as "all" | "escalations";
  const status = sp.get("status") ?? "all";
  const breached = sp.get("breached") === "1";
  const [newOpen, setNewOpen] = useState(false);
  let list = db.tickets.filter((t) => t.created_at <= now);
  if (status === "open") list = list.filter((t) => ACTIVE_TICKET.has(t.status));
  if (status === "closed") list = list.filter((t) => !ACTIVE_TICKET.has(t.status));
  if (breached) list = list.filter((t) => isBreached(t) && dmyFromMs(t.created_at).slice(3) === dmyFromMs(now).slice(3));
  list = [...list].sort((a, b) => b.created_at - a.created_at);
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v === null) n.delete(k);
    else n.set(k, v);
    setSp(n, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="Tickets and escalations"
        sub="Complaints from the society (WhatsApp, email) and internal issues, with SLA and level-by-level escalation."
        actions={
          <>
            <Tabs value={view} onChange={(v) => set("view", v)} tabs={[{ id: "all", label: "All tickets" }, { id: "escalations", label: "Escalation view (L3/L4)" }]} />
            <Button variant="primary" onClick={() => setNewOpen(true)}>
              <Plus size={14} />
              Log ticket
            </Button>
          </>
        }
      />
      {view === "escalations" ? (
        <Escalations />
      ) : (
        <Card
          title={`${list.length} tickets${breached ? " with SLA breach this month" : ""}`}
          action={
            <div className="flex gap-2">
              <Tabs value={status as "all"} onChange={(v) => set("status", v)} tabs={[{ id: "all", label: "All" }, { id: "open", label: "Open" }, { id: "closed", label: "Resolved/closed" }] as never} />
              {breached && <Button size="sm" variant="ghost" onClick={() => set("breached", null)}>Clear SLA filter ✕</Button>}
            </div>
          }
        >
          {list.length === 0 ? <Empty title="No tickets" /> : <TicketTable list={list} now={now} />}
        </Card>
      )}
      <NewTicket open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function TicketTable({ list, now }: { list: ReturnType<typeof useDB>["tickets"]; now: number }) {
  const db = useDB();
  return (
    <div className="scroll-thin max-h-[70vh] overflow-auto">
      <table className="w-full">
        <thead className="sticky top-0">
          <tr>
            <Th>Ticket</Th>
            <Th>Raised</Th>
            <Th>Category</Th>
            <Th>Location</Th>
            <Th>Pri</Th>
            <Th>Level</Th>
            <Th>Owner</Th>
            <Th>Status</Th>
            <Th>SLA</Th>
          </tr>
        </thead>
        <tbody>
          {list.map((t) => (
            <tr key={t.id} className="hover:bg-slate-50">
              <Td>
                <Link to={`/tickets/${t.id}`} className="font-medium text-accent-700 hover:underline">
                  {t.number}
                </Link>
                <div className="max-w-[260px] truncate text-xs text-slate-500" title={t.description}>
                  {t.description}
                </div>
              </Td>
              <Td className="whitespace-nowrap text-xs">{dateTime(t.created_at)}</Td>
              <Td>{t.category}</Td>
              <Td className="text-xs">{locationName(db, t.location_id)}</Td>
              <Td><PriorityBadge p={t.priority} /></Td>
              <Td><LevelBadge l={t.level} /></Td>
              <Td className="text-xs">{staffName(db, t.owner_id)}</Td>
              <Td><Badge tone={ACTIVE_TICKET.has(t.status) ? "amber" : "green"}>{t.status}</Badge></Td>
              <Td className="text-xs">
                {t.response_breached && <Badge tone="red">Response</Badge>} {t.resolution_breached && <Badge tone="red">Resolution</Badge>}
                {!isBreached(t) && ACTIVE_TICKET.has(t.status) && <span className="text-slate-500">due in {duration(t.resolution_due - now)}</span>}
                {!isBreached(t) && !ACTIVE_TICKET.has(t.status) && <span className="text-emerald-700">Met</span>}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Escalations() {
  const db = useDB();
  const now = useStore((s) => s.now);
  const open = db.tickets.filter((t) => ACTIVE_TICKET.has(t.status) && LEVEL_RANK[t.level] >= 2 && t.created_at <= now).sort((a, b) => a.created_at - b.created_at);
  const since = now - 90 * 24 * HOUR;
  const groups = new Map<string, typeof db.tickets>();
  db.tickets.filter((t) => t.created_at >= since && t.created_at <= now).forEach((t) => {
    const loc = locationById(db, t.location_id);
    const k = `${loc?.tower ? `Tower ${loc.tower}` : loc?.name}|${t.category}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  });
  const repeats = [...groups.entries()].filter(([, xs]) => xs.length >= 3).sort((a, b) => b[1].length - a[1].length);
  const escalated90 = db.tickets.filter((t) => t.created_at >= since && LEVEL_RANK[t.level] >= 3);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title={`Open escalated tickets (L2 and above) · ${open.length}`}>
        {open.length === 0 ? (
          <Empty title="Nothing escalated right now" />
        ) : (
          <ul className="divide-y">
            {open.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-2 text-sm">
                <LevelBadge l={t.level} />
                <PriorityBadge p={t.priority} />
                <Link to={`/tickets/${t.id}`} className="font-medium text-accent-700 hover:underline">
                  {t.number}
                </Link>
                <span className="flex-1 truncate">
                  {t.category} · {locationName(db, t.location_id)}
                </span>
                <span className="text-xs text-red-700">ageing {duration(now - t.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Repeat tickets at the same location (90 days, 3 or more)">
        {repeats.length === 0 ? (
          <Empty title="No repeats" />
        ) : (
          <ul className="divide-y">
            {repeats.map(([k, xs]) => {
              const [loc, cat] = k.split("|");
              const l3 = xs.filter((t) => LEVEL_RANK[t.level] >= 3).length;
              return (
                <li key={k} className="py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {loc} · {cat}
                    </span>
                    <span>
                      <Badge tone="amber">{xs.length} tickets</Badge> {l3 > 0 && <Badge tone="violet">{l3} reached L3+</Badge>}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1 text-xs">
                    {xs.map((t) => (
                      <Link key={t.id} to={`/tickets/${t.id}`} className="text-accent-600 hover:underline">
                        {t.number}
                      </Link>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500">{escalated90.length} tickets reached Zonal level (L3) or above in the last 90 days.</p>
      </Card>
    </div>
  );
}

function NewTicket({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDB();
  const { aiMode, mutate } = useStore();
  const nav = useNavigate();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ category: TicketCategory; priority: Priority; location_id: string; confidence: number; by: "mock" | "live" } | null>(null);
  const run = async () => {
    setBusy(true);
    const c = await classify(aiMode, text);
    setDraft({ category: c.category, priority: c.priority, location_id: c.location_id ?? "PRJ", confidence: c.confidence, by: c.by });
    setBusy(false);
  };
  const create = () => {
    if (!draft) return;
    let id = "";
    mutate((w) => {
      const t = createTicket(w, {
        raised_by: "internal", raised_by_name: "Priya Nair (FM)", channel: "dashboard", category: draft.category, priority: draft.priority, location_id: draft.location_id, description: text,
        classification: { by: draft.by, confidence: draft.confidence }, source: "dashboard",
      });
      id = t.id;
    });
    onClose();
    setText("");
    setDraft(null);
    nav(`/tickets/${id}`);
  };
  return (
    <Modal open={open} onClose={onClose} title="Log a ticket from the dashboard">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder='e.g. "Water leaking from the Tower A terrace pipe near 16th floor"' className="w-full rounded-lg border border-slate-300 p-2 text-sm" />
      <div className="mt-2 flex items-center gap-2">
        <Button onClick={run} disabled={!text.trim() || busy}>Auto-classify ({aiMode})</Button>
        {busy && <Spinner />}
      </div>
      {draft && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <label>
            Category
            <select className="mt-0.5 w-full rounded border p-1" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as TicketCategory, by: "mock", confidence: 1 })}>
              {CATS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select className="mt-0.5 w-full rounded border p-1" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}>
              {(["P1", "P2", "P3"] as const).map((p) => (
                <option key={p} value={p}>
                  {p}: {config.sla[p].examples}
                </option>
              ))}
            </select>
          </label>
          <label>
            Location
            <select className="mt-0.5 w-full rounded border p-1" value={draft.location_id} onChange={(e) => setDraft({ ...draft, location_id: e.target.value })}>
              {db.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <div className="col-span-3 text-xs text-slate-500">
            Classified by {draft.by} (confidence {draft.confidence.toFixed(2)}). Edit any field before creating. SLA: respond {config.sla[draft.priority].response_min} min, resolve {duration(config.sla[draft.priority].resolution_min * 60000)}.
          </div>
          <div className="col-span-3">
            <Button variant="primary" onClick={create}>Create ticket</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
