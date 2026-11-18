import type { TaskInstance } from "../types";
import { useDB } from "../store";
import { staffName, taskTitle, templateById } from "../engine/core";
import { dateTime, dmy, time12, titleCase } from "../lib/format";
import { Badge, StatusPill } from "./ui";

export function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { label: string; tone: "green" | "violet" | "blue" | "slate" }> = {
    whatsapp_workflow: { label: "WhatsApp workflow", tone: "green" },
    whatsapp_group_extracted: { label: "Extracted from group chat", tone: "violet" },
    email_extracted: { label: "Extracted from email", tone: "violet" },
    dashboard: { label: "Dashboard", tone: "blue" },
    seed: { label: "Seed", tone: "slate" },
  };
  const m = map[source] ?? { label: source, tone: "slate" as const };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export default function TaskDetail({ task }: { task: TaskInstance }) {
  const db = useDB();
  const tpl = templateById(db, task.template_id)!;
  const chat = db.chat.filter((m) => m.task_id === task.id).sort((a, b) => a.at - b.at);
  const raw = (task.extracted_from ?? []).map((id) => db.rawMessages.find((m) => m.id === id)).filter(Boolean);
  const sop = db.sops.find((s) => s.id === tpl.sop);
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-semibold text-slate-800">{taskTitle(db, task.template_id, task.location_id)}</div>
        <StatusPill status={task.status} />
        <SourceBadge source={task.source} />
        {task.out_of_range?.length ? <Badge tone="red">Out of range: {task.out_of_range.join(", ")}</Badge> : null}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <Field k="Date" v={dmy(task.date)} />
        <Field k="Due" v={time12(task.due_at)} />
        <Field k="Completed" v={task.completed_at ? time12(task.completed_at) : "—"} />
        <Field k="Assignee" v={staffName(db, task.assignee_id)} />
        <Field k="Frequency" v={titleCase(tpl.frequency)} />
        <Field k="Grace" v={`${tpl.grace_min} min`} />
        <Field k="Photo required" v={tpl.photo_required ? "Yes" : "No"} />
        <Field k="SOP" v={tpl.sop} />
      </div>
      {Object.keys(task.responses).length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Checklist responses</div>
          <ul className="space-y-0.5 text-sm">
            {tpl.items.filter((i) => i.type !== "photo").map((i) => (
              <li key={i.id} className="flex justify-between gap-3 border-b border-slate-100 py-0.5">
                <span className="text-slate-600">{i.label}</span>
                <span className={task.out_of_range?.includes(i.id) ? "font-semibold text-red-700" : "font-medium"}>
                  {task.responses[i.id] === undefined ? "—" : typeof task.responses[i.id] === "boolean" ? (task.responses[i.id] ? "Yes" : "No") : `${task.responses[i.id]} ${i.unit ?? ""}`}
                  {i.type === "numeric_reading" && <span className="ml-1 text-xs font-normal text-slate-400">({i.min}–{i.max})</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {task.remarks && <div className="rounded bg-amber-50 px-2 py-1 text-sm text-amber-900">Remarks: {task.remarks}</div>}
      {task.photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {task.photos.map((p, i) => (
            <img key={i} src={p} alt="proof" className="h-28 rounded border" />
          ))}
        </div>
      )}
      <div>
        <div className="mb-1 text-xs font-semibold uppercase text-slate-500">WhatsApp trail</div>
        {chat.length ? (
          <ul className="space-y-1 text-sm">
            {chat.map((m) => (
              <li key={m.id} className="flex gap-2">
                <span className="w-16 shrink-0 text-xs text-slate-400">{time12(m.at)}</span>
                <span className={m.from === "bot" ? "text-slate-600" : "font-medium text-emerald-800"}>
                  {m.from === "bot" ? "Bot: " : `${staffName(db, m.phone_owner)}: `}
                  {m.text}
                  {m.photo && " 📷"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="space-y-1 text-sm text-slate-600">
            <li>
              <span className="mr-2 text-xs text-slate-400">{dateTime(task.send_at)}</span>Bot prompt sent to {staffName(db, task.assignee_id)}
            </li>
            {task.completed_at && task.source === "whatsapp_workflow" && (
              <li>
                <span className="mr-2 text-xs text-slate-400">{dateTime(task.completed_at)}</span>Reply: Done{task.photos.length ? " + photo" : ""}
              </li>
            )}
            {task.status === "missed" && <li className="text-red-700">No completion received; reminder and R2 alert at due + {tpl.grace_min} min.</li>}
          </ul>
        )}
        {raw.length > 0 && (
          <div className="mt-2 rounded border border-violet-200 bg-violet-50 p-2 text-sm">
            <div className="mb-1 text-xs font-semibold text-violet-700">Inferred from group chat (source messages)</div>
            {raw.map((m) => (
              <div key={m!.id} className="text-violet-900">
                <span className="mr-1 text-xs text-violet-500">{dateTime(m!.timestamp)}</span>
                {m!.sender}: {m!.text || "<photo>"}
              </div>
            ))}
          </div>
        )}
      </div>
      {sop && <details className="text-xs text-slate-500"><summary className="cursor-pointer">{sop.title}</summary><p className="mt-1">{sop.text}</p></details>}
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase text-slate-400">{k}</div>
      <div className="text-slate-700">{v}</div>
    </div>
  );
}
