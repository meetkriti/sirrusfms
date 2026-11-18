import hierarchyJson from "../config/hierarchy.json";
import alertRulesJson from "../config/alert_rules.json";
import slaJson from "../config/sla_matrix.json";
import templatesJson from "../config/checklist_templates.json";
import exportJson from "../config/meter_export_format.json";
import billingJson from "../config/billing_rules.json";
import type { ChecklistTemplate, Level, RoleId, ServiceLineId, SlaMatrix, TicketCategory } from "./types";

export interface AlertRule {
  id: string;
  name: string;
  trigger:
    | "task_not_started_at_due"
    | "task_overdue"
    | "recurring_miss"
    | "reading_out_of_range"
    | "security_headcount_below_contract";
  enabled: boolean;
  offset_min?: number;
  use_template_grace?: boolean;
  grace_override_min?: number | null;
  count?: number;
  window_days?: number;
  notify: string[];
  severity: "info" | "warning" | "high";
  send_whatsapp?: boolean;
  billing_impact?: boolean;
}

export interface ExportColumn {
  key: string;
  header: string;
  enabled: boolean;
}
export interface ExportFormat {
  file_name: string;
  date_format: string;
  columns: ExportColumn[];
}

export interface BillingRules {
  security: {
    guard_rate_per_man_day: number;
    supervisor_rate_per_man_day: number;
    contracted_guards_per_shift: number;
    contracted_supervisors_per_shift: number;
    count_approved_replacements: boolean;
    count_unapproved_replacements: boolean;
    half_day_factor: number;
  };
  fixed_monthly: { service_line: ServiceLineId; label: string; amount: number }[];
  consumables: { require_acknowledgement: boolean };
  project_work: { bill_on: string; only_approved_quotations: boolean };
}

export interface RoleDef {
  id: RoleId;
  label: string;
  level: string;
  defaultRoute: string;
  phoneOwner: string;
}

export interface Hierarchy {
  levels: { level: string; title: string; channel: string; dashboard: boolean }[];
  roles: RoleDef[];
  owners: { L1: Record<string, string>; L2: string; L3: string; L4: string };
  categoryToServiceLine: Record<TicketCategory, ServiceLineId>;
  alertRoleTargets: Record<string, string>;
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export const defaultConfig = {
  hierarchy: hierarchyJson as unknown as Hierarchy,
  alertRules: (alertRulesJson as { rules: AlertRule[] }).rules,
  sla: (slaJson as unknown as { priorities: SlaMatrix }).priorities,
  templates: (templatesJson as unknown as { templates: ChecklistTemplate[] }).templates,
  exportFormat: exportJson as unknown as ExportFormat,
  billing: billingJson as unknown as BillingRules,
};

export type AppConfig = typeof defaultConfig;

/** Live, editable copy of the config (Settings pages mutate this object). */
export const config: AppConfig = clone(defaultConfig);

export function resetConfig() {
  const fresh = clone(defaultConfig);
  Object.assign(config, fresh);
}

export function ownerFor(level: Level, serviceLine: ServiceLineId): string {
  const o = config.hierarchy.owners;
  if (level === "L1") return o.L1[serviceLine] ?? o.L1.technical;
  return o[level];
}
