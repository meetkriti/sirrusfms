import { config, type AlertRule } from "../config";
import type { Alert, DB, RoleId, ServiceLineId } from "../types";
import { nid, type World } from "./core";
import { SimulatedAdapter } from "./messaging";

export function rule(id: string): AlertRule | undefined {
  return config.alertRules.find((r) => r.id === id);
}

/** Map an alert target to a staff member who has a WhatsApp phone in the simulator. */
export function targetStaff(target: string, ctx: { serviceLine?: ServiceLineId; assignee?: string }): string | null {
  const o = config.hierarchy.owners;
  switch (target) {
    case "assignee":
      return ctx.assignee ?? null;
    case "supervisor":
      return ctx.serviceLine ? o.L1[ctx.serviceLine] ?? null : null;
    case "tech_supervisor":
      return o.L1.technical;
    case "security_supervisor":
      return o.L1.security;
    case "fm":
      return o.L2;
    case "zonal":
      return o.L3;
    case "ops_head":
      return o.L4;
    default:
      return null;
  }
}

const WHATSAPP_TARGETS = new Set(["assignee", "supervisor", "tech_supervisor", "security_supervisor", "fm"]);

export function raiseAlert(
  w: World,
  a: Omit<Alert, "id" | "created_at" | "status" | "notes">,
  ctx: { serviceLine?: ServiceLineId; assignee?: string; whatsapp?: boolean } = {},
): Alert {
  const alert: Alert = { ...a, id: nid(w.db, "ALR"), created_at: w.now, status: "open", notes: [] };
  w.db.alerts.push(alert);
  if (ctx.whatsapp) {
    const wa = new SimulatedAdapter(w);
    const sent = new Set<string>();
    for (const t of a.targets) {
      if (!WHATSAPP_TARGETS.has(t) || t === "assignee") continue;
      const sid = targetStaff(t, ctx);
      if (!sid || sent.has(sid)) continue;
      sent.add(sid);
      const icon = a.severity === "high" ? "🔴" : a.severity === "warning" ? "🟠" : "🔵";
      wa.sendMessage(sid, `${icon} Alert: ${a.title}\n${a.reason}`, a.entity.type === "ticket" ? { ticket_id: a.entity.id } : a.entity.type === "task" ? { task_id: a.entity.id } : {});
    }
  }
  return alert;
}

const ROLE_TARGETS: Record<RoleId, string[]> = {
  ground: ["assignee"],
  supervisor: ["assignee", "supervisor", "tech_supervisor", "security_supervisor"],
  fm: ["fm", "supervisor", "tech_supervisor", "security_supervisor"],
  zonal: ["zonal"],
  ops_head: ["ops_head", "zonal"],
  finance: ["finance"],
  client: [],
};

export function alertsForRole(db: DB, role: RoleId): Alert[] {
  const targets = new Set(ROLE_TARGETS[role]);
  return db.alerts.filter((a) => {
    if (role === "ops_head" && a.severity === "high") return true;
    if (role === "finance" && a.billing_impact) return true;
    return a.targets.some((t) => targets.has(t));
  });
}

export function targetLabels(targets: string[]): string {
  return targets.map((t) => config.hierarchy.alertRoleTargets[t] ?? t).join(", ");
}
