import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Check, Clock, MessageSquare, Camera, AlertTriangle, CircleDot, UserCheck } from "lucide-react";
import { useDB, useStore } from "../store";
import { config } from "../config";
import type { Level, TicketCategory, TimelineEvent } from "../types";
import { ACTIVE_TICKET, acknowledgeTicket, addTicketNote, resolveTicket, setInProgress, serviceLineFor } from "../engine/tickets";
import { locationName, staffName } from "../engine/core";
import { dateTime, duration } from "../lib/format";
import { MIN } from "../lib/time";
import { Badge, Button, Card, cx, Empty, PageHeader } from "../components/ui";
import { LevelBadge, PriorityBadge } from "./Tickets";

const ICON: Record<TimelineEvent["type"], JSX.Element> = {
  raised: <CircleDot size={14} />, acknowledged: <UserCheck size={14} />, assigned: <UserCheck size={14} />, escalated: <ArrowUpRight size={14} />, photo_added: <Camera size={14} />,
  note: <MessageSquare size={14} />, resolved: <Check size={14} />, client_confirmed: <Check size={14} />, reopened: <AlertTriangle size={14} />, closed: <Check size={14} />, sla_breach: <Clock size={14} />, message_linked: <MessageSquare size={14} />,
};
const TONE: Partial<Record<TimelineEvent["type"], string>> = { escalated: "bg-violet-600", sla_breach: "bg-red-600", resolved: "bg-emerald-600", closed: "bg-emerald-700", client_confirmed: "bg-emerald-600", reopened: "bg-amber-600", message_linked: "bg-sky-600" };

export default function TicketDetail() {
  const { id } = useParams();
  const db = useDB();
  const { now, mutate, role } = useStore();
  const [note, setNote] = useState("");
  const t = db.tickets.find((x) => x.id === id);
  if (!t) return <Empty title="Ticket not found" />;
  const me = role === "zonal" ? "zonal" : role === "ops_head" ? "ops_head" : "fm";
  const meName = staffName(db, config.hierarchy.owners[me === "fm" ? "L2" : me === "zonal" ? "L3" : "L4"]);
  const active = ACTIVE_TICKET.has(t.status);
  const sla = config.sla[t.priority];
  const chat = db.chat.filter((m) => m.ticket_id === t.id || t.linked_message_ids.includes(m.id)).sort((a, b) => a.at - b.at);
  const raw = db.rawMessages.filter((m) => t.linked_message_ids.includes(m.id));
  const nextEsc = sla.escalation.find((s) => s.level > t.level);
  const timeline = t.timeline.filter((e) => e.at <= now).sort((a, b) => a.at - b.at);

  return (
    <div>
      <Link to="/tickets" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft size={14} /> Tickets
      </Link>
      <PageHeader
        title={`${t.number} · ${t.category} · ${locationName(db, t.location_id)}`}
        sub={`Raised by ${t.raised_by_name} via ${t.channel.replace("_", " ")} on ${dateTime(t.created_at)}`}
        actions={
          <>
            <PriorityBadge p={t.priority} />
            <LevelBadge l={t.level} />
            <Badge tone={active ? "amber" : "green"}>{t.status}</Badge>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Issue">
            <p className="text-slate-800">“{t.description}”</p>
            {t.photos.length > 0 && <div className="mt-2 flex gap-2">{t.photos.map((p, i) => <img key={i} src={p} alt="" className="h-28 rounded border" />)}</div>}
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <Info k="Current owner" v={`${staffName(db, t.owner_id)} (${t.level})`} />
              <Info k="Response SLA" v={t.acknowledged_at ? `Acknowledged in ${duration(t.acknowledged_at - t.created_at)}` : active ? (now > t.response_due ? `Breached ${duration(now - t.response_due)} ago` : `${duration(t.response_due - now)} left`) : "—"} bad={!!t.response_breached} />
              <Info k="Resolution SLA" v={t.resolved_at ? `Resolved in ${duration(t.resolved_at - t.created_at)}` : now > t.resolution_due ? `Breached ${duration(now - t.resolution_due)} ago` : `${duration(t.resolution_due - now)} left`} bad={!!t.resolution_breached} />
              <Info k="Next escalation" v={active && nextEsc ? `${nextEsc.level} at ${dateTime(t.created_at + nextEsc.after_min * MIN)}` : "—"} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              Classification: {t.classification ? `${t.classification.by}, confidence ${t.classification.confidence.toFixed(2)}` : "—"}. Correct it:
              <select className="rounded border px-1 py-0.5" value={t.category} disabled={!active} onChange={(e) => mutate((w) => { t.category = e.target.value as TicketCategory; t.classification = { by: "human", confidence: 1 }; addTicketNote(w, t, meName, `Category corrected to ${t.category} by ${meName}.`); })}>
                {Object.keys(config.hierarchy.categoryToServiceLine).map((c) => <option key={c}>{c}</option>)}
              </select>
              <select className="rounded border px-1 py-0.5" value={t.priority} disabled={!active} onChange={(e) => mutate((w) => { t.priority = e.target.value as never; t.classification = { by: "human", confidence: 1 }; addTicketNote(w, t, meName, `Priority changed to ${t.priority} by ${meName}. SLA clock unchanged.`); })}>
                {["P1", "P2", "P3"].map((p) => <option key={p}>{p}</option>)}
              </select>
              <span>Path: {sla.escalation.map((s) => `${s.level} at ${duration(s.after_min * MIN)}`).join(" → ")} ({serviceLineFor(t.category)} line)</span>
            </div>
          </Card>
          <Card title="Timeline">
            <ol className="relative ml-3 border-l border-slate-200">
              {timeline.map((e, i) => (
                <li key={i} className="mb-3 ml-5">
                  <span className={cx("absolute -left-[11px] flex h-5 w-5 items-center justify-center rounded-full text-white", TONE[e.type] ?? "bg-slate-500")}>{ICON[e.type]}</span>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-semibold uppercase text-slate-600">{e.type.replace("_", " ")}</span>
                    {e.level && <LevelBadge l={e.level as Level} />}
                    <span>{dateTime(e.at)}</span>
                    <span>· {e.by}</span>
                  </div>
                  <div className="text-sm text-slate-700">{e.text}</div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Actions">
            {!active ? (
              <p className="text-sm text-slate-500">{t.status === "resolved" ? "Waiting for the client to confirm on WhatsApp (YES / NO)." : "Closed."}</p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {!t.acknowledged_at && <Button size="sm" onClick={() => mutate((w) => acknowledgeTicket(w, t, config.hierarchy.owners.L2))}>Acknowledge (as FM)</Button>}
                  <Button size="sm" onClick={() => mutate((w) => setInProgress(w, t, config.hierarchy.owners.L2, note || "Team assigned and working."))}>Mark in progress</Button>
                </div>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Note or resolution detail…" className="w-full rounded border border-slate-300 p-2 text-sm" />
                <div className="flex gap-2">
                  <Button size="sm" disabled={!note.trim()} onClick={() => { mutate((w) => addTicketNote(w, t, meName, note)); setNote(""); }}>Add note</Button>
                  <Button size="sm" variant="success" onClick={() => { mutate((w) => resolveTicket(w, t, t.owner_id, note || "Issue fixed by site team.")); setNote(""); }}>Resolve → ask client to confirm</Button>
                </div>
              </div>
            )}
          </Card>
          <Card title="Linked WhatsApp / email messages">
            {chat.length + raw.length === 0 ? (
              <Empty title="No linked messages" />
            ) : (
              <ul className="space-y-2 text-sm">
                {chat.map((m) => (
                  <li key={m.id} className={cx("rounded-lg px-2 py-1", m.from === "user" ? "bg-chat-out" : "bg-slate-50")}>
                    <div className="text-[10px] text-slate-500">{dateTime(m.at)} · {m.from === "bot" ? `Bot → ${staffName(db, m.phone_owner)}` : staffName(db, m.phone_owner)}</div>
                    {m.photo && <img src={m.photo} alt="" className="my-1 h-16 rounded" />}
                    <div className="whitespace-pre-wrap">{m.text}</div>
                  </li>
                ))}
                {raw.map((m) => (
                  <li key={m.id} className="rounded-lg bg-violet-50 px-2 py-1">
                    <div className="text-[10px] text-violet-600">{dateTime(m.timestamp)} · {m.channel === "email" ? "Email" : "Group chat"} · {m.sender}</div>
                    <div className="whitespace-pre-wrap text-violet-950">{m.subject ? <strong>{m.subject}: </strong> : null}{m.text.slice(0, 300)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Info({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase text-slate-400">{k}</div>
      <div className={bad ? "font-medium text-red-700" : "text-slate-700"}>{v}</div>
    </div>
  );
}
