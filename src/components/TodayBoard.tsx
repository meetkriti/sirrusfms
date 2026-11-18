import { useState } from "react";
import type { TaskInstance } from "../types";
import { useDB, useStore } from "../store";
import { staffName, taskTitle, templateById } from "../engine/core";
import { time12 } from "../lib/format";
import { istDate } from "../lib/time";
import { cx, Modal, STATUS_META } from "./ui";
import TaskDetail from "./TaskDetail";

const COLS: { id: string; label: string; match: (t: TaskInstance) => boolean }[] = [
  { id: "scheduled", label: "Scheduled", match: (t) => t.status === "scheduled" },
  { id: "sent", label: "Sent", match: (t) => t.status === "sent" },
  { id: "in_progress", label: "In progress", match: (t) => t.status === "in_progress" },
  { id: "done", label: "Done", match: (t) => t.status === "done" || t.status === "done_late" },
  { id: "missed", label: "Missed", match: (t) => t.status === "missed" },
];

export default function TodayBoard({ compact, filter }: { compact?: boolean; filter?: (t: TaskInstance) => boolean }) {
  const db = useDB();
  const now = useStore((s) => s.now);
  const today = istDate(now);
  const [open, setOpen] = useState<TaskInstance | null>(null);
  const tasks = db.tasks.filter((t) => t.date === today && (!filter || filter(t))).sort((a, b) => a.due_at - b.due_at);
  return (
    <>
      <div className="grid grid-cols-5 gap-2">
        {COLS.map((c) => {
          const xs = tasks.filter(c.match);
          const m = STATUS_META[c.id];
          return (
            <div key={c.id} className="min-w-0 rounded-lg bg-slate-50 p-1.5">
              <div className="mb-1.5 flex items-center justify-between px-1 text-xs font-semibold text-slate-600">
                <span className="flex items-center gap-1">
                  <span className={cx("inline-flex h-4 w-4 items-center justify-center rounded-full", m.cell)}>{m.icon}</span>
                  {c.label}
                </span>
                <span className="text-slate-400">{xs.length}</span>
              </div>
              <div className={cx("scroll-thin space-y-1 overflow-y-auto", compact ? "max-h-56" : "max-h-[60vh]")}>
                {xs.map((t) => (
                  <button key={t.id} onClick={() => setOpen(t)} className={cx("block w-full rounded-md border bg-white px-2 py-1 text-left text-xs shadow-sm hover:border-accent-500", t.reserved_for_demo && "border-accent-500/60")}>
                    <div className="truncate font-medium text-slate-700">{taskTitle(db, t.template_id, t.location_id)}</div>
                    <div className="flex justify-between text-[10px] text-slate-500">
                      <span>{staffName(db, t.assignee_id).split(" ")[0]}</span>
                      <span>
                        {t.status === "done_late" ? "late · " : ""}due {time12(t.due_at)}
                      </span>
                    </div>
                    {!compact && <div className="text-[10px] text-slate-400">{templateById(db, t.template_id)?.service_line}</div>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} title="Task">
        {open && <TaskDetail task={db.tasks.find((t) => t.id === open.id)!} />}
      </Modal>
    </>
  );
}
