// Making categories from the UI (ADR-0002: the UI owns format data). A category may map
// to one of RadioDJ's subcategories, which is what lets the Inbox place a song where
// RadioDJ already files it, and what applied changes are written back to. A station
// without a Runner makes categories with no mapping.
import { and, asc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { categories, rdjSubcategories, songs } from "./schema.js";
import { ChangesetError } from "./changesets.js";

type Db = PostgresJsDatabase<typeof schema>;

export const CATEGORY_KINDS = ["music", "imaging"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/** RadioDJ categories whose subcategories hold imaging, not music, for the form's first guess. */
const IMAGING_PARENTS = /sweeper|station id|promo|jingle|imaging|liner|stinger/i;

export interface UnmappedSubcategory {
  rdjSubcategoryId: number;
  name: string;
  parentName: string | null;
  /** The kind the form suggests, from the RadioDJ category it sits in. */
  suggestedKind: CategoryKind;
  /** Active songs Rotavox has in it: what the Inbox can place once it has a category. */
  songs: number;
}

/**
 * RadioDJ subcategories no category maps, with the songs waiting in each. Lifecycle
 * subcategories (benched, resting, retired) aren't pools, so they're left out.
 */
export async function listUnmappedSubcategories(db: Db, stationId: string): Promise<UnmappedSubcategory[]> {
  const [station] = await db
    .select({ lifecycle: schema.stations.rdjLifecycleSubcats })
    .from(schema.stations)
    .where(eq(schema.stations.id, stationId));
  const lifecycle = new Set(Object.keys((station?.lifecycle as Record<string, unknown> | null) ?? {}).map(Number));
  // The outer column is written out with its table: Drizzle leaves it bare inside sql``,
  // and songs has a column of the same name, which a bare one would bind to.
  const rows = await db
    .select({
      rdjSubcategoryId: rdjSubcategories.rdjSubcategoryId,
      name: rdjSubcategories.name,
      parentName: rdjSubcategories.parentName,
      songs: sql<number>`(
        SELECT count(*)::int FROM ${songs} s
        WHERE s.station_id = ${stationId} AND s.rdj_subcategory_id = rdj_subcategories.rdj_subcategory_id
          AND s.lifecycle_state = 'active' AND s.rdj_song_id > 0
      )`,
    })
    .from(rdjSubcategories)
    .where(
      and(
        eq(rdjSubcategories.stationId, stationId),
        sql`NOT EXISTS (
          SELECT 1 FROM ${categories} c
          WHERE c.station_id = ${stationId} AND rdj_subcategories.rdj_subcategory_id = ANY (c.rdj_subcategory_ids)
        )`,
      ),
    )
    .orderBy(asc(rdjSubcategories.parentName), asc(rdjSubcategories.name));
  return rows
    .filter((r) => !lifecycle.has(r.rdjSubcategoryId))
    .map((r) => ({ ...r, suggestedKind: IMAGING_PARENTS.test(r.parentName ?? "") ? "imaging" : "music" }));
}

export async function createCategory(
  db: Db,
  stationId: string,
  input: { name: string; kind: string; rdjSubcategoryId?: number | null },
): Promise<typeof categories.$inferSelect> {
  const name = input.name.trim();
  if (!name) throw new ChangesetError("invalid", "Give the category a name.");
  if (name.length > 60) throw new ChangesetError("invalid", "Keep the name to 60 characters.");
  if (!CATEGORY_KINDS.includes(input.kind as CategoryKind)) {
    throw new ChangesetError("invalid", `kind must be one of ${CATEGORY_KINDS.join(", ")}`);
  }
  const subcat = input.rdjSubcategoryId ?? null;
  if (subcat !== null && !Number.isInteger(subcat)) throw new ChangesetError("invalid", "Not a RadioDJ subcategory.");

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ name: categories.name, rdj: categories.rdjSubcategoryIds })
      .from(categories)
      .where(eq(categories.stationId, stationId));
    if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      throw new ChangesetError("conflict", `There's already a category called ${name}.`);
    }
    if (subcat !== null) {
      const owner = existing.find((c) => c.rdj?.includes(subcat));
      if (owner) throw new ChangesetError("conflict", `${owner.name} already maps that RadioDJ subcategory.`);
      const [known] = await tx
        .select({ id: rdjSubcategories.id })
        .from(rdjSubcategories)
        .where(and(eq(rdjSubcategories.stationId, stationId), eq(rdjSubcategories.rdjSubcategoryId, subcat)));
      if (!known) throw new ChangesetError("invalid", "RadioDJ has no such subcategory, as of the last library sync.");
    }
    const [row] = await tx
      .insert(categories)
      .values({ stationId, name, kind: input.kind, rdjSubcategoryIds: subcat === null ? null : [subcat] })
      .returning();
    return row;
  });
}

/** Replaces the station's copy of RadioDJ's subcategory names with what the Runner just read. */
export async function replaceRdjSubcategories(
  db: Db,
  stationId: string,
  subcats: { id: number; name: string; parent: string | null }[],
  at: Date = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(rdjSubcategories).where(eq(rdjSubcategories.stationId, stationId));
    if (subcats.length === 0) return;
    await tx.insert(rdjSubcategories).values(
      subcats.map((s) => ({
        stationId,
        rdjSubcategoryId: s.id,
        name: s.name,
        parentName: s.parent,
        syncedAt: at,
      })),
    );
  });
}

/** Bounds for each lifecycle setting on a pool; past them the number isn't meaningful. */
export const POOL_LIFECYCLE_LIMITS = {
  restReviewDays: { max: 400, label: "A rest standard", unit: "days" },
  ladderRank: { max: 20, label: "A ladder rank", unit: "" },
  fallingAfterDays: { max: 400, label: "A falling-after time", unit: "days" },
  promoteAfterDays: { max: 730, label: "A move-on time", unit: "days" },
  benchAfterUnairedDays: { max: 365, label: "An unaired-for time", unit: "days" },
} as const;
export type PoolLifecycleField = keyof typeof POOL_LIFECYCLE_LIMITS;
/** Settings that name another pool. */
export const POOL_LIFECYCLE_REFS = {
  restExitCategoryId: "Where songs leave rest to",
  promoteToCategoryId: "Where songs move on to",
} as const;
export type PoolLifecycleRef = keyof typeof POOL_LIFECYCLE_REFS;
export type PoolLifecycleSettings = Partial<Record<PoolLifecycleField, number | null> & Record<PoolLifecycleRef, string | null>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sets a pool's lifecycle settings; a field left out is unchanged, null clears it.
 *   restReviewDays   — standard rest before songs resting from it come up for review (ADR-0002 §6.2)
 *   ladderRank       — place on the currents ladder, 1 = hottest, for rising and falling
 *   fallingAfterDays — how long a song stays active here before it counts as falling
 *   restExitCategoryId — where a song leaving rest from here is suggested to go (null: back here)
 *   promoteAfterDays + promoteToCategoryId — after so long here, suggest moving on there
 *   benchAfterUnairedDays — suggest benching a song here that hasn't aired in so long
 * Each only changes what is shown and suggested; none moves a song.
 */
export async function setPoolLifecycle(
  db: Db,
  stationId: string,
  categoryId: string,
  settings: PoolLifecycleSettings,
): Promise<void> {
  const patch: PoolLifecycleSettings = {};
  for (const [field, limits] of Object.entries(POOL_LIFECYCLE_LIMITS) as [PoolLifecycleField, (typeof POOL_LIFECYCLE_LIMITS)[PoolLifecycleField]][]) {
    if (!(field in settings)) continue;
    const v = settings[field];
    if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > limits.max)) {
      throw new ChangesetError(
        "invalid",
        `${limits.label} is a whole number${limits.unit ? ` of ${limits.unit}` : ""}, 1 to ${limits.max}.`,
      );
    }
    patch[field] = v ?? null;
  }
  if (!UUID.test(categoryId)) throw new ChangesetError("not_found", "No such category at this station.");
  for (const [field, label] of Object.entries(POOL_LIFECYCLE_REFS) as [PoolLifecycleRef, string][]) {
    if (!(field in settings)) continue;
    const v = settings[field];
    if (v !== null) {
      if (typeof v !== "string" || !UUID.test(v)) throw new ChangesetError("invalid", `${label}: choose a pool.`);
      if (v === categoryId) throw new ChangesetError("invalid", `${label}: choose a different pool.`);
      const [other] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.stationId, stationId), eq(categories.id, v)));
      if (!other) throw new ChangesetError("invalid", `${label}: that pool isn't at this station.`);
    }
    patch[field] = v ?? null;
  }
  if (Object.keys(patch).length === 0) throw new ChangesetError("invalid", "Nothing to change.");
  const updated = await db
    .update(categories)
    .set(patch)
    .where(and(eq(categories.stationId, stationId), eq(categories.id, categoryId)))
    .returning({ id: categories.id });
  if (updated.length === 0) throw new ChangesetError("not_found", "No such category at this station.");
}
