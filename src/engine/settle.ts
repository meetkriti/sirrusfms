// Outcomes for historical (seeded) task instances.
import type { ChecklistTemplate, TaskInstance } from "../types";
import { MIN } from "../lib/time";
import type { Rng } from "../lib/rng";
import { PHOTO_FOR, plausibleResponses } from "./tasks";

export function markMissedHistorical(t: TaskInstance) {
  t.status = "missed";
  t.reminded = true;
  t.alerted = true;
  t.source = "whatsapp_workflow";
  t.updated_at = t.due_at + 30 * MIN;
}

export function settleTask(t: TaskInstance, tpl: ChecklistTemplate, rng: Rng, pDone: number) {
  t.source = "whatsapp_workflow";
  if (!rng.chance(pDone)) return markMissedHistorical(t);
  const late = rng.chance(0.09);
  t.completed_at = late ? t.due_at + rng.int(5, tpl.grace_min + 60) * MIN : t.due_at - rng.int(5, Math.min(60, tpl.send_offset_min)) * MIN;
  t.status = late ? "done_late" : "done";
  t.reminded = late;
  const { responses, oor } = plausibleResponses(tpl, rng, tpl.service_line === "stp" || tpl.id === "tech_pump" ? 0.015 : 0);
  t.responses = responses;
  if (oor.length) {
    t.out_of_range = oor;
    t.remarks = "Value rechecked; informed supervisor";
  }
  if (tpl.photo_required && rng.chance(0.96)) t.photos = [PHOTO_FOR[tpl.id] ?? "/samples/generic.svg"];
  t.updated_at = t.completed_at;
}
