import { config, ownerFor } from "../config";
import type { DB, Level, Priority, Source, Ticket, TicketCategory, TimelineEvent } from "../types";
import { MIN } from "../lib/time";
import { duration } from "../lib/format";
import { baseFields, locationName, nid, staffName, type World } from "./core";
import { raiseAlert } from "./alerts";
import { SimulatedAdapter } from "./messaging";

export const ACTIVE_TICKET = new Set(["open", "acknowledged", "in_progress", "reopened"]);
export const LEVEL_RANK: Record<Level, number> = { L1: 1, L2: 2, L3: 3, L4: 4 };
const LEVEL_TARGET: Record<Level, string> = { L1: "supervisor", L2: "fm", L3: "zonal", L4: "ops_head" };

export const serviceLineFor = (c: TicketCategory) => config.hierarchy.categoryToServiceLine[c] ?? "technical";

export function nextTicketNumber(db: DB) {
  db.counters["TKT_NO"] = (db.counters["TKT_NO"] ?? 0) + 1;
  return `LG-${String(db.counters["TKT_NO"]).padStart(4, "0")}`;
}

export interface NewTicket {
  raised_by: Ticket["raised_by"];
  raised_by_name: string;
  channel: Ticket["channel"];
  category: TicketCategory;
  priority: Priority;
  location_id: string;
  description: string;
  photos?: string[];
  classification?: Ticket["classification"];
  source: Source;
  linked_message_ids?: string[];
}

export function createTicket(w: World, n: NewTicket, opts: { notify?: boolean } = { notify: true }): Ticket {
  const { db, now } = w;
  const sla = config.sla[n.priority];
  const sl = serviceLineFor(n.category);
  const owner = ownerFor("L1", sl);
  const t: Ticket = {
    ...baseFields(db, "TKT", now, n.source),
    number: nextTicketNumber(db),
    raised_by: n.raised_by,
    raised_by_name: n.raised_by_name,
    channel: n.channel,
    category: n.category,
    location_id: n.location_id,
    description: n.description,
    photos: n.photos ?? [],
    priority: n.priority,
    level: "L1",
    owner_id: owner,
    response_due: now + sla.response_min * MIN,
    resolution_due: now + sla.resolution_min * MIN,
    status: "open",
    timeline: [
      { at: now, type: "raised", by: n.raised_by_name, text: `Raised via ${n.channel.replace("_", " ")}: "${n.description}"` },
      {
        at: now,
        type: "assigned",
        by: "system",
        level: "L1",
        text: `Classified ${n.category} · ${n.priority}${n.classification ? ` (${n.classification.by}, confidence ${n.classification.confidence.toFixed(2)})` : ""}. Assigned to ${staffName(db, owner)} (L1). Response SLA ${sla.response_min} min, resolution SLA ${duration(sla.resolution_min * MIN)}.`,
      },
    ],
    linked_message_ids: n.linked_message_ids ?? [],
    classification: n.classification,
  };
  db.tickets.push(t);
  if (opts.notify) {
    const wa = new SimulatedAdapter(w);
    wa.sendInteractive(
      owner,
      `🎫 New ticket ${t.number} (${t.priority}, ${t.category})\n${locationName(db, t.location_id)}: ${t.description}\nPlease acknowledge within ${sla.response_min} min.`,
      [
        { id: `tkt_ack:${t.id}`, title: "Acknowledge" },
        { id: `tkt_res:${t.id}`, title: "Mark resolved" },
      ],
      { ticket_id: t.id },
    );
    if (t.priority === "P1") {
      wa.sendMessage(config.hierarchy.owners.L2, `🔴 P1 ticket ${t.number}: ${t.category} at ${locationName(db, t.location_id)}. "${t.description}". Owner: ${staffName(db, owner)}.`, { ticket_id: t.id });
    }
  }
  return t;
}

function push(t: Ticket, e: TimelineEvent, now: number) {
  t.timeline.push(e);
  t.updated_at = now;
}

export function acknowledgeTicket(w: World, t: Ticket, by: string) {
  if (t.acknowledged_at) return;
  t.acknowledged_at = w.now;
  t.status = "acknowledged";
  push(t, { at: w.now, type: "acknowledged", by: staffName(w.db, by), text: `Acknowledged by ${staffName(w.db, by)} after ${duration(w.now - t.created_at)}.` }, w.now);
}

export function setInProgress(w: World, t: Ticket, by: string, note?: string) {
  if (!t.acknowledged_at) acknowledgeTicket(w, t, by);
  t.status = "in_progress";
  push(t, { at: w.now, type: "note", by: staffName(w.db, by), text: note || "Work in progress." }, w.now);
}

export function addTicketNote(w: World, t: Ticket, by: string, text: string, photo?: string) {
  if (photo) {
    t.photos.push(photo);
    push(t, { at: w.now, type: "photo_added", by, text: text || "Photo added." }, w.now);
  } else push(t, { at: w.now, type: "note", by, text }, w.now);
}

export function resolveTicket(w: World, t: Ticket, by: string, note: string) {
  if (!t.acknowledged_at) acknowledgeTicket(w, t, by);
  t.status = "resolved";
  t.resolved_at = w.now;
  if (w.now > t.resolution_due) t.resolution_breached = true;
  push(t, { at: w.now, type: "resolved", by: staffName(w.db, by), text: `Resolved: ${note || "Issue fixed."} (${duration(w.now - t.created_at)} after raising)` }, w.now);
  for (const a of w.db.alerts) if (a.entity.type === "ticket" && a.entity.id === t.id && a.status !== "resolved") {
    a.status = "resolved";
    a.notes.push({ at: w.now, by: "system", text: "Ticket resolved." });
  }
  const client = w.db.staff.find((s) => s.role === "client");
  if (t.raised_by !== "internal" && client) {
    const wa = new SimulatedAdapter(w);
    wa.sendInteractive(
      client.id,
      `✅ Ticket ${t.number} (${t.category}, ${locationName(w.db, t.location_id)}) has been resolved: ${note || "Issue fixed."}\nReply YES if resolved, NO to reopen.`,
      [
        { id: `close_yes:${t.id}`, title: "YES" },
        { id: `close_no:${t.id}`, title: "NO" },
      ],
      { ticket_id: t.id },
    );
    w.db.convState[client.id] = { kind: "awaiting_closure", ticket_id: t.id };
  } else {
    t.status = "closed";
    t.closed_at = w.now;
    push(t, { at: w.now, type: "closed", by: "system", text: "Closed (internal ticket)." }, w.now);
  }
}

export function clientConfirm(w: World, t: Ticket, yes: boolean) {
  const by = w.db.staff.find((s) => s.role === "client")?.name ?? "Client";
  if (yes) {
    push(t, { at: w.now, type: "client_confirmed", by, text: "Client confirmed the issue is resolved." }, w.now);
    t.status = "closed";
    t.closed_at = w.now;
    push(t, { at: w.now, type: "closed", by: "system", text: "Ticket closed." }, w.now);
  } else {
    t.status = "reopened";
    t.resolved_at = undefined;
    push(t, { at: w.now, type: "reopened", by, text: "Client replied NO: issue not resolved. Ticket reopened at current level." }, w.now);
    raiseAlert(
      w,
      {
        rule_id: "SLA",
        severity: "warning",
        title: `Reopened by client: ${t.number}`,
        reason: `${by} replied NO to the closure check for ${t.number} (${t.category}). Ticket is back with ${staffName(w.db, t.owner_id)} (${t.level}).`,
        targets: ["fm", LEVEL_TARGET[t.level]],
        entity: { type: "ticket", id: t.id },
      },
      { serviceLine: serviceLineFor(t.category), whatsapp: true },
    );
  }
}

/** Called every simulated minute: SLA breaches and level-by-level escalation. */
export function ticketTick(w: World) {
  const { db, now } = w;
  for (const t of db.tickets) {
    if (!ACTIVE_TICKET.has(t.status)) continue;
    if (!t.acknowledged_at && !t.response_breached && now > t.response_due) {
      t.response_breached = true;
      push(t, { at: now, type: "sla_breach", by: "system", text: `Response SLA breached: not acknowledged within ${config.sla[t.priority].response_min} min.` }, now);
    }
    if (!t.resolution_breached && now > t.resolution_due) {
      t.resolution_breached = true;
      push(t, { at: now, type: "sla_breach", by: "system", text: `Resolution SLA breached (${duration(config.sla[t.priority].resolution_min * MIN)}).` }, now);
    }
    for (const step of config.sla[t.priority].escalation) {
      if (LEVEL_RANK[step.level] <= LEVEL_RANK[t.level]) continue;
      if (now < t.created_at + step.after_min * MIN) continue;
      escalate(w, t, step.level, `Not resolved ${duration(step.after_min * MIN)} after raising (${t.priority} path: ${config.sla[t.priority].escalation.map((s) => `${s.level} at ${duration(s.after_min * MIN)}`).join(" → ")}).`);
    }
  }
}

export function escalate(w: World, t: Ticket, level: Level, why: string) {
  const { db, now } = w;
  const prev = t.level;
  t.level = level;
  t.owner_id = ownerFor(level, serviceLineFor(t.category));
  push(t, { at: now, type: "escalated", by: "system", level, text: `Escalated ${prev} → ${level}: ${staffName(db, t.owner_id)}. ${why}` }, now);
  raiseAlert(
    w,
    {
      rule_id: `ESC-${t.priority}`,
      severity: t.priority === "P1" || level !== "L2" ? "high" : "warning",
      title: `Escalated to ${level}: ${t.number} ${t.category}, ${locationName(db, t.location_id)}`,
      reason: `Escalation rule (${t.priority}) fired: ${why} Previous owner: ${prev}. New owner: ${staffName(db, t.owner_id)}.`,
      targets: [LEVEL_TARGET[level], ...(level === "L2" ? [] : ["fm"])],
      entity: { type: "ticket", id: t.id },
    },
    { serviceLine: serviceLineFor(t.category), whatsapp: level === "L2" },
  );
}

/** Build a closed historical ticket with a realistic, SLA-consistent timeline (used by the seed). */
export function buildHistoricalTicket(
  db: DB,
  s: NewTicket & { created_at: number; as_of: number; ack_after_min: number; resolve_after_min: number | null; progress_note?: string; resolution_note?: string; client_confirms?: boolean },
): Ticket {
  const sla = config.sla[s.priority];
  const sl = serviceLineFor(s.category);
  const c = s.created_at;
  const L1 = ownerFor("L1", sl);
  const t: Ticket = {
    id: nid(db, "TKT"),
    project_id: "lakeshore-greens",
    created_at: c,
    updated_at: c,
    source: s.source,
    number: "",
    raised_by: s.raised_by,
    raised_by_name: s.raised_by_name,
    channel: s.channel,
    category: s.category,
    location_id: s.location_id,
    description: s.description,
    photos: s.photos ?? [],
    priority: s.priority,
    level: "L1",
    owner_id: L1,
    response_due: c + sla.response_min * MIN,
    resolution_due: c + sla.resolution_min * MIN,
    status: "open",
    timeline: [
      { at: c, type: "raised", by: s.raised_by_name, text: `Raised via ${s.channel.replace("_", " ")}: "${s.description}"` },
      { at: c, type: "assigned", by: "system", level: "L1", text: `Classified ${s.category} · ${s.priority}. Assigned to ${staffName(db, L1)} (L1).` },
    ],
    linked_message_ids: s.linked_message_ids ?? [],
    classification: s.classification ?? { by: "mock", confidence: 0.9 },
  };
  const events: TimelineEvent[] = [];
  const ack = c + s.ack_after_min * MIN;
  const resolvedAt = s.resolve_after_min != null ? c + s.resolve_after_min * MIN : Infinity;
  // Events are only generated up to the resolution time or the seed's "now", whichever is earlier.
  const end = Math.min(resolvedAt, s.as_of);
  if (ack < end) {
    events.push({ at: ack, type: "acknowledged", by: staffName(db, L1), text: `Acknowledged by ${staffName(db, L1)} after ${duration(ack - c)}.` });
    t.acknowledged_at = ack;
    if (s.ack_after_min > sla.response_min) {
      t.response_breached = true;
      events.push({ at: c + sla.response_min * MIN + 1, type: "sla_breach", by: "system", text: `Response SLA breached: not acknowledged within ${sla.response_min} min.` });
    }
  }
  for (const step of sla.escalation) {
    const at = c + step.after_min * MIN;
    if (at < end) {
      const owner = ownerFor(step.level, sl);
      events.push({ at, type: "escalated", by: "system", level: step.level, text: `Escalated ${t.level} → ${step.level}: ${staffName(db, owner)}. Not resolved ${duration(step.after_min * MIN)} after raising.` });
      t.level = step.level;
      t.owner_id = owner;
    }
  }
  if (c + sla.resolution_min * MIN < end) {
    t.resolution_breached = true;
    events.push({ at: c + sla.resolution_min * MIN + 1, type: "sla_breach", by: "system", text: `Resolution SLA breached (${duration(sla.resolution_min * MIN)}).` });
  }
  if (s.progress_note && ack < end) events.push({ at: Math.min(ack + 20 * MIN, end - MIN), type: "note", by: staffName(db, L1), text: s.progress_note });
  if (resolvedAt <= s.as_of) {
    const end = resolvedAt;
    events.push({ at: end, type: "resolved", by: staffName(db, t.owner_id), text: `Resolved: ${s.resolution_note ?? "Issue fixed."} (${duration(end - c)} after raising)` });
    t.resolved_at = end;
    t.status = "resolved";
    if (s.raised_by !== "internal" && s.client_confirms !== false) {
      events.push({ at: end + 40 * MIN, type: "client_confirmed", by: s.raised_by_name, text: "Client confirmed the issue is resolved." });
      events.push({ at: end + 40 * MIN, type: "closed", by: "system", text: "Ticket closed." });
      t.status = "closed";
      t.closed_at = end + 40 * MIN;
    } else if (s.raised_by === "internal") {
      events.push({ at: end, type: "closed", by: "system", text: "Closed (internal ticket)." });
      t.status = "closed";
      t.closed_at = end;
    }
  } else if (t.acknowledged_at) t.status = s.progress_note ? "in_progress" : "acknowledged";
  events.sort((a, b) => a.at - b.at);
  t.timeline.push(...events);
  t.updated_at = t.timeline[t.timeline.length - 1].at;
  return t;
}

export function isBreached(t: Ticket) {
  return !!(t.response_breached || t.resolution_breached);
}
