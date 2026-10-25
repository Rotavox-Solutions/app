// Pool membership and lifecycle state — Rotavox-owned once a station is imported
// (ADR-0002). One module, used by the one-time import and by the Runner when it mirrors
// an applied changeset, so both translate a RadioDJ subcategory the same way.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { categories, lifecycleEvents, playHistory, songCategories, songs, stations } from "./schema.js";
import { utcTimestamp } from "./connection.js";

export type LifecycleState = "active" | "resting" | "benched" | "retired";
export const LIFECYCLE_STATES: readonly LifecycleState[] = ["active", "resting", "benched", "retired"];

/** A RadioDJ subcategory that encodes a state rather than a pool. */
export interface LifecycleSubcatRule {
  state: Exclude<LifecycleState, "active">;
  /** Category name a resting song belongs to (ZN → "N"). Ignored for other states. */
  origin?: string;
  /**
   * Where a change made in Rotavox lands when several subcategories encode the same state
   * (W and Y both bench). Reading is unaffected: every one of them still means the state.
   */
  default?: boolean;
}
export type LifecycleSubcatMap = Record<string, LifecycleSubcatRule>;

export interface ProjectedCategory {
  id: string;
  name: string;
  rdjSubcategoryIds: number[] | null;
}

/** Where a song sits in Rotavox terms. `categoryId` is its primary pool, or null. */
export interface Placement {
  state: LifecycleState;
  categoryId: string | null;
}

/**
 * Problems that would make subcategory translation ambiguous. Checked before any write:
 * a subcategory claimed twice would put a song in whichever pool happened to win.
 */
export function validateProjectionMap(cats: ProjectedCategory[], lifecycle: LifecycleSubcatMap | null): string[] {
  const errors: string[] = [];
  const owner = new Map<number, string>();
  for (const c of cats) {
    for (const id of c.rdjSubcategoryIds ?? []) {
      const prev = owner.get(id);
      if (prev) errors.push(`RadioDJ subcategory ${id} is mapped to both ${prev} and ${c.name}`);
      else owner.set(id, c.name);
    }
  }
  for (const [key, rule] of Object.entries(lifecycle ?? {})) {
    const id = Number(key);
    if (!Number.isInteger(id)) errors.push(`lifecycle subcategory key "${key}" is not an integer`);
    if (owner.has(id)) errors.push(`RadioDJ subcategory ${id} is both the pool ${owner.get(id)} and a ${rule.state} state`);
    if (!["resting", "benched", "retired"].includes(rule.state)) {
      errors.push(`lifecycle subcategory ${key} has unknown state "${rule.state}"`);
    }
    if (rule.default && Object.values(lifecycle ?? {}).filter((r) => r.default && r.state === rule.state && !r.origin).length > 1) {
      errors.push(`more than one lifecycle subcategory is the default for ${rule.state}`);
    }
    if (rule.origin && !cats.some((c) => c.name === rule.origin)) {
      errors.push(`lifecycle subcategory ${key} names origin "${rule.origin}", which is not a category`);
    }
  }
  return errors;
}

/**
 * Pure: what a RadioDJ subcategory means for a song. A resting rule with no origin keeps
 * the song's current pool — moving a song from A1 into a generic rest subcategory rests
 * it FROM A1. A subcategory nobody mapped leaves the song active but unassigned.
 */
export function placementForSubcat(
  subcatId: number | null,
  cats: ProjectedCategory[],
  lifecycle: LifecycleSubcatMap | null,
  currentPrimary: string | null
): Placement {
  const rule = subcatId == null ? undefined : lifecycle?.[String(subcatId)];
  if (rule) {
    if (rule.state !== "resting") return { state: rule.state, categoryId: null };
    const origin = rule.origin ? cats.find((c) => c.name === rule.origin)?.id ?? null : null;
    return { state: "resting", categoryId: origin ?? currentPrimary };
  }
  const pool = subcatId == null ? undefined : cats.find((c) => c.rdjSubcategoryIds?.includes(subcatId));
  return { state: "active", categoryId: pool?.id ?? null };
}

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface PlacementChange {
  songId: string;
  placement: Placement;
  reason: string;
  source: "import" | "changeset" | "ui";
  sourceRef?: string | null;
  /** When the new state began, if earlier than `at` is known (the import's estimate). */
  since?: Date | null;
}

/**
 * Writes placements, recording a lifecycle event for each one that changes anything.
 * Idempotent: a placement matching the song's current state and pool is a no-op, which
 * is what makes a mirror safe to re-run after a partial failure. `recordUnchanged` still
 * writes the event for a no-op — the import needs it, because the event is what marks a
 * song imported.
 */
export async function applyPlacements(
  tx: Tx,
  stationId: string,
  changes: PlacementChange[],
  at: Date,
  opts: { recordUnchanged?: boolean } = {}
): Promise<number> {
  if (changes.length === 0) return 0;
  const songIds = changes.map((c) => c.songId);
  const current = await tx
    .select({ id: songs.id, state: songs.lifecycleState })
    .from(songs)
    .where(and(eq(songs.stationId, stationId), inArray(songs.id, songIds)));
  const stateBySong = new Map(current.map((r) => [r.id, r.state]));
  const primaries = await tx
    .select({ songId: songCategories.songId, categoryId: songCategories.categoryId })
    .from(songCategories)
    .where(and(inArray(songCategories.songId, songIds), eq(songCategories.role, "primary")));
  const primaryBySong = new Map(primaries.map((r) => [r.songId, r.categoryId]));

  let changed = 0;
  for (const c of changes) {
    const fromState = stateBySong.get(c.songId);
    if (fromState === undefined) throw new Error(`song ${c.songId} is not in station ${stationId}`);
    const fromCategory = primaryBySong.get(c.songId) ?? null;
    const { state, categoryId } = c.placement;
    const unchanged = fromState === state && fromCategory === categoryId;
    if (unchanged && !opts.recordUnchanged) continue;

    if (fromState !== state) {
      await tx
        .update(songs)
        .set({ lifecycleState: state, lifecycleSince: c.since ?? at })
        .where(eq(songs.id, c.songId));
    }
    if (state === "benched" || state === "retired") {
      // Out of the format: no pool, and no extra eligibility either.
      await tx.delete(songCategories).where(eq(songCategories.songId, c.songId));
    } else if (fromCategory !== categoryId) {
      await tx
        .delete(songCategories)
        .where(and(eq(songCategories.songId, c.songId), eq(songCategories.role, "primary")));
      if (categoryId) {
        // Promoting an 'also' row to primary: drop it first so the pair stays unique.
        await tx
          .delete(songCategories)
          .where(and(eq(songCategories.songId, c.songId), eq(songCategories.categoryId, categoryId)));
        await tx.insert(songCategories).values({ songId: c.songId, categoryId, role: "primary" });
      }
    }
    await tx.insert(lifecycleEvents).values({
      stationId,
      songId: c.songId,
      fromState,
      toState: state,
      fromCategoryId: fromCategory,
      toCategoryId: categoryId,
      source: c.source,
      sourceRef: c.sourceRef ?? null,
      reason: c.reason,
      at,
    });
    if (!unchanged) changed++;
  }
  return changed;
}

/** The station's projection map, validated. Throws when it is ambiguous or empty. */
export async function loadProjection(tx: Tx | Db, stationId: string) {
  const [station] = await tx.select().from(stations).where(eq(stations.id, stationId));
  if (!station) throw new Error(`station ${stationId} not found`);
  const cats = await tx
    .select({ id: categories.id, name: categories.name, rdjSubcategoryIds: categories.rdjSubcategoryIds })
    .from(categories)
    .where(eq(categories.stationId, stationId));
  const lifecycle = (station.rdjLifecycleSubcats ?? null) as LifecycleSubcatMap | null;
  const errors = validateProjectionMap(cats, lifecycle);
  if (!cats.some((c) => (c.rdjSubcategoryIds ?? []).length > 0)) {
    errors.push("no category carries rdj_subcategory_ids — the projection map is empty (re-run the format seed)");
  }
  if (errors.length) throw new Error(`Projection map is invalid:\n  - ${errors.join("\n  - ")}`);
  return { station, cats, lifecycle };
}

export interface ImportSummary {
  imported: number;
  changed: number;
  byState: Record<string, number>;
  unassigned: number;
  firstImport: boolean;
}

class DryRun extends Error {}

/**
 * The one-time membership import (ADR-0002 §4), and the interim intake path afterwards:
 * it only places songs with no lifecycle history, so re-running it picks up songs added
 * to the playout library since and never touches an authored decision.
 *
 * Songs with rdj_song_id <= 0 are a retired mirror (negated on the 2026-10-15 rebuild)
 * and are skipped.
 */
export async function importMembership(
  db: Db,
  stationId: string,
  opts: { dryRun?: boolean; at?: Date } = {}
): Promise<ImportSummary> {
  const at = opts.at ?? new Date();
  let summary: ImportSummary | undefined;
  try {
    await db.transaction(async (tx) => {
      const { station, cats, lifecycle } = await loadProjection(tx, stationId);
      const pending = await tx
        .select({ id: songs.id, subcatId: songs.rdjSubcategoryId })
        .from(songs)
        .where(
          and(
            eq(songs.stationId, stationId),
            sql`${songs.rdjSongId} > 0`,
            sql`NOT EXISTS (SELECT 1 FROM ${lifecycleEvents} WHERE ${lifecycleEvents.songId} = ${songs.id})`
          )
        );
      const primaries = await tx
        .select({ songId: songCategories.songId, categoryId: songCategories.categoryId })
        .from(songCategories)
        .innerJoin(songs, eq(songs.id, songCategories.songId))
        .where(and(eq(songs.stationId, stationId), eq(songCategories.role, "primary")));
      const primaryBySong = new Map(primaries.map((r) => [r.songId, r.categoryId]));

      // A song imported as resting has been off air since it last aired, not since today;
      // without this every imported rest would start at zero and no review would come due
      // until a full rest standard after the import.
      const lastAired = new Map(
        (
          await tx
            .select({ songId: playHistory.songId, at: sql<string>`max(${playHistory.airedAt})` })
            .from(playHistory)
            .where(eq(playHistory.stationId, stationId))
            .groupBy(playHistory.songId)
        )
          .filter((r) => r.songId)
          .map((r) => [r.songId!, utcTimestamp(r.at)])
      );

      const byState: Record<string, number> = {};
      let unassigned = 0;
      const changes: PlacementChange[] = pending.map((s) => {
        const placement = placementForSubcat(s.subcatId, cats, lifecycle, primaryBySong.get(s.id) ?? null);
        byState[placement.state] = (byState[placement.state] ?? 0) + 1;
        if (placement.state === "active" && !placement.categoryId) unassigned++;
        return {
          songId: s.id,
          placement,
          reason: `imported from RadioDJ subcategory ${s.subcatId ?? "(none)"}`,
          source: "import",
          since: placement.state === "resting" ? lastAired.get(s.id) ?? null : null,
        };
      });
      const changed = await applyPlacements(tx, stationId, changes, at, { recordUnchanged: true });
      const firstImport = station.membershipImportedAt == null;
      if (firstImport) await tx.update(stations).set({ membershipImportedAt: at }).where(eq(stations.id, stationId));

      summary = { imported: changes.length, changed, byState, unassigned, firstImport };
      if (opts.dryRun) throw new DryRun();
    });
  } catch (err) {
    if (!(err instanceof DryRun)) throw err;
  }
  return summary!;
}

export interface MirrorMove {
  rdjSongId: number;
  toSubcat: number;
  reason: string;
}

export interface MirrorResult {
  /** True when the station is not imported yet, so membership is still derived and nothing was mirrored. */
  skipped: boolean;
  changed: number;
  missing: number[];
}

/**
 * Mirrors moves already committed to RadioDJ into Rotavox membership (ADR-0002 §4.3), so
 * a changeset applied by the Runner lands in both systems. Safe to re-run.
 */
export async function mirrorChangesetMoves(
  db: Db,
  stationId: string,
  changesetId: string,
  moves: MirrorMove[],
  at: Date = new Date()
): Promise<MirrorResult> {
  return db.transaction(async (tx) => {
    const { station, cats, lifecycle } = await loadProjection(tx, stationId);
    if (!station.membershipImportedAt) return { skipped: true, changed: 0, missing: [] };
    if (moves.length === 0) return { skipped: false, changed: 0, missing: [] };

    const rows = await tx
      .select({ id: songs.id, rdjSongId: songs.rdjSongId })
      .from(songs)
      .where(and(eq(songs.stationId, stationId), inArray(songs.rdjSongId, moves.map((m) => m.rdjSongId))));
    const songByRdj = new Map(rows.map((r) => [r.rdjSongId, r.id]));
    const primaries = await tx
      .select({ songId: songCategories.songId, categoryId: songCategories.categoryId })
      .from(songCategories)
      .where(and(eq(songCategories.role, "primary"), inArray(songCategories.songId, rows.map((r) => r.id))));
    const primaryBySong = new Map(primaries.map((r) => [r.songId, r.categoryId]));

    const missing: number[] = [];
    const changes: PlacementChange[] = [];
    for (const m of moves) {
      const songId = songByRdj.get(m.rdjSongId);
      if (!songId) {
        missing.push(m.rdjSongId);
        continue;
      }
      changes.push({
        songId,
        placement: placementForSubcat(m.toSubcat, cats, lifecycle, primaryBySong.get(songId) ?? null),
        reason: m.reason,
        source: "changeset",
        sourceRef: changesetId,
      });
    }
    const changed = await applyPlacements(tx, stationId, changes, at);
    return { skipped: false, changed, missing };
  });
}
