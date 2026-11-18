// Core data model for the Paradigm Services prototype.
// Every persisted record carries id, project_id, created_at, updated_at and source.

export type Source =
  | "whatsapp_workflow"
  | "whatsapp_group_extracted"
  | "email_extracted"
  | "dashboard"
  | "seed";

export interface Base {
  id: string;
  project_id: string;
  created_at: number; // epoch ms
  updated_at: number;
  source: Source;
}

export type ServiceLineId =
  | "housekeeping"
  | "security"
  | "technical"
  | "water"
  | "stp"
  | "landscaping"
  | "electromechanical"
  | "consumables";

export interface Project extends Base {
  name: string;
  city: string;
  zone: string;
  client_name: string;
  agreement_start: string; // YYYY-MM-DD
  towers: string[];
  floors_per_tower: number;
  units_per_floor: number;
  units_count: number;
  stp_capacity_kld: number;
  contracted_headcount: Partial<Record<ServiceLineId, number>>;
}

export interface Location extends Base {
  name: string;
  kind: "project" | "tower" | "area";
  parent_id: string | null;
  tower?: string;
}

export interface ServiceLine {
  id: ServiceLineId;
  name: string;
}

export type RoleId = "ground" | "supervisor" | "fm" | "zonal" | "ops_head" | "finance" | "client";

export interface Staff extends Base {
  name: string;
  role: RoleId | "inspector";
  title: string;
  level: "L0" | "L1" | "L2" | "L3" | "L4" | "-";
  service_line: ServiceLineId | null;
  phone: string;
  reports_to: string | null;
  shift: string | null;
  tower?: string;
}

export interface Shift {
  id: string;
  service_line: ServiceLineId;
  name: "morning" | "afternoon" | "night" | "general";
  start: string; // HH:mm
  end: string;
}

export type AttendanceStatus = "present" | "absent" | "half_day" | "replacement";

export interface AttendanceRecord extends Base {
  staff_id: string;
  date: string;
  shift_id: string;
  service_line: ServiceLineId;
  post?: number;
  status: AttendanceStatus;
  replacement_for?: string;
  approved?: boolean;
  verified: boolean;
}

export interface SOP {
  id: string;
  title: string;
  service_line: ServiceLineId;
  text: string;
  template_id: string;
}

export type Frequency = "hourly" | "per_shift" | "daily" | "twice_daily" | "weekly" | "monthly" | "quarterly";

export interface ChecklistItem {
  id: string;
  label: string;
  type: "yes_no" | "numeric_reading" | "text" | "photo";
  min?: number;
  max?: number;
  unit?: string;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  service_line: ServiceLineId;
  locations: string[];
  frequency: Frequency;
  due_times: string[];
  weekday?: number;
  day_of_month?: number;
  anchor_date?: string;
  every_days?: number;
  shift?: string;
  send_offset_min: number;
  grace_min: number;
  photo_required: boolean;
  mode: "quick" | "stepwise";
  assignee?: string;
  assignee_by_time?: Record<string, string>;
  sop: string;
  items: ChecklistItem[];
}

export type TaskStatus = "scheduled" | "sent" | "in_progress" | "done" | "done_late" | "missed" | "not_applicable";

export interface TaskInstance extends Base {
  template_id: string;
  location_id: string;
  date: string; // YYYY-MM-DD (IST)
  slot: string; // HH:mm due time
  assignee_id: string;
  send_at: number;
  due_at: number;
  status: TaskStatus;
  completed_at?: number;
  responses: Record<string, string | number | boolean>;
  photos: string[];
  remarks?: string;
  out_of_range?: string[];
  reminded?: boolean;
  alerted?: boolean;
  reported_not_done?: boolean;
  // Simulated background reply from staff (autopilot) for live days.
  autopilot?: { reply_at: number; outcome: "done" | "late" | "missed"; partial?: boolean } | null;
  reserved_for_demo?: boolean;
  extracted_from?: string[]; // RawMessage ids when inferred from group chat
}

export interface Inspection extends Base {
  inspector: string;
  date: string;
  location_id: string;
  overall_score: number;
  scores: { area: string; score: number; max: number; note: string }[];
  observations: string[];
  photos: string[];
  source_email_id?: string;
}

export type TicketCategory =
  | "Housekeeping"
  | "Security"
  | "Plumbing"
  | "Electrical"
  | "Lift"
  | "STP/Odour"
  | "Water Supply"
  | "Landscaping"
  | "Pest Control"
  | "Other";

export type Priority = "P1" | "P2" | "P3";
export type Level = "L1" | "L2" | "L3" | "L4";
export type TicketStatus = "open" | "acknowledged" | "in_progress" | "resolved" | "closed" | "reopened";

export interface TimelineEvent {
  at: number;
  type:
    | "raised"
    | "acknowledged"
    | "assigned"
    | "escalated"
    | "photo_added"
    | "note"
    | "resolved"
    | "client_confirmed"
    | "reopened"
    | "closed"
    | "sla_breach"
    | "message_linked";
  by: string;
  text: string;
  level?: Level;
  message_id?: string;
}

export interface Ticket extends Base {
  number: string;
  raised_by: "client" | "resident_committee" | "internal";
  raised_by_name: string;
  channel: "whatsapp" | "dashboard" | "email" | "whatsapp_group";
  category: TicketCategory;
  location_id: string;
  description: string;
  photos: string[];
  priority: Priority;
  level: Level;
  owner_id: string;
  response_due: number;
  resolution_due: number;
  acknowledged_at?: number;
  resolved_at?: number;
  closed_at?: number;
  status: TicketStatus;
  timeline: TimelineEvent[];
  linked_message_ids: string[];
  classification?: { by: "mock" | "live" | "human"; confidence: number };
  response_breached?: boolean;
  resolution_breached?: boolean;
}

export interface EscalationStep {
  level: Level;
  after_min: number;
}
export interface SlaRule {
  examples: string;
  response_min: number;
  resolution_min: number;
  escalation: EscalationStep[];
}
export type SlaMatrix = Record<Priority, SlaRule>;

export type MeterType = "water" | "electricity_common" | "dg" | "bulk_water_inlet" | "stp_flow";

export interface Meter extends Base {
  meter_id: string; // serial on the meter
  type: MeterType;
  unit: string; // unit no (e.g. B-1204) or area label
  location_id: string;
  multiplier: number;
  uom: string;
  last_reading: number;
  avg_consumption_3m?: number;
}

export interface MeterReading extends Base {
  meter_id: string;
  cycle: string; // YYYY-MM
  value: number;
  previous: number | null;
  consumption: number | null;
  reading_date: string;
  photo: string;
  captured_by: string;
  confidence: number;
  status: "ok" | "needs_review" | "rejected";
  flags: string[];
  meter_replaced?: boolean;
}

export interface ConsumableDelivery extends Base {
  item: string;
  quantity: number;
  unit: string;
  rate: number;
  delivery_date: string;
  vendor: string;
  acknowledgement: { type: "photo" | "signature"; by: string; ref: string } | null;
  billed: boolean;
  source_ref?: string;
}

export interface QuotationLine {
  description: string;
  quantity: number;
  unit: string;
  rate: number;
}
export interface Quotation extends Base {
  number: string;
  client: string;
  description: string;
  lines: QuotationLine[];
  amount: number;
  approval_status: "draft" | "submitted" | "approved" | "rejected";
  approved_on?: string;
  month: string;
}

export interface ProjectWorkExecution extends Base {
  quotation_id: string;
  line_index: number;
  date: string;
  quantity_delivered: number;
  proof_photo: string | null;
}

export interface RawMessage {
  id: string;
  project_id: string;
  channel: "whatsapp_group" | "whatsapp_direct" | "email";
  sender: string;
  timestamp: number;
  text: string;
  attachments: string[];
  subject?: string;
  thread_id?: string;
}

export type ExtractedType =
  | "task_completed"
  | "issue_reported"
  | "meter_reading"
  | "attendance_update"
  | "consumable_delivery"
  | "inspection_note"
  | "other";

export interface ExtractedEvent extends Base {
  type: ExtractedType;
  message_ids: string[];
  summary: string;
  fields: Record<string, unknown>;
  mapped: { task_ids?: string[]; ticket_id?: string; location_id?: string; staff_id?: string; inspection_id?: string; consumable_id?: string };
  confidence: number;
  review_status: "auto_accepted" | "needs_review" | "accepted" | "rejected";
  applied: boolean;
  engine: "mock" | "live";
  note?: string;
}

export type Severity = "info" | "warning" | "high";

export interface Alert {
  id: string;
  rule_id: string;
  severity: Severity;
  title: string;
  reason: string;
  targets: string[]; // alert role targets (assignee, supervisor, fm, zonal ...)
  created_at: number;
  status: "open" | "acknowledged" | "resolved";
  notes: { at: number; by: string; text: string }[];
  entity: { type: "task" | "ticket" | "attendance" | "meter" | "consumable"; id: string };
  billing_impact?: boolean;
  recurring?: boolean;
}

// Simulated WhatsApp messages between the bot and a person's phone.
export interface ChatMessage {
  id: string;
  phone_owner: string; // staff id
  from: "bot" | "user";
  at: number;
  text: string;
  buttons?: { id: string; title: string }[];
  photo?: string;
  task_id?: string;
  ticket_id?: string;
  payload: unknown; // WhatsApp Cloud API shaped payload
}

export type ConvState =
  | { kind: "idle" }
  | { kind: "awaiting_photo"; task_id: string }
  | { kind: "awaiting_remark"; task_id: string; status: "partial" | "not_done" }
  | { kind: "stepwise"; task_id: string; item_index: number; pending_out_of_range?: { item_id: string; value: number } }
  | { kind: "ticket_location"; draft: { text: string; category: TicketCategory; priority: Priority; photo?: string; confidence: number; by: "mock" | "live" } }
  | { kind: "awaiting_closure"; ticket_id: string };

export interface AIAuditEntry {
  id: string;
  at: number;
  feature: "extraction" | "classification" | "chat" | "meter_reading" | "insight" | "intent";
  mode: "mock" | "live";
  input_hash: string;
  input_preview: string;
  output: string;
  confidence: number | null;
  latency_ms: number;
  ok: boolean;
  retried?: boolean;
  error?: string;
}

export interface PlannedShiftAttendance {
  date: string;
  shift_id: string;
  start_at: number;
  guards_present: number;
  replacements: number;
  applied: boolean;
}

export interface DB {
  meta: { seed: number; generated_at: string; today: string; sim_start: number; days: number };
  project: Project;
  locations: Location[];
  serviceLines: ServiceLine[];
  staff: Staff[];
  shifts: Shift[];
  attendance: AttendanceRecord[];
  plannedAttendance: PlannedShiftAttendance[];
  sops: SOP[];
  templates: ChecklistTemplate[];
  tasks: TaskInstance[];
  inspections: Inspection[];
  tickets: Ticket[];
  meters: Meter[];
  meterReadings: MeterReading[];
  consumables: ConsumableDelivery[];
  quotations: Quotation[];
  executions: ProjectWorkExecution[];
  rawMessages: RawMessage[];
  extracted: ExtractedEvent[];
  alerts: Alert[];
  chat: ChatMessage[];
  convState: Record<string, ConvState>;
  rainDays: string[];
  audit: AIAuditEntry[];
  counters: Record<string, number>;
}
