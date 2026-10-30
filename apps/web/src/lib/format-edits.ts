// Read models for Format › Clocks. Writes go through @rotavox/schema's clocks module.
import { asc, eq } from "drizzle-orm";
import { categories } from "@rotavox/schema";
import { db } from "./db";

export interface ClockCategoryOption {
  id: string;
  name: string;
  kind: string;
  group: string | null;
  /** A grouping node: its songs sit in its sub-pools, so a clock calling it draws nothing. */
  isGroup: boolean;
}

/** Every category a clock might call, current values included, so no picker ever drops one. */
export async function getClockCategoryOptions(stationId: string): Promise<ClockCategoryOption[]> {
  const rows = await db.select().from(categories).where(eq(categories.stationId, stationId)).orderBy(asc(categories.name));
  const parents = new Set(rows.map((r) => r.parentId).filter(Boolean));
  const nameById = new Map(rows.map((r) => [r.id, r.name]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    group: r.parentId ? nameById.get(r.parentId) ?? null : null,
    isGroup: parents.has(r.id),
  }));
}
