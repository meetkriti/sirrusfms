import { useSearchParams } from "react-router-dom";
import { useDB, useStore } from "../store";
import { addDays, istDate } from "../lib/time";
import { dmy, time12 } from "../lib/format";
import { filterTasks, stats } from "../engine/metrics";
import { staffName, taskTitle } from "../engine/core";
import { Card, Empty, Modal, PageHeader, Select, StatusPill, Td, Th, Tabs } from "../components/ui";
import TaskDetail, { SourceBadge } from "../components/TaskDetail";
import TodayBoard from "../components/TodayBoard";

export default function Tasks() {
  const db = useDB();
  const now = useStore((s) => s.now);
  const today = istDate(now);
  const [sp, setSp] = useSearchParams();
  const view = sp.get("view") ?? (sp.get("from") || sp.get("template") || sp.get("status") ? "list" : "board");
  const from = sp.get("from") ?? addDays(today, -6);
  const to = sp.get("to") ?? today;
  const status = sp.get("status") ?? "all";
  const template = sp.get("template") ?? "all";
  const source = sp.get("source") ?? "all";
  const id = sp.get("id");
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    n.set(k, v);
    if (k !== "id") n.set("view", "list");
    setSp(n, { replace: true });
  };
  let tasks = filterTasks(db, { from, to, serviceLine: (sp.get("sl") as never) ?? "all", tower: sp.get("tower") ?? "all", templateId: template === "all" ? undefined : template });
  if (status !== "all") tasks = tasks.filter((t) => t.status === status);
  if (source !== "all") tasks = tasks.filter((t) => t.source === source);
  tasks = tasks.sort((a, b) => b.due_at - a.due_at);
  const s = stats(db, tasks, now);
  const task = id ? db.tasks.find((t) => t.id === id) : null;

  return (
    <div>
      <PageHeader
        title="Tasks"
        sub="Checklist instances generated from templates for each due slot. Ground staff only ever see WhatsApp."
        actions={<Tabs value={view as "board"} onChange={(v) => set("view", v)} tabs={[{ id: "board", label: "Today's board" }, { id: "list", label: "All tasks" }]} />}
      />
      {view === "board" ? (
        <Card title={`Today · ${dmy(today)}`}>
          <TodayBoard />
        </Card>
      ) : (
        <Card
          title={`${tasks.length} tasks · ${s.done} done, ${s.late} late, ${s.missed} missed, ${s.pending} pending`}
          action={
            <div className="flex flex-wrap gap-2">
              <Select label="From" value={from} onChange={(v) => set("from", v)} options={[7, 14, 30, 90].map((n) => ({ value: addDays(today, -(n - 1)), label: `${n} days ago` })).concat(sp.get("from") ? [{ value: from, label: dmy(from) }] : [])} />
              <Select label="Status" value={status} onChange={(v) => set("status", v)} options={["all", "done", "done_late", "missed", "sent", "in_progress", "scheduled"].map((x) => ({ value: x, label: x.replace("_", " ") }))} />
              <Select label="Checklist" value={template} onChange={(v) => set("template", v)} options={[{ value: "all", label: "All" }, ...db.templates.map((t) => ({ value: t.id, label: t.name }))]} />
              <Select label="Source" value={source} onChange={(v) => set("source", v)} options={[{ value: "all", label: "All" }, { value: "whatsapp_workflow", label: "WhatsApp workflow" }, { value: "whatsapp_group_extracted", label: "Group chat (extracted)" }, { value: "email_extracted", label: "Email (extracted)" }]} />
            </div>
          }
        >
          {tasks.length === 0 ? (
            <Empty title="No tasks match these filters" />
          ) : (
            <div className="scroll-thin max-h-[70vh] overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0">
                  <tr>
                    <Th>Date</Th>
                    <Th>Due</Th>
                    <Th>Task</Th>
                    <Th>Assignee</Th>
                    <Th>Status</Th>
                    <Th>Completed</Th>
                    <Th>Source</Th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.slice(0, 400).map((t) => (
                    <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => set("id", t.id)}>
                      <Td>{dmy(t.date)}</Td>
                      <Td>{time12(t.due_at)}</Td>
                      <Td>{taskTitle(db, t.template_id, t.location_id)}</Td>
                      <Td>{staffName(db, t.assignee_id)}</Td>
                      <Td>
                        <StatusPill status={t.status} />
                      </Td>
                      <Td>{t.completed_at ? time12(t.completed_at) : "—"}</Td>
                      <Td>
                        <SourceBadge source={t.source} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {tasks.length > 400 && <div className="p-2 text-center text-xs text-slate-500">Showing 400 of {tasks.length}. Narrow the filters to see more.</div>}
            </div>
          )}
        </Card>
      )}
      <Modal
        open={!!task}
        onClose={() => {
          const n = new URLSearchParams(sp);
          n.delete("id");
          setSp(n, { replace: true });
        }}
        title="Task detail"
      >
        {task && <TaskDetail task={task} />}
      </Modal>
    </div>
  );
}
