// Rising and falling for the songs on a screen: loads when each went active in its current
// pool, and where from, then applies @rotavox/schema's deriveDirection.
import { and, eq, inArray, sql } from "drizzle-orm";
import { categories, deriveDirection, lifecycleEvents, songCategories, type DirectionResult, type LadderPool } from "@rotavox/schema";
import { db } from "./db";

export interface DirectionSong {
  id: string;
  state: string;
  poolId: string | null;
}

/** Direction by song id, for the songs that have one. */
export async function directionsFor(stationId: string, rows: DirectionSong[]): Promise<Record<string, DirectionResult>> {
  const cats = await db
    .select({ id: categories.id, ladderRank: categories.ladderRank, fallingAfterDays: categories.fallingAfterDays })
    .from(categories)
    .where(eq(categories.stationId, stationId));
  const pools = new Map<string, LadderPool>(cats.map((c) => [c.id, c]));
  // Only active songs in a ranked pool can have a direction.
  const candidates = rows.filter((r) => r.state === "active" && r.poolId && pools.get(r.poolId)?.ladderRank != null);
  if (candidates.length === 0) return {};

  // The latest event that made each song active in its current primary pool: a move in, a
  // return from rest or the bench, or the import (which knows when, not from where).
  const entries = await db
    .selectDistinctOn([lifecycleEvents.songId], {
      songId: lifecycleEvents.songId,
      at: lifecycleEvents.at,
      fromCategoryId: lifecycleEvents.fromCategoryId,
      source: lifecycleEvents.source,
    })
    .from(lifecycleEvents)
    .innerJoin(
      songCategories,
      and(
        eq(songCategories.songId, lifecycleEvents.songId),
        eq(songCategories.role, "primary"),
        eq(songCategories.categoryId, lifecycleEvents.toCategoryId)
      )
    )
    .where(
      and(
        eq(lifecycleEvents.stationId, stationId),
        inArray(lifecycleEvents.songId, candidates.map((c) => c.id)),
        eq(lifecycleEvents.toState, "active"),
        sql`(${lifecycleEvents.source} = 'import'
          OR ${lifecycleEvents.fromCategoryId} IS DISTINCT FROM ${lifecycleEvents.toCategoryId}
          OR ${lifecycleEvents.fromState} IS DISTINCT FROM 'active')`
      )
    )
    .orderBy(lifecycleEvents.songId, sql`${lifecycleEvents.at} desc`);
  const entryBySong = new Map(entries.map((e) => [e.songId, e]));

  const now = new Date();
  const out: Record<string, DirectionResult> = {};
  for (const r of candidates) {
    const e = entryBySong.get(r.id);
    const result = deriveDirection(
      r.state,
      pools.get(r.poolId!) ?? null,
      e
        ? {
            at: e.at,
            from: e.fromCategoryId ? pools.get(e.fromCategoryId) ?? null : null,
            known: e.source !== "import",
          }
        : null,
      now
    );
    if (result) out[r.id] = result;
  }
  return out;
}
