import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Upload, Mail, MessageCircle, Link2 } from "lucide-react";
import { useDB, useStore } from "../store";
import type { ExtractedEvent, ExtractedType, RawMessage } from "../types";
import { applyEvent, importStats, parseWhatsAppExport } from "../engine/extract";
import { importMessages, importSampleMessages } from "../actions";
import { dateTime, dmyFromMs, time12, titleCase } from "../lib/format";
import { istDate } from "../lib/time";
import { Badge, Button, Card, cx, Empty, Kpi, PageHeader, Tabs, Td, Th } from "../components/ui";
import { SourceBadge } from "../components/TaskDetail";

const TYPE_TONE: Record<ExtractedType, "green" | "red" | "blue" | "amber" | "violet" | "slate"> = {
  task_completed: "green", issue_reported: "red", meter_reading: "blue", attendance_update: "amber", consumable_delivery: "violet", inspection_note: "blue", other: "slate",
};

export default function Messages() {
  const db = useDB();
  const { aiMode, mutate, now } = useStore();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") ?? (db.rawMessages.length ? "compare" : "raw")) as "raw" | "compare" | "review" | "events";
  const setTab = (t: string) => setSp({ tab: t }, { replace: true });
  const st = importStats(db);
  const [drag, setDrag] = useState(false);

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    let wa = "";
    const emails: unknown[] = [];
    for (const f of Array.from(files)) {
      const text = await f.text();
      if (f.name.endsWith(".json")) emails.push(...(JSON.parse(text) as unknown[]));
      else if (f.name.endsWith(".eml")) emails.push(parseEml(text, emails.length));
      else wa += text + "\n";
    }
    await importMessages(wa || null, emails.length ? emails : null);
    setTab("compare");
  };

  return (
    <div>
      <PageHeader
        title="Message intelligence · WhatsApp group and email"
        sub={`Turns existing, unstructured messages into structured events linked to their source. Engine: ${aiMode === "live" ? "Claude (Live)" : "deterministic rules (Mock)"}; ≥ 0.85 confidence is auto-accepted, the rest goes to review.`}
        actions={
          <>
            <Button variant="primary" onClick={async () => { await importSampleMessages(); setTab("compare"); }}>
              <Upload size={14} /> Import sample export
            </Button>
            <label
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
              className={cx("cursor-pointer rounded-lg border-2 border-dashed px-3 py-1.5 text-sm text-slate-600", drag ? "border-accent-500 bg-accent-50" : "border-slate-300")}
              title="WhatsApp 'Export chat' .txt, emails as .json or .eml"
            >
              Drop a WhatsApp .txt / .eml / .json here, or browse
              <input type="file" multiple accept=".txt,.json,.eml" className="hidden" onChange={(e) => onFiles(e.target.files)} />
            </label>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Kpi label="Raw messages" value={st.raw} sub="group chat + emails" />
        <Kpi label="Structured events" value={st.events} />
        <Kpi label="Auto-accepted" value={st.auto} tone="green" />
        <Kpi label="Needs review" value={st.review} tone={st.review ? "amber" : "green"} to="/messages?tab=review" />
        <Kpi label="Tasks inferred done" value={st.inferred} sub="reported in chat, not in workflow" tone="green" to="/tasks?source=whatsapp_group_extracted&view=list&from=2000-01-01" />
        <Kpi label="Linked to tickets" value={st.linked} to="/tickets" />
      </div>
      <div className="mb-3">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "raw", label: "Before: raw messages" }, { id: "compare", label: "Before / after" }, { id: "review", label: `Review queue (${st.review})` }, { id: "events", label: "All events" }]} />
      </div>
      {tab === "raw" && <RawView />}
      {tab === "compare" && (db.rawMessages.length ? <Compare /> : <Empty title="Nothing imported yet"><Button variant="primary" onClick={() => importSampleMessages()}>Import sample export</Button></Empty>)}
      {tab === "review" && <Review />}
      {tab === "events" && <EventsTable />}
      <p className="mt-4 text-xs text-slate-400">Simulated: no real WhatsApp group or mailbox is connected. In production, consent from group members is needed before analysing messages (see Discovery). Current time {dateTime(now)}.</p>
      <span className="hidden">{mutate.length}</span>
    </div>
  );
}

function parseEml(text: string, i: number) {
  const [head, ...rest] = text.split(/\r?\n\r?\n/);
  const h = (k: string) => head.match(new RegExp(`^${k}:\\s*(.+)$`, "mi"))?.[1]?.trim() ?? "";
  const from = h("From");
  return { id: `EML-U${i + 1}`, from: from.match(/<(.+)>/)?.[1] ?? from, from_name: from.replace(/<.+>/, "").replace(/"/g, "").trim() || from, to: h("To"), subject: h("Subject"), date: Date.parse(h("Date")) || Date.now(), body: rest.join("\n\n") };
}

function RawView() {
  const db = useDB();
  const [lines, setLines] = useState<RawMessage[]>([]);
  const [emails, setEmails] = useState<{ id: string; from_name: string; subject: string; date: number; body: string }[]>([]);
  useEffect(() => {
    if (db.rawMessages.length) {
      setLines(db.rawMessages.filter((m) => m.channel !== "email"));
      setEmails(db.rawMessages.filter((m) => m.channel === "email").map((m) => ({ id: m.id, from_name: m.sender, subject: m.subject ?? "", date: m.timestamp, body: m.text })));
      return;
    }
    fetch("/data/whatsapp_export.txt").then((r) => r.text()).then((t) => setLines(parseWhatsAppExport(t)));
    fetch("/data/emails.json").then((r) => r.json()).then(setEmails);
  }, [db.rawMessages.length]);
  const noise = lines.filter((l) => /^(good morning|ok|noted|👍|🙏|thanks)/i.test(l.text) || !l.text || /^forwarded/i.test(l.text)).length;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2" title={<span className="flex items-center gap-1"><MessageCircle size={14} /> "Lakeshore Greens Ops" group · {lines.length} messages · {noise} are greetings, "ok", photos without text or forwards</span>}>
        <WhatsAppList msgs={lines} />
      </Card>
      <Card title={<span className="flex items-center gap-1"><Mail size={14} /> Inbox · {emails.length} emails</span>}>
        <ul className="scroll-thin max-h-[65vh] space-y-2 overflow-y-auto">
          {emails.map((e) => (
            <li key={e.id} className="rounded-lg border border-slate-200 p-2 text-sm">
              <div className="text-xs text-slate-500">{dateTime(e.date)} · {e.from_name}</div>
              <div className="font-medium text-slate-800">{e.subject}</div>
              <div className="line-clamp-3 whitespace-pre-wrap text-xs text-slate-600">{e.body}</div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function WhatsAppList({ msgs, highlight, onClick, refs }: { msgs: RawMessage[]; highlight?: Set<string>; onClick?: (id: string) => void; refs?: React.MutableRefObject<Record<string, HTMLDivElement | null>> }) {
  const linked = useLinkedIds();
  let last = "";
  return (
    <div className="chat-bg scroll-thin max-h-[65vh] space-y-1 overflow-y-auto rounded-lg p-2">
      {msgs.map((m) => {
        const d = istDate(m.timestamp);
        const sep = d !== last;
        last = d;
        return (
          <div key={m.id} ref={(el) => refs && (refs.current[m.id] = el)}>
            {sep && <div className="my-2 text-center"><span className="rounded bg-white/80 px-2 py-0.5 text-[10px] text-slate-500">{dmyFromMs(m.timestamp)}</span></div>}
            <div onClick={() => onClick?.(m.id)} className={cx("max-w-[90%] cursor-default rounded-lg bg-white px-2 py-1 text-[13px] shadow-sm", highlight?.has(m.id) && "ring-2 ring-violet-500", onClick && linked.has(m.id) && "cursor-pointer border-l-4 border-violet-400")}>
              <div className="text-[11px] font-semibold text-teal-700">{m.sender}</div>
              <div className="whitespace-pre-wrap text-slate-800">{m.text || (m.attachments.includes("voice-note") ? "🎤 voice note" : "📷 photo")}</div>
              <div className="text-right text-[10px] text-slate-400">{time12(m.timestamp)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function useLinkedIds() {
  const db = useDB();
  return useMemo(() => new Set(db.extracted.flatMap((e) => e.message_ids)), [db.extracted.length]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Compare() {
  const db = useDB();
  const [sel, setSel] = useState<ExtractedEvent | null>(null);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const evRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const raw = db.rawMessages.filter((m) => m.channel !== "email");
  const rawById = new Map(db.rawMessages.map((m) => [m.id, m]));
  const events = [...db.extracted].sort((a, b) => (rawById.get(a.message_ids[0])?.timestamp ?? 0) - (rawById.get(b.message_ids[0])?.timestamp ?? 0));
  const pickEvent = (e: ExtractedEvent) => {
    setSel(e);
    refs.current[e.message_ids[0]]?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const pickMsg = (id: string) => {
    const e = events.find((x) => x.message_ids.includes(id));
    if (e) {
      setSel(e);
      evRefs.current[e.id]?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };
  let last = "";
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="Before: raw group chat (click a highlighted message)">
        <WhatsAppList msgs={raw} highlight={new Set(sel?.message_ids ?? [])} onClick={pickMsg} refs={refs} />
      </Card>
      <Card title={`After: structured timeline · ${events.length} events`}>
        <div className="scroll-thin max-h-[65vh] space-y-1.5 overflow-y-auto pr-1">
          {events.map((e) => {
            const src = rawById.get(e.message_ids[0]);
            const d = src ? istDate(src.timestamp) : "";
            const sep = d !== last;
            last = d;
            return (
              <div key={e.id} ref={(el) => (evRefs.current[e.id] = el)}>
                {sep && <div className="mb-1 mt-2 text-xs font-semibold text-slate-500">{src ? dmyFromMs(src.timestamp) : ""}</div>}
                <EventCard e={e} selected={sel?.id === e.id} onClick={() => pickEvent(e)} src={src} />
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function EventCard({ e, selected, onClick, src, actions }: { e: ExtractedEvent; selected?: boolean; onClick?: () => void; src?: RawMessage; actions?: React.ReactNode }) {
  const db = useDB();
  const tk = e.mapped.ticket_id ? db.tickets.find((t) => t.id === e.mapped.ticket_id) : null;
  return (
    <div onClick={onClick} className={cx("cursor-pointer rounded-lg border bg-white p-2 text-sm shadow-sm", selected ? "border-violet-500 ring-1 ring-violet-500" : "border-slate-200 hover:border-slate-300")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={TYPE_TONE[e.type]}>{titleCase(e.type)}</Badge>
        <span className="font-medium text-slate-800">{e.summary}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className={cx("font-semibold", e.confidence >= 0.85 ? "text-emerald-700" : e.confidence >= 0.6 ? "text-amber-700" : "text-red-700")}>conf {e.confidence.toFixed(2)}</span>
        <Badge tone={e.review_status === "auto_accepted" || e.review_status === "accepted" ? "green" : e.review_status === "rejected" ? "slate" : "amber"}>{e.review_status.replace("_", " ")}</Badge>
        <SourceBadge source={e.source} />
        <span>{e.engine}</span>
        {src && <span className="flex items-center gap-0.5"><Link2 size={11} />{src.channel === "email" ? `email "${src.subject}"` : `${src.sender}, ${time12(src.timestamp)}`}</span>}
      </div>
      {e.note && <div className="mt-1 text-xs text-slate-600">{e.note}</div>}
      <div className="mt-1 flex flex-wrap gap-2 text-xs">
        {e.mapped.task_ids?.slice(0, 4).map((id) => <Link key={id} to={`/tasks?id=${id}`} onClick={(ev) => ev.stopPropagation()} className="text-accent-600 hover:underline">task {id}</Link>)}
        {tk && <Link to={`/tickets/${tk.id}`} onClick={(ev) => ev.stopPropagation()} className="text-accent-600 hover:underline">ticket {tk.number}</Link>}
        {e.mapped.inspection_id && <span className="text-slate-500">inspection {e.mapped.inspection_id}</span>}
      </div>
      {actions}
    </div>
  );
}

function Review() {
  const db = useDB();
  const { mutate } = useStore();
  const queue = db.extracted.filter((e) => e.review_status === "needs_review");
  const rawById = new Map(db.rawMessages.map((m) => [m.id, m]));
  const [edits, setEdits] = useState<Record<string, ExtractedType>>({});
  if (!queue.length) return <Empty title="Review queue is empty">{db.rawMessages.length ? "Everything above the confidence threshold was auto-accepted." : "Import messages first."}</Empty>;
  return (
    <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
      {queue.map((e) => {
        const srcs = e.message_ids.map((id) => rawById.get(id)).filter(Boolean) as RawMessage[];
        return (
          <Card key={e.id}>
            <div className="mb-2 rounded-lg bg-slate-50 p-2 text-sm">
              {srcs.map((m) => (
                <div key={m.id}>
                  <span className="text-xs text-slate-400">{dateTime(m.timestamp)} · {m.sender}{m.subject ? ` · ${m.subject}` : ""}</span>
                  <div className="whitespace-pre-wrap text-slate-800">{(m.text || (m.attachments.includes("voice-note") ? "🎤 voice note" : "📷 photo")).slice(0, 400)}</div>
                </div>
              ))}
            </div>
            <EventCard e={e} src={srcs[0]} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select className="rounded border px-1 py-1 text-xs" value={edits[e.id] ?? e.type} onChange={(ev) => setEdits({ ...edits, [e.id]: ev.target.value as ExtractedType })}>
                {(["task_completed", "issue_reported", "meter_reading", "attendance_update", "consumable_delivery", "inspection_note", "other"] as const).map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
              </select>
              <Button size="sm" variant="success" onClick={() => mutate((w) => { if (edits[e.id]) e.type = edits[e.id]; e.review_status = "accepted"; applyEvent(w, e, rawById); })}>Accept</Button>
              <Button size="sm" variant="ghost" onClick={() => mutate(() => { e.review_status = "rejected"; e.updated_at = Date.now(); })}>Reject</Button>
              <span className="text-[11px] text-slate-400">Accepting applies it: e.g. raises the ticket or adds the delivery.</span>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function EventsTable() {
  const db = useDB();
  const rawById = new Map(db.rawMessages.map((m) => [m.id, m]));
  if (!db.extracted.length) return <Empty title="No events yet" />;
  return (
    <Card>
      <div className="scroll-thin max-h-[65vh] overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0"><tr><Th>When</Th><Th>Type</Th><Th>Summary</Th><Th>Conf</Th><Th>Status</Th><Th>Source</Th></tr></thead>
          <tbody>
            {db.extracted.map((e) => {
              const s = rawById.get(e.message_ids[0]);
              return (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap text-xs">{s ? dateTime(s.timestamp) : ""}</Td>
                  <Td><Badge tone={TYPE_TONE[e.type]}>{titleCase(e.type)}</Badge></Td>
                  <Td>{e.summary}<div className="text-xs text-slate-500">{e.note}</div></Td>
                  <Td>{e.confidence.toFixed(2)}</Td>
                  <Td className="text-xs">{e.review_status.replace("_", " ")}</Td>
                  <Td className="max-w-[260px] truncate text-xs text-slate-500" >{s?.sender}: {s?.subject ?? s?.text}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
