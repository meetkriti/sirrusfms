// AI layer. Every feature works in Mock mode (deterministic, offline). In Live mode,
// calls go to the local /api/ai proxy (Claude), outputs are validated with Zod against
// a strict JSON schema, retried once on failure, then routed to human review.
// Every call (mock or live) is written to the AI audit log.
import { z } from "zod";
import type { AIAuditEntry, DB, TicketCategory, Priority } from "../types";
import { hashHex } from "../lib/rng";
import extractionPrompt from "../../prompts/extraction.md?raw";
import classificationPrompt from "../../prompts/classification.md?raw";
import chatPrompt from "../../prompts/chat.md?raw";
import meterPrompt from "../../prompts/meter_reading.md?raw";
import insightPrompt from "../../prompts/insight_wording.md?raw";
import intentPrompt from "../../prompts/intent.md?raw";
import { classifyComplaint, parseReply, type Classification, type ParsedReply } from "../engine/nlp";
import type { Candidate, Thread } from "../engine/extract";
import { mockExtract } from "../engine/extract";
import { mockAsk, runTool, TOOL_DEFS, type MockAnswer } from "../engine/ask";
import { allowedNumbers, type Evidence, type Insight } from "../engine/patterns";
import type { MeterExtraction } from "../engine/meters";
import { istDate } from "../lib/time";

export type AIMode = "mock" | "live";
type Feature = AIAuditEntry["feature"];

let auditSink: (e: AIAuditEntry) => void = () => {};
let seq = 0;
export function setAuditSink(fn: (e: AIAuditEntry) => void) {
  auditSink = fn;
}

function audit(feature: Feature, mode: AIMode, input: string, output: unknown, t0: number, extra: Partial<AIAuditEntry> = {}) {
  auditSink({
    id: `AI-${String(++seq).padStart(5, "0")}`, at: Date.now(), feature, mode, input_hash: hashHex(input), input_preview: input.slice(0, 240),
    output: typeof output === "string" ? output.slice(0, 2000) : JSON.stringify(output).slice(0, 2000), confidence: null, latency_ms: Date.now() - t0, ok: true, ...extra,
  });
}

export async function aiStatus(): Promise<{ configured: boolean; model: string }> {
  try {
    const r = await fetch("/api/ai/status");
    if (!r.ok) return { configured: false, model: "" };
    return await r.json();
  } catch {
    return { configured: false, model: "" };
  }
}

async function structured<T>(feature: Feature, system: string, user: string, schema: object, validator: z.ZodType<T>, images?: string[]): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const input = `${user}${images ? ` [images: ${images.join(", ")}]` : ""}`;
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    try {
      const r = await fetch("/api/ai/structured", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ system, user, schema, images }) });
      const body = await r.json();
      if (!r.ok || !body.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      const parsed = validator.safeParse(JSON.parse(body.text));
      if (!parsed.success) throw new Error(`Schema validation failed: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      const conf = (parsed.data as { confidence?: number }).confidence;
      audit(feature, "live", input, body.text, t0, { latency_ms: body.latency_ms ?? Date.now() - t0, confidence: typeof conf === "number" ? conf : null, retried: attempt > 0 });
      return { ok: true, data: parsed.data };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      audit(feature, "live", input, "", t0, { ok: false, error: lastErr, retried: attempt > 0 });
    }
  }
  return { ok: false, error: lastErr };
}

// ---------- Classification ----------
const CATEGORIES = ["Housekeeping", "Security", "Plumbing", "Electrical", "Lift", "STP/Odour", "Water Supply", "Landscaping", "Pest Control", "Other"] as const;
const LOCS = ["A-STAIR", "B-STAIR", "C-STAIR", "D-STAIR", "A-LOBBY", "B-LOBBY", "C-LOBBY", "D-LOBBY", "TWR-A", "TWR-B", "TWR-C", "TWR-D", "BASE-1", "BASE-2", "CLUBHOUSE", "CLUB-WR", "STP-ROOM", "PUMP-ROOM", "DG-YARD", "GARDEN", "MAIN-GATE", "SERVICE-GATE", "GARBAGE-PT"] as const;
const ClassSchema = z.object({ category: z.enum(CATEGORIES), priority: z.enum(["P1", "P2", "P3"]), location_id: z.enum(LOCS).nullable(), confidence: z.number().min(0).max(1), summary: z.string() });
const classJson = {
  type: "object", additionalProperties: false, required: ["category", "priority", "location_id", "confidence", "summary"],
  properties: { category: { type: "string", enum: CATEGORIES }, priority: { type: "string", enum: ["P1", "P2", "P3"] }, location_id: { anyOf: [{ type: "string", enum: LOCS }, { type: "null" }] }, confidence: { type: "number" }, summary: { type: "string" } },
};

export async function classify(mode: AIMode, text: string): Promise<Classification & { by: "mock" | "live" }> {
  const t0 = Date.now();
  if (mode === "live") {
    const r = await structured("classification", classificationPrompt, `Complaint: """${text}"""`, classJson, ClassSchema);
    if (r.ok) return { ...r.data, category: r.data.category as TicketCategory, priority: r.data.priority as Priority, by: "live" };
  }
  const m = classifyComplaint(text);
  audit("classification", "mock", text, m, t0, { confidence: m.confidence });
  return { ...m, by: "mock" };
}

// ---------- Reply intent ----------
const IntentSchema = z.object({ intent: z.enum(["done", "partial", "not_done", "unknown"]), towers: z.array(z.enum(["A", "B", "C", "D"])), confidence: z.number() });
const intentJson = { type: "object", additionalProperties: false, required: ["intent", "towers", "confidence"], properties: { intent: { type: "string", enum: ["done", "partial", "not_done", "unknown"] }, towers: { type: "array", items: { type: "string", enum: ["A", "B", "C", "D"] } }, confidence: { type: "number" } } };

export async function intentFallback(text: string, taskTitle: string): Promise<ParsedReply | null> {
  const r = await structured("intent", intentPrompt, `Prompt was about: ${taskTitle}\nReply: """${text}"""`, intentJson, IntentSchema);
  if (!r.ok || r.data.intent === "unknown" || r.data.confidence < 0.6) return null;
  return { intent: r.data.intent, towers: r.data.towers, confidence: r.data.confidence };
}
export function mockIntentAudit(text: string) {
  const t0 = Date.now();
  const p = parseReply(text);
  audit("intent", "mock", text, p, t0, { confidence: p.confidence });
}

// ---------- Extraction ----------
const nullable = (t: object) => ({ anyOf: [t, { type: "null" }] });
const EventJson = {
  type: "object", additionalProperties: false, required: ["thread_index", "type", "summary", "confidence", "fields"],
  properties: {
    thread_index: { type: "integer" },
    type: { type: "string", enum: ["task_completed", "issue_reported", "meter_reading", "attendance_update", "consumable_delivery", "inspection_note", "other"] },
    summary: { type: "string" }, confidence: { type: "number" },
    fields: {
      type: "object", additionalProperties: false,
      required: ["template_id", "towers", "category", "location_hint", "description", "readings", "shift", "on_duty", "absent", "replacement", "item", "quantity", "acknowledged", "overall_score", "scores", "ticket_update", "note"],
      properties: {
        template_id: nullable({ type: "string" }), towers: { type: "array", items: { type: "string", enum: ["A", "B", "C", "D"] } }, category: nullable({ type: "string", enum: CATEGORIES }),
        location_hint: nullable({ type: "string" }), description: nullable({ type: "string" }),
        readings: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "value"], properties: { name: { type: "string" }, value: { type: "number" } } } },
        shift: nullable({ type: "string", enum: ["morning", "afternoon", "night"] }), on_duty: nullable({ type: "integer" }), absent: nullable({ type: "integer" }), replacement: nullable({ type: "boolean" }),
        item: nullable({ type: "string" }), quantity: nullable({ type: "number" }), acknowledged: nullable({ type: "boolean" }), overall_score: nullable({ type: "number" }),
        scores: { type: "array", items: { type: "object", additionalProperties: false, required: ["area", "score", "max", "note"], properties: { area: { type: "string" }, score: { type: "number" }, max: { type: "number" }, note: { type: "string" } } } },
        ticket_update: nullable({ type: "string", enum: ["acknowledged", "resolved"] }), note: nullable({ type: "string" }),
      },
    },
  },
};
const extractionJson = { type: "object", additionalProperties: false, required: ["events"], properties: { events: { type: "array", items: EventJson } } };
const EventZ = z.object({
  thread_index: z.number().int(), type: z.enum(["task_completed", "issue_reported", "meter_reading", "attendance_update", "consumable_delivery", "inspection_note", "other"]), summary: z.string(), confidence: z.number().min(0).max(1),
  fields: z.object({
    template_id: z.string().nullable(), towers: z.array(z.string()), category: z.enum(CATEGORIES).nullable(), location_hint: z.string().nullable(), description: z.string().nullable(),
    readings: z.array(z.object({ name: z.string(), value: z.number() })), shift: z.enum(["morning", "afternoon", "night"]).nullable(), on_duty: z.number().nullable(), absent: z.number().nullable(), replacement: z.boolean().nullable(),
    item: z.string().nullable(), quantity: z.number().nullable(), acknowledged: z.boolean().nullable(), overall_score: z.number().nullable(), scores: z.array(z.object({ area: z.string(), score: z.number(), max: z.number(), note: z.string() })),
    ticket_update: z.enum(["acknowledged", "resolved"]).nullable(), note: z.string().nullable(),
  }),
});
const ExtractionZ = z.object({ events: z.array(EventZ) });

function toCandidate(e: z.infer<typeof EventZ>): Candidate {
  const f = e.fields;
  return {
    type: e.type, summary: e.summary, confidence: e.confidence,
    fields: {
      template_id: f.template_id ?? undefined, towers: f.towers.length ? f.towers : undefined, category: f.category ?? undefined, description: f.description ?? undefined,
      location_id: f.location_hint ? classifyComplaint(f.location_hint).location_id ?? undefined : undefined,
      readings: f.readings.length ? Object.fromEntries(f.readings.map((r) => [r.name.toLowerCase().replace(/\s+/g, "_"), r.value])) : undefined,
      shift: f.shift ?? undefined, on_duty: f.on_duty ?? undefined, absent: f.absent ?? undefined, replacement: f.replacement ?? undefined, item: f.item ?? undefined, quantity: f.quantity ?? undefined,
      acknowledged: f.acknowledged ?? undefined, overall_score: f.overall_score ?? undefined, scores: f.scores.length ? f.scores : undefined, ticket_update: f.ticket_update ?? undefined, note: f.note ?? undefined,
    },
  };
}

/** Extract candidates for a batch of threads. Returns per-thread candidates; failed batches go to review. */
export async function extractThreads(mode: AIMode, threads: Thread[], onProgress?: (done: number) => void): Promise<{ thread: Thread; candidates: Candidate[]; failed?: string }[]> {
  const out: { thread: Thread; candidates: Candidate[]; failed?: string }[] = [];
  if (mode === "mock") {
    const t0 = Date.now();
    for (const th of threads) out.push({ thread: th, candidates: mockExtract(th) });
    audit("extraction", "mock", `${threads.length} threads (rules engine)`, `${out.reduce((s, x) => s + x.candidates.length, 0)} candidate events`, t0);
    return out;
  }
  const BATCH = 25;
  for (let i = 0; i < threads.length; i += BATCH) {
    const batch = threads.slice(i, i + BATCH);
    const user = batch.map((th, k) => `#${k} [${th.channel}] ${new Date(th.at + 330 * 60000).toISOString().slice(0, 16).replace("T", " ")} ${th.sender}${th.subject ? ` | Subject: ${th.subject}` : ""}${th.photos ? ` (+${th.photos} photo)` : ""}:\n${th.text || "(no text)"}`).join("\n\n");
    const r = await structured("extraction", extractionPrompt, user, extractionJson, ExtractionZ);
    for (let k = 0; k < batch.length; k++) {
      if (!r.ok) out.push({ thread: batch[k], candidates: [{ type: "other", summary: "Extraction failed; needs manual review", confidence: 0, fields: { note: r.error } }], failed: r.error });
      else out.push({ thread: batch[k], candidates: r.data.events.filter((e) => e.thread_index === k).map(toCandidate) });
    }
    onProgress?.(Math.min(threads.length, i + BATCH));
  }
  return out;
}

// ---------- Meter photo reading ----------
const MeterZ = z.object({ serial: z.string().nullable(), unit_label: z.string().nullable(), reading: z.number().nullable(), confidence: z.number().min(0).max(1) });
const meterJson = { type: "object", additionalProperties: false, required: ["serial", "unit_label", "reading", "confidence"], properties: { serial: nullable({ type: "string" }), unit_label: nullable({ type: "string" }), reading: nullable({ type: "number" }), confidence: { type: "number" } } };

export interface MeterLabel {
  file: string;
  serial: string;
  unit_label: string;
  reading: number;
  confidence: number;
  note: string;
}

export async function readMeterPhoto(mode: AIMode, photo: string, labels: MeterLabel[]): Promise<MeterExtraction & { engine: "mock" | "live" }> {
  const t0 = Date.now();
  const canSend = /\.(png|jpe?g|webp)$/i.test(photo) || photo.startsWith("data:image/");
  if (mode === "live" && canSend) {
    const r = await structured("meter_reading", meterPrompt, "Read this meter photo.", meterJson, MeterZ, [photo]);
    if (r.ok) return { ...r.data, engine: "live" };
  }
  const file = photo.split("/").pop() ?? "";
  const l = labels.find((x) => x.file === file);
  const out: MeterExtraction = l ? { serial: l.serial.includes("?") ? null : l.serial, unit_label: l.unit_label.includes("?") ? null : l.unit_label, reading: l.reading, confidence: l.confidence } : { serial: null, unit_label: null, reading: null, confidence: 0 };
  audit("meter_reading", "mock", photo, l ? out : "No pre-labelled mock result for this image (use Live mode for new photos).", t0, { confidence: out.confidence });
  return { ...out, engine: "mock" };
}

// ---------- Insight wording ----------
const InsightZ = z.object({ text: z.string(), suggestion: z.string() });
const insightJson = { type: "object", additionalProperties: false, required: ["text", "suggestion"], properties: { text: { type: "string" }, suggestion: { type: "string" } } };

export async function wordInsight(mode: AIMode, i: Insight): Promise<{ text: string; suggestion: string; by: "mock" | "live"; rejected?: string }> {
  const t0 = Date.now();
  if (mode === "live") {
    const r = await structured("insight", insightPrompt, JSON.stringify({ finding: i.text, numbers: i.numbers, suggested_action: i.suggestion }), insightJson, InsightZ);
    if (r.ok) {
      const allowed = allowedNumbers(i);
      const used = `${r.data.text} ${r.data.suggestion}`.match(/\d[\d,]*(\.\d+)?/g) ?? [];
      const bad = used.map((n) => n.replace(/,/g, "")).filter((n) => !allowed.has(n));
      if (!bad.length) return { ...r.data, by: "live" };
      return { text: i.text, suggestion: i.suggestion, by: "mock", rejected: `LLM wording rejected: introduced numbers not in the computation (${bad.join(", ")}).` };
    }
  }
  audit("insight", "mock", i.id, i.text, t0);
  return { text: i.text, suggestion: i.suggestion, by: "mock" };
}

// ---------- Ask Paradigm ----------
export interface AskAnswer {
  text: string;
  calls: { name: string; input: Record<string, unknown>; result: unknown }[];
  evidence: Evidence[];
  mode: AIMode;
  error?: string;
}

export async function ask(mode: AIMode, db: DB, now: number, question: string, history: { role: "user" | "assistant"; content: string }[] = []): Promise<AskAnswer> {
  const t0 = Date.now();
  if (mode === "mock") {
    const a: MockAnswer = mockAsk(db, now, question);
    audit("chat", "mock", question, a.text, t0);
    return { ...a, mode };
  }
  const system = chatPrompt.replace("{{today}}", istDate(now));
  const messages: unknown[] = [...history.slice(-6).map((h) => ({ role: h.role, content: h.content })), { role: "user", content: question }];
  const calls: AskAnswer["calls"] = [];
  const evidence: Evidence[] = [];
  try {
    for (let turn = 0; turn < 6; turn++) {
      const t1 = Date.now();
      const r = await fetch("/api/ai/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ system, messages, tools: TOOL_DEFS }) });
      const body = await r.json();
      if (!r.ok || !body.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      audit("chat", "live", turn === 0 ? question : `tool loop turn ${turn}`, body.content, t1, { latency_ms: body.latency_ms });
      const content = body.content as { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string }[];
      messages.push({ role: "assistant", content });
      const uses = content.filter((b) => b.type === "tool_use");
      if (body.stop_reason !== "tool_use" || !uses.length) {
        const text = content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
        return { text: text || "(no answer)", calls, evidence, mode };
      }
      const results = uses.map((u) => {
        const res = runTool(db, now, u.name!, (u.input ?? {}) as Record<string, unknown>);
        calls.push({ name: u.name!, input: u.input ?? {}, result: res.result });
        evidence.push(...res.evidence);
        return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(res.result).slice(0, 30000) };
      });
      messages.push({ role: "user", content: results });
    }
    return { text: "Stopped after 6 tool calls without a final answer.", calls, evidence, mode };
  } catch (e) {
    const fallback = mockAsk(db, now, question);
    return { ...fallback, mode: "mock", error: `Live mode failed (${e instanceof Error ? e.message : e}); answered in Mock mode.` };
  }
}
