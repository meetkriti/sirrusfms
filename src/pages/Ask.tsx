import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bot, Send, User } from "lucide-react";
import { useDB, useStore } from "../store";
import { ask, type AskAnswer } from "../ai/client";
import { Badge, Card, MiniMarkdown, PageHeader, Spinner, Warn } from "../components/ui";

const SUGGESTED = [
  "How did Tower C housekeeping do last week?",
  "Which tickets breached SLA this month and who owned them?",
  "How many security man-days are billable for October?",
  "Which water meters look abnormal this month?",
  "What keeps going wrong in Tower B?",
  "Kal STP ka log fill hua tha?",
  "What was the diesel cost this month?",
];

interface Turn {
  q: string;
  a?: AskAnswer;
}

export default function Ask() {
  const db = useDB();
  const { now, aiMode, role } = useStore();
  const [sp, setSp] = useSearchParams();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const asked = useRef<string | null>(null);
  const allowed = ["fm", "zonal", "ops_head", "finance"].includes(role);

  const run = async (question: string) => {
    if (!question.trim() || busy) return;
    setBusy(true);
    setTurns((t) => [...t, { q: question }]);
    const history = turns.flatMap((t) => (t.a ? [{ role: "user" as const, content: t.q }, { role: "assistant" as const, content: t.a.text }] : []));
    const a = await ask(aiMode, db, now, question, history);
    setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a } : x)));
    setBusy(false);
  };

  useEffect(() => {
    const pre = sp.get("q");
    if (pre && allowed && asked.current !== pre) {
      asked.current = pre;
      setSp({}, { replace: true });
      run(pre);
    }
  }, [sp.get("q")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Ask Paradigm" sub={`Plain-English or Hinglish questions answered from the project's records through tools (no free-form SQL). Mode: ${aiMode === "live" ? "Live (Claude with tool use)" : "Mock (deterministic tool routing)"}.`} />
      {!allowed && <Warn>Ask Paradigm is available to the Facility Manager, Zonal Manager, Operations Head and Finance roles. Switch role in the top bar.</Warn>}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {SUGGESTED.map((s) => (
          <button key={s} disabled={!allowed || busy} onClick={() => run(s)} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50">
            {s}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-[300px] flex-1 space-y-4 overflow-y-auto pb-4">
        {turns.length === 0 && <div className="py-10 text-center text-sm text-slate-400">Pick a suggested question or type your own.</div>}
        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="flex items-start justify-end gap-2">
              <div className="max-w-2xl rounded-xl bg-slate-900 px-3 py-2 text-sm text-white">{t.q}</div>
              <User size={18} className="mt-1 text-slate-400" />
            </div>
            <div className="flex items-start gap-2">
              <Bot size={18} className="mt-1 text-accent-600" />
              <div className="max-w-3xl flex-1">
                {!t.a ? (
                  <Spinner label="Looking it up in the records…" />
                ) : (
                  <Card>
                    {t.a.error && <div className="mb-2"><Warn>{t.a.error}</Warn></div>}
                    <MiniMarkdown text={t.a.text} />
                    {t.a.evidence.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-2 text-xs">
                        <span className="text-slate-500">Evidence:</span>
                        {dedupe(t.a.evidence).slice(0, 10).map((e) => (
                          <Link key={e.route + e.label} to={e.route} className="rounded bg-slate-100 px-1.5 py-0.5 text-accent-700 hover:bg-slate-200">
                            {e.label}
                          </Link>
                        ))}
                      </div>
                    )}
                    <details className="mt-2 text-xs text-slate-500">
                      <summary className="cursor-pointer">
                        Figures used · {t.a.calls.length} tool call(s) <Badge tone={t.a.mode === "live" ? "violet" : "slate"}>{t.a.mode}</Badge>
                      </summary>
                      {t.a.calls.map((c, k) => (
                        <div key={k} className="mt-1">
                          <div className="font-mono text-slate-700">
                            {c.name}({JSON.stringify(c.input)})
                          </div>
                          <pre className="scroll-thin max-h-48 overflow-auto rounded bg-slate-50 p-2 text-[11px]">{JSON.stringify(c.result, null, 1).slice(0, 4000)}</pre>
                        </div>
                      ))}
                    </details>
                  </Card>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="sticky bottom-0 flex gap-2 border-t bg-slate-50 pt-3">
        <input
          value={q}
          disabled={!allowed}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              run(q);
              setQ("");
            }
          }}
          placeholder="e.g. Pichle hafte security ka attendance kaisa tha?"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button disabled={!allowed || busy} onClick={() => { run(q); setQ(""); }} className="rounded-lg bg-accent-600 px-3 text-white disabled:opacity-50">
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}

function dedupe<T extends { route: string; label: string }>(xs: T[]) {
  const s = new Set<string>();
  return xs.filter((x) => (s.has(x.route + x.label) ? false : (s.add(x.route + x.label), true)));
}
