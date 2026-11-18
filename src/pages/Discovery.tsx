import { useState } from "react";
import { Card, PageHeader, cx } from "../components/ui";

const QUESTIONS: { area: string; q: string; why: string }[] = [
  { area: "Hierarchy", q: "What is the actual hierarchy, titles and span of control (site → zone → management)?", why: "Drives escalation owners and who sees which alerts (config/hierarchy.json)." },
  { area: "Checklists", q: "Which checklist templates, frequencies and photo-proof items do you use today?", why: "Replaces the 17 sample templates (config/checklist_templates.json)." },
  { area: "KPIs", q: "Which 5–8 data points matter most to management and to clients?", why: "Decides the dashboard tiles and the client report." },
  { area: "SLAs", q: "What SLA do you expect per complaint category? Are SLAs written into client agreements?", why: "Replaces the sample P1–P3 matrix (config/sla_matrix.json)." },
  { area: "Security billing", q: "How are replacements, half-days, overtime and relievers billed?", why: "Billable man-day rule (config/billing_rules.json)." },
  { area: "Billing software", q: "Which billing software do you use, and what is its import format for meter readings and invoices?", why: "Export column mapping (config/meter_export_format.json)." },
  { area: "Meters", q: "Which meter types do you read, how are meters labelled in the field, and what are the reading cycle dates?", why: "Meter master, matching and validation rules." },
  { area: "Consumables", q: "How are consumable deliveries acknowledged today (signature, photo, register)?", why: "What counts as proof for billing." },
  { area: "WhatsApp", q: "Which WhatsApp groups exist per project, who is in them, and do members consent to message analysis?", why: "Required before reading group messages; Business API onboarding." },
  { area: "People", q: "Which languages do ground staff use, and how comfortable are they with photos and voice notes?", why: "Prompt language, Hinglish/Kannada handling, voice-note transcription." },
  { area: "Pilot", q: "Which one or two use cases would you prioritise for a pilot, and on which project?", why: "Scopes the first engagement." },
];

export default function Discovery() {
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [done, setDone] = useState<Record<number, boolean>>({});
  return (
    <div>
      <PageHeader title="Discovery: to confirm with Paradigm" sub="Everything below is an assumption in this prototype. Use this page to turn the demo into a structured discovery conversation. Notes stay in this browser session only." />
      <div className="space-y-2">
        {QUESTIONS.map((x, i) => (
          <Card key={i} className={cx(done[i] && "opacity-70")}>
            <div className="flex items-start gap-3">
              <input type="checkbox" className="mt-1" checked={!!done[i]} onChange={(e) => setDone({ ...done, [i]: e.target.checked })} title="Confirmed" />
              <div className="flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-accent-600">{x.area}</div>
                <div className="font-medium text-slate-800">{x.q}</div>
                <div className="text-xs text-slate-500">Why it matters: {x.why}</div>
                <textarea value={notes[i] ?? ""} onChange={(e) => setNotes({ ...notes, [i]: e.target.value })} rows={1} placeholder="Notes from the conversation…" className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-sm" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
