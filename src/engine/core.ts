import type { ChecklistTemplate, DB, Location, Source, Staff } from "../types";

export const PROJECT_ID = "lakeshore-greens";

/** A world is the database plus the simulation clock. Engine functions mutate it in place. */
export interface World {
  db: DB;
  now: number;
}

export function nid(db: DB, prefix: string, width = 5): string {
  db.counters[prefix] = (db.counters[prefix] ?? 0) + 1;
  return `${prefix}-${String(db.counters[prefix]).padStart(width, "0")}`;
}

export function baseFields(db: DB, prefix: string, at: number, source: Source) {
  return { id: nid(db, prefix), project_id: PROJECT_ID, created_at: at, updated_at: at, source };
}

const cache = new WeakMap<DB, { staff: Map<string, Staff>; tpl: Map<string, ChecklistTemplate>; loc: Map<string, Location> }>();
function idx(db: DB) {
  let c = cache.get(db);
  if (!c || c.staff.size !== db.staff.length || c.loc.size !== db.locations.length || c.tpl.size !== db.templates.length) {
    c = {
      staff: new Map(db.staff.map((s) => [s.id, s])),
      tpl: new Map(db.templates.map((t) => [t.id, t])),
      loc: new Map(db.locations.map((l) => [l.id, l])),
    };
    cache.set(db, c);
  }
  return c;
}

export const staffById = (db: DB, id: string) => idx(db).staff.get(id);
export const templateById = (db: DB, id: string) => idx(db).tpl.get(id);
export const locationById = (db: DB, id: string) => idx(db).loc.get(id);

export function staffName(db: DB, id: string | null | undefined): string {
  if (!id) return "—";
  return staffById(db, id)?.name ?? id;
}

export function locationName(db: DB, id: string): string {
  return locationById(db, id)?.name ?? id;
}

export function towerOf(db: DB, locationId: string): string | undefined {
  return locationById(db, locationId)?.tower;
}

export function firstName(db: DB, id: string): string {
  return staffName(db, id).split(" ")[0];
}

export function taskTitle(db: DB, templateId: string, locationId: string): string {
  const t = templateById(db, templateId);
  const loc = locationById(db, locationId);
  const where = loc?.kind === "project" || (loc && t?.name.toLowerCase().includes(loc.name.toLowerCase())) ? "" : `, ${loc?.name ?? locationId}`;
  return `${t?.name ?? templateId}${where}`;
}
