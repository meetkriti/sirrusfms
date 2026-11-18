import { useState } from "react";
import { useDB, useStore } from "../store";
import { config, type AlertRule } from "../config";
import { duration, titleCase } from "../lib/format";
import { Badge, Card, PageHeader, Tabs, Td, Th, Warn } from "../components/ui";

export default function Settings() {
  const [tab, setTab] = useState<"rules" | "sla" | "hierarchy" | "billing" | "templates">("rules");
  return (
    <div>
      <PageHeader title="Settings" sub="Everything marked [ASSUMPTION] is proposed by Sirrus and editable. Changes apply live to this session; defaults live in /config/*.json." />
      <div className="mb-3">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "rules", label: "Alert rules" }, { id: "sla", label: "SLA matrix" }, { id: "hierarchy", label: "Hierarchy" }, { id: "billing", label: "Billing rules" }, { id: "templates", label: "Checklist templates" }]} />
      </div>
      {tab === "rules" && <Rules />}
      {tab === "sla" && <Sla />}
      {tab === "hierarchy" && <Hierarchy />}
      {tab === "billing" && <BillingRules />}
      {tab === "templates" && <Templates />}
    </div>
  );
}

const TARGETS = ["assignee", "supervisor", "tech_supervisor", "security_supervisor", "fm", "zonal", "ops_head", "finance"];

function Num({ value, onChange, w = "w-16" }: { value: number | null | undefined; onChange: (n: number) => void; w?: string }) {
  return <input type="number" value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} className={`${w} rounded border px-1 py-0.5 text-sm`} />;
}

function Rules() {
  const { mutate } = useStore();
  useDB();
  const upd = (r: AlertRule, fn: () => void) => mutate(() => fn());
  return (
    <div className="space-y-2">
      <Warn>[ASSUMPTION] Default rules. Edit thresholds here and advance the clock: the engine uses the new values immediately.</Warn>
      {config.alertRules.map((r) => (
        <Card key={r.id}>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={r.enabled} onChange={(e) => upd(r, () => (r.enabled = e.target.checked))} />
              <Badge>{r.id}</Badge>
              <span className="font-semibold">{r.name}</span>
            </label>
            <select value={r.severity} onChange={(e) => upd(r, () => (r.severity = e.target.value as AlertRule["severity"]))} className="rounded border px-1 py-0.5 text-sm">
              {["info", "warning", "high"].map((s) => <option key={s}>{s}</option>)}
            </select>
            {r.trigger === "task_not_started_at_due" && <span className="text-sm">Remind <Num value={r.offset_min} onChange={(n) => upd(r, () => (r.offset_min = n))} /> min after due time</span>}
            {r.trigger === "task_overdue" && (
              <span className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={!!r.use_template_grace} onChange={(e) => upd(r, () => (r.use_template_grace = e.target.checked))} /> use each template's grace period, otherwise
                <Num value={r.grace_override_min ?? 30} onChange={(n) => upd(r, () => (r.grace_override_min = n))} /> min
              </span>
            )}
            {r.trigger === "recurring_miss" && <span className="text-sm">Missed <Num value={r.count} onChange={(n) => upd(r, () => (r.count = n))} w="w-12" /> times in <Num value={r.window_days} onChange={(n) => upd(r, () => (r.window_days = n))} w="w-12" /> days</span>}
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={!!r.send_whatsapp} onChange={(e) => upd(r, () => (r.send_whatsapp = e.target.checked))} /> WhatsApp</label>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            Notify:
            {TARGETS.map((t) => (
              <label key={t} className="flex items-center gap-1">
                <input type="checkbox" checked={r.notify.includes(t)} onChange={(e) => upd(r, () => (r.notify = e.target.checked ? [...r.notify, t] : r.notify.filter((x) => x !== t)))} />
                {config.hierarchy.alertRoleTargets[t] ?? t}
              </label>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function Sla() {
  const { mutate } = useStore();
  useDB();
  return (
    <Card title="SLA matrix [ASSUMPTION, editable]">
      <table className="w-full">
        <thead><tr><Th>Priority</Th><Th>Examples</Th><Th>Response (min)</Th><Th>Resolution (min)</Th><Th>Escalation path (minutes after raising)</Th></tr></thead>
        <tbody>
          {(["P1", "P2", "P3"] as const).map((p) => {
            const r = config.sla[p];
            return (
              <tr key={p}>
                <Td className="font-semibold">{p}</Td>
                <Td className="text-xs">{r.examples}</Td>
                <Td><Num value={r.response_min} onChange={(n) => mutate(() => (r.response_min = n))} /></Td>
                <Td><Num value={r.resolution_min} onChange={(n) => mutate(() => (r.resolution_min = n))} w="w-20" /> <span className="text-xs text-slate-500">{duration(r.resolution_min * 60000)}</span></Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    L1 →
                    {r.escalation.map((s, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {s.level} at <Num value={s.after_min} onChange={(n) => mutate(() => (s.after_min = n))} /> ({duration(s.after_min * 60000)}) {i < r.escalation.length - 1 && "→"}
                      </span>
                    ))}
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">New values apply to open tickets from the next simulated minute. Already-recorded escalations are not undone.</p>
    </Card>
  );
}

function Hierarchy() {
  const db = useDB();
  const { mutate } = useStore();
  const h = config.hierarchy;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="Levels [ASSUMPTION: Paradigm to confirm]">
        <table className="w-full">
          <thead><tr><Th>Level</Th><Th>Title</Th><Th>Channel</Th></tr></thead>
          <tbody>
            {h.levels.map((l) => (
              <tr key={l.level}>
                <Td className="font-semibold">{l.level}</Td>
                <Td><input value={l.title} onChange={(e) => mutate(() => (l.title = e.target.value))} className="w-full rounded border px-1 py-0.5 text-sm" /></Td>
                <Td className="text-xs">{l.channel}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Owners per level and service line">
        <table className="w-full text-sm">
          <tbody>
            {Object.entries(h.owners.L1).map(([sl, id]) => (
              <tr key={sl}>
                <Td>L1 · {titleCase(sl)}</Td>
                <Td>
                  <select value={id} onChange={(e) => mutate(() => (h.owners.L1[sl] = e.target.value))} className="rounded border px-1 py-0.5 text-sm">
                    {db.staff.filter((s) => s.level === "L1").map((s) => <option key={s.id} value={s.id}>{s.name} · {s.title}</option>)}
                  </select>
                </Td>
              </tr>
            ))}
            {(["L2", "L3", "L4"] as const).map((l) => (
              <tr key={l}><Td>{l}</Td><Td>{db.staff.find((s) => s.id === h.owners[l])?.name} · {db.staff.find((s) => s.id === h.owners[l])?.title}</Td></tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Reporting lines (sample staff)" className="xl:col-span-2">
        <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs md:grid-cols-3">
          {db.staff.filter((s) => s.level !== "L0").map((s) => (
            <div key={s.id}><span className="font-medium">{s.name}</span> · {s.title} <span className="text-slate-400">→ {db.staff.find((x) => x.id === s.reports_to)?.name ?? "—"}</span></div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">{db.staff.filter((s) => s.level === "L0").length} ground staff (L0) report to their service-line supervisors. All names and phone numbers are fictional.</p>
      </Card>
    </div>
  );
}

function BillingRules() {
  const { mutate } = useStore();
  useDB();
  const b = config.billing;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="Security billing rule [ASSUMPTION]">
        <div className="space-y-2 text-sm">
          <div>Guard rate per man-day (₹) <Num value={b.security.guard_rate_per_man_day} onChange={(n) => mutate(() => (b.security.guard_rate_per_man_day = n))} w="w-24" /></div>
          <div>Supervisor rate per man-day (₹) <Num value={b.security.supervisor_rate_per_man_day} onChange={(n) => mutate(() => (b.security.supervisor_rate_per_man_day = n))} w="w-24" /></div>
          <div>Contracted guards per shift <Num value={b.security.contracted_guards_per_shift} onChange={(n) => mutate(() => (b.security.contracted_guards_per_shift = n))} /></div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={b.security.count_approved_replacements} onChange={(e) => mutate(() => (b.security.count_approved_replacements = e.target.checked))} /> Count approved replacements as billable</label>
          <div>Half-day factor <Num value={b.security.half_day_factor} onChange={(n) => mutate(() => (b.security.half_day_factor = n))} /></div>
        </div>
      </Card>
      <Card title="Fixed monthly manpower (sample amounts)">
        {b.fixed_monthly.map((f) => (
          <div key={f.service_line} className="mb-1 flex items-center justify-between text-sm">
            <span>{f.label}</span>
            <Num value={f.amount} onChange={(n) => mutate(() => (f.amount = n))} w="w-28" />
          </div>
        ))}
        <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={b.consumables.require_acknowledgement} onChange={(e) => mutate(() => (b.consumables.require_acknowledgement = e.target.checked))} /> Consumables need acknowledgement to be billable</label>
      </Card>
    </div>
  );
}

function Templates() {
  const db = useDB();
  return (
    <Card title={`Checklist templates [ASSUMPTION] · ${db.templates.length}`}>
      <table className="w-full">
        <thead><tr><Th>Checklist</Th><Th>Service line</Th><Th>Locations</Th><Th>Frequency</Th><Th>Due</Th><Th>Grace</Th><Th>Photo</Th><Th>Items</Th></tr></thead>
        <tbody>
          {db.templates.map((t) => (
            <tr key={t.id}>
              <Td className="font-medium">{t.name}<div className="text-[11px] text-slate-400">{t.sop} · {t.mode === "stepwise" ? "walks items one at a time" : "quick reply"}</div></Td>
              <Td className="text-xs">{titleCase(t.service_line)}</Td>
              <Td className="text-xs">{t.locations.join(", ")}</Td>
              <Td className="text-xs">{titleCase(t.frequency)}{t.weekday !== undefined ? ` (${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][t.weekday]})` : ""}{t.day_of_month ? ` (day ${t.day_of_month})` : ""}</Td>
              <Td className="text-xs">{t.due_times.join(", ")}</Td>
              <Td className="text-xs">{t.grace_min} min</Td>
              <Td>{t.photo_required ? "Yes" : "No"}</Td>
              <Td className="text-xs">{t.items.map((i) => `${i.label}${i.type === "numeric_reading" ? ` [${i.min}–${i.max}]` : ""}`).join("; ")}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
