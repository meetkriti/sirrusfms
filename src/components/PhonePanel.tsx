import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ChevronRight, Mic, Send, Smartphone, X, CheckCheck } from "lucide-react";
import { useDB, useStore } from "../store";
import { staffById } from "../engine/core";
import { time12, dmyFromMs } from "../lib/format";
import { istDate } from "../lib/time";
import { cx } from "./ui";

export const PERSONAS: { id: string; hint: string; suggestions: string[]; photos: string[] }[] = [
  { id: "sup_hk", hint: "Housekeeping Supervisor", suggestions: ["A tower ho gaya sir", "1", "C tower staff leave today", "Lift lobby done all towers"], photos: ["/samples/staircase.svg", "/samples/lift_lobby.svg", "/samples/washroom.svg", "/samples/garbage.svg"] },
  { id: "stp_op1", hint: "STP Operator (morning)", suggestions: ["START", "7.2", "9.1", "Rechecked, dosing pump issue", "3150", "6"], photos: ["/samples/stp_outlet.svg"] },
  { id: "client_sec", hint: "Client: AOA Secretary", suggestions: ["Lift in B tower again stuck between 7 and 8 floor. Please check urgently", "Bad smell near clubhouse again", "Garbage not cleared near the service lift", "YES", "NO"], photos: ["/samples/lift_issue.svg", "/samples/odour_drain.svg"] },
  { id: "sup_tech", hint: "Technical Supervisor (meter photos)", suggestions: ["Done", "kal karenge"], photos: ["/samples/meters/meter_B1204.png", "/samples/meters/meter_A0302.png", "/samples/meters/meter_D0902.png", "/samples/meters/meter_unknown.png"] },
  { id: "sup_sec", hint: "Security Supervisor", suggestions: ["Done", "8", "YES"], photos: ["/samples/patrol.svg"] },
  { id: "sec_sup2", hint: "Security shift supervisor (afternoon)", suggestions: ["START", "7", "YES", "1 guard absent, reliever not available"], photos: [] },
  { id: "sup_land", hint: "Landscaping Supervisor", suggestions: ["Garden watering ho gaya", "1"], photos: ["/samples/garden.svg"] },
  { id: "fm", hint: "Facility Manager (receives alerts)", suggestions: ["ok"], photos: [] },
];

export default function PhonePanel() {
  const db = useDB();
  const { phoneOwner, setPhoneOwner, phoneOpen, setPhoneOpen, sendFromPhone, now } = useStore();
  const [text, setText] = useState("");
  const [picker, setPicker] = useState(false);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const msgs = useMemo(() => db.chat.filter((m) => m.phone_owner === phoneOwner && m.at <= now).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)), [db.chat.length, phoneOwner, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const persona = PERSONAS.find((p) => p.id === phoneOwner) ?? PERSONAS[0];
  const person = staffById(db, phoneOwner);
  const lastBotWithButtons = [...msgs].reverse().find((m) => m.from === "bot" && m.buttons?.length);
  // A button stays tappable while the task/ticket it refers to is still open (or it is the latest prompt).
  const buttonLive = (m: (typeof msgs)[number], id: string) => {
    if (m === lastBotWithButtons) return true;
    const ref = id.split(":")[1];
    const task = ref ? db.tasks.find((t) => t.id === ref) : null;
    if (task) return ["scheduled", "sent", "in_progress", "missed"].includes(task.status) && task.date === istDate(now);
    const tk = ref ? db.tickets.find((t) => t.id === ref) : null;
    if (tk) return id.startsWith("close_") ? tk.status === "resolved" : !["resolved", "closed"].includes(tk.status);
    return false;
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs.length, phoneOwner]);

  if (!phoneOpen)
    return (
      <button onClick={() => setPhoneOpen(true)} className="no-print flex w-9 shrink-0 flex-col items-center gap-2 border-l border-slate-200 bg-white pt-4 text-xs text-slate-500 hover:bg-slate-50" title="Open WhatsApp simulator">
        <Smartphone size={18} />
        <span className="[writing-mode:vertical-rl]">WhatsApp simulator</span>
      </button>
    );

  const send = async (input: { text?: string; buttonId?: string; buttonTitle?: string; photo?: string }) => {
    setSending(true);
    try {
      await sendFromPhone(input);
    } finally {
      setSending(false);
    }
  };
  const submit = () => {
    if (!text.trim()) return;
    send({ text: text.trim() });
    setText("");
  };

  let lastDay = "";
  return (
    <aside className="no-print flex w-[360px] shrink-0 flex-col border-l border-slate-200 bg-slate-100 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Smartphone size={16} className="text-slate-500" />
        <select className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm" value={phoneOwner} onChange={(e) => setPhoneOwner(e.target.value)}>
          {PERSONAS.map((p) => (
            <option key={p.id} value={p.id}>
              {staffById(db, p.id)?.name} · {p.hint}
            </option>
          ))}
        </select>
        <button onClick={() => setPhoneOpen(false)} className="rounded p-1 text-slate-500 hover:bg-slate-200" title="Collapse">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border-[6px] border-slate-800 bg-white shadow-lg">
        <div className="flex items-center gap-2 bg-chat-head px-3 py-2 text-white">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-bold">PS</div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Paradigm Ops Bot</div>
            <div className="text-[10px] opacity-80">Simulated chat on {person?.name}'s phone · not WhatsApp</div>
          </div>
        </div>
        <div className="chat-bg scroll-thin flex-1 space-y-1.5 overflow-y-auto px-2.5 py-2">
          {msgs.length === 0 && <div className="mt-10 text-center text-xs text-slate-500">No messages yet for {person?.name}. Advance the clock or type below.</div>}
          {msgs.map((m) => {
            const day = istDate(m.at);
            const sep = day !== lastDay;
            lastDay = day;
            return (
              <div key={m.id}>
                {sep && <div className="my-2 text-center"><span className="rounded-md bg-white/80 px-2 py-0.5 text-[10px] text-slate-500 shadow-sm">{dmyFromMs(m.at)}</span></div>}
                <div className={cx("flex", m.from === "user" ? "justify-end" : "justify-start")}>
                  <div className={cx("max-w-[85%] rounded-lg px-2 py-1 text-[13px] shadow-sm", m.from === "user" ? "bg-chat-out" : "bg-white")}>
                    {m.photo && <img src={m.photo} alt="attachment" className="mb-1 max-h-40 rounded" />}
                    {m.text && <div className="whitespace-pre-wrap break-words text-slate-800">{m.text}</div>}
                    <div className="mt-0.5 flex items-center justify-end gap-0.5 text-[10px] text-slate-400">
                      {time12(m.at)}
                      {m.from === "user" && <CheckCheck size={12} className="text-sky-500" />}
                    </div>
                  </div>
                </div>
                {m.from === "bot" && m.buttons && (
                  <div className="ml-0 mt-1 flex max-w-[85%] flex-wrap gap-1">
                    {m.buttons.map((b) => (
                      <button key={b.id} disabled={sending || !buttonLive(m, b.id)} onClick={() => send({ buttonId: b.id, buttonTitle: b.title })} className="rounded-full border border-sky-200 bg-white px-2.5 py-0.5 text-xs font-medium text-sky-700 shadow-sm hover:bg-sky-50 disabled:opacity-40">
                        {b.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
        {picker && (
          <div className="border-t bg-white p-2">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              Choose a sample photo
              <button onClick={() => setPicker(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {[...new Set([...persona.photos, "/samples/staircase.svg", "/samples/stp_outlet.svg", "/samples/meters/meter_B1204.png", "/samples/meters/meter_C0805.png", "/samples/lift_issue.svg"])].map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setPicker(false);
                    send({ photo: p, text: text.trim() || undefined });
                    setText("");
                  }}
                  className="overflow-hidden rounded border hover:ring-2 hover:ring-sky-400"
                  title={p.split("/").pop()}
                >
                  <img src={p} alt="" className="h-12 w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="border-t bg-slate-50 px-2 pb-2 pt-1.5">
          <div className="mb-1.5 flex gap-1 overflow-x-auto pb-0.5 scroll-thin">
            {persona.suggestions.map((s) => (
              <button key={s} onClick={() => send({ text: s })} disabled={sending} className="shrink-0 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100">
                {s.length > 34 ? s.slice(0, 32) + "…" : s}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setPicker(!picker)} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-200" title="Send a photo">
              <Camera size={18} />
            </button>
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Type a message" className="min-w-0 flex-1 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-sky-400" />
            <button onClick={submit} disabled={sending} className="rounded-full bg-chat-head p-2 text-white hover:opacity-90" title="Send">
              {text ? <Send size={15} /> : <Mic size={15} />}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
