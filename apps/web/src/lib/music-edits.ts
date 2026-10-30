// Read models for the music editing screens: the unassigned inbox and the changeset
// review. Writes go through @rotavox/schema's changeset functions, never directly.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  categories,
  changesets,
  getDraft,
  placementForSubcat,
  songCategories,
  songs,
  stations,
  type ChangesetItemRow,
  type LifecycleSubcatMap,
  type Placement,
  type ChangesetWithItems,
} from "@rotavox/schema";
import { db } from "./db";
import { computeBalance, withPlacements, type BalanceStatus, type CategoryBalance } from "./balance";
import { loadBalanceInput } from "./queries";

export interface CategoryOption {
  id: string;
  name: string;
  kind: string;
  /** Parent's name, for grouping in a picker. */
  group: string | null;
}

/**
 * Categories a song can be placed in: the leaves. A grouping node (Currents, Gold) has no
 * songs of its own; its depth is its sub-pools'.
 */
export async function getPlaceableCategories(stationId: string): Promise<CategoryOption[]> {
  const rows = await db.select().from(categories).where(eq(categories.stationId, stationId)).orderBy(asc(categories.name));
  const parents = new Set(rows.map((r) => r.parentId).filter(Boolean));
  const nameById = new Map(rows.map((r) => [r.id, r.name]));
  const kindOrder = (k: string) => (k === "music" ? 0 : 1);
  return rows
    .filter((r) => !parents.has(r.id))
    .map((r) => ({ id: r.id, name: r.name, kind: r.kind, group: r.parentId ? nameById.get(r.parentId) ?? null : null }))
    .sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || (a.group ?? a.name).localeCompare(b.group ?? b.name) || a.name.localeCompare(b.name));
}

export interface InboxSong {
  id: string;
  rdjSongId: number;
  artist: string | null;
  title: string | null;
  album: string | null;
  enabled: boolean | null;
  songType: number | null;
  rdjSubcategoryId: number | null;
  durationMs: number | null;
  /** Where the draft would put it, if it is staged. */
  stagedCategoryId: string | null;
  /** In the draft at all — a staged bench has no pool to show. */
  isStaged: boolean;
  /**
   * What its RadioDJ subcategory means, when that is anything: a song filed in A1 in
   * RadioDJ since the import arrives here with A1 suggested. Null when it maps to nothing.
   */
  suggested: Placement | null;
}

export interface Inbox {
  imported: boolean;
  songs: InboxSong[];
}

/**
 * Active songs with no pool — imported from a RadioDJ subcategory nobody mapped, or added
 * to the library since. They exist but the engine can never schedule them. The retired
 * mirror (rdj_song_id <= 0) is not inventory.
 */
export async function getInbox(stationId: string): Promise<Inbox> {
  const [station] = await db.select().from(stations).where(eq(stations.id, stationId));
  if (!station) return { imported: false, songs: [] };
  const rows = await db
    .select({
      id: songs.id,
      rdjSongId: songs.rdjSongId,
      artist: songs.artist,
      title: songs.title,
      album: songs.album,
      enabled: songs.enabled,
      songType: songs.songType,
      rdjSubcategoryId: songs.rdjSubcategoryId,
      durationMs: sql<number | null>`coalesce(${songs.effectiveDurationMs}, ${songs.durationMs})`,
    })
    .from(songs)
    .where(
      and(
        eq(songs.stationId, stationId),
        eq(songs.lifecycleState, "active"),
        sql`${songs.rdjSongId} > 0`,
        sql`NOT EXISTS (SELECT 1 FROM ${songCategories} sc WHERE sc.song_id = ${songs.id} AND sc.role = 'primary')`
      )
    )
    .orderBy(asc(songs.artist), asc(songs.title));

  const [draft, cats] = await Promise.all([
    getDraft(db, stationId),
    db
      .select({ id: categories.id, name: categories.name, rdjSubcategoryIds: categories.rdjSubcategoryIds })
      .from(categories)
      .where(eq(categories.stationId, stationId)),
  ]);
  const lifecycle = (station.rdjLifecycleSubcats ?? null) as LifecycleSubcatMap | null;
  const staged = new Map((draft?.items ?? []).map((i) => [i.songId, i.to.categoryId]));
  return {
    imported: station.membershipImportedAt != null,
    songs: rows.map((r) => {
      const p = placementForSubcat(r.rdjSubcategoryId, cats, lifecycle, null);
      return {
        ...r,
        stagedCategoryId: staged.get(r.id) ?? null,
        isStaged: staged.has(r.id),
        suggested: p.state === "active" && !p.categoryId ? null : p,
      };
    }),
  };
}

export async function getInboxCount(stationId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(songs)
    .where(
      and(
        eq(songs.stationId, stationId),
        eq(songs.lifecycleState, "active"),
        sql`${songs.rdjSongId} > 0`,
        sql`NOT EXISTS (SELECT 1 FROM ${songCategories} sc WHERE sc.song_id = ${songs.id} AND sc.role = 'primary')`
      )
    );
  return Number(row?.n ?? 0);
}

export interface ImpactRow {
  id: string;
  name: string;
  before: Pick<CategoryBalance, "enabledDepth" | "restingDepth" | "projectedTurnoverHours" | "status">;
  after: Pick<CategoryBalance, "enabledDepth" | "restingDepth" | "projectedTurnoverHours" | "status">;
  targetTurnoverHours: number | null;
}

const IMPROVES: Record<BalanceStatus, number> = {
  empty: 0,
  hot: 1,
  covered: 2,
  cold: 3,
  no_target: 4,
  filler: 5,
  fallback: 5,
  uncalled: 5,
  on_target: 6,
};

/** Whether a status change is for the better, for the worse, or neither. */
export function statusDirection(before: BalanceStatus, after: BalanceStatus): "better" | "worse" | "same" {
  if (before === after) return "same";
  return IMPROVES[after] > IMPROVES[before] ? "better" : IMPROVES[after] < IMPROVES[before] ? "worse" : "same";
}

/**
 * Category balance before and after a set of items — every category an item leaves or
 * enters, and their parents, since a grouping node's depth is its sub-pools'.
 */
export async function computeImpact(stationId: string, items: ChangesetItemRow[]): Promise<ImpactRow[]> {
  if (items.length === 0) return [];
  const input = await loadBalanceInput(stationId);
  if (!input) return [];
  const enabledRows = await db
    .select({ id: songs.id, enabled: songs.enabled })
    .from(songs)
    .where(inArray(songs.id, items.map((i) => i.songId)));
  const enabled = new Map(enabledRows.map((r) => [r.id, r.enabled]));

  const before = computeBalance(input);
  const after = computeBalance(
    withPlacements(
      input,
      items.map((i) => ({ songId: i.songId, to: i.to, enabled: enabled.get(i.songId) ?? null }))
    )
  );
  const parentOf = new Map(input.categories.map((c) => [c.id, c.parentId]));
  const touched = new Set<string>();
  for (const i of items) {
    for (let c = i.from.categoryId; c; c = parentOf.get(c) ?? null) touched.add(c);
    for (let c = i.to.categoryId; c; c = parentOf.get(c) ?? null) touched.add(c);
  }
  const afterById = new Map(after.map((a) => [a.id, a]));
  const pick = (b: CategoryBalance) => ({
    enabledDepth: b.enabledDepth,
    restingDepth: b.restingDepth,
    projectedTurnoverHours: b.projectedTurnoverHours,
    status: b.status,
  });
  return before
    .filter((b) => touched.has(b.id))
    .map((b) => ({
      id: b.id,
      name: b.name,
      before: pick(b),
      after: pick(afterById.get(b.id)!),
      targetTurnoverHours: b.targetTurnoverHours,
    }))
    .filter((r) => r.before.enabledDepth !== r.after.enabledDepth || r.before.restingDepth !== r.after.restingDepth || r.before.status !== r.after.status)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface DraftReview {
  draft: ChangesetWithItems | null;
  impact: ImpactRow[];
  categoryNames: Map<string, string>;
}

export async function getDraftReview(stationId: string): Promise<DraftReview> {
  const draft = await getDraft(db, stationId);
  const [impact, cats] = await Promise.all([
    computeImpact(stationId, draft?.items ?? []),
    db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.stationId, stationId)),
  ]);
  return { draft, impact, categoryNames: new Map(cats.map((c) => [c.id, c.name])) };
}

export async function getCategoryNames(stationId: string): Promise<Map<string, string>> {
  const cats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.stationId, stationId));
  return new Map(cats.map((c) => [c.id, c.name]));
}

export interface ChangesStatus {
  draftItems: number;
  inbox: number;
  /** Applied in Rotavox, not yet written to RadioDJ. */
  pendingProjection: number;
  failedProjection: number;
}

export async function getChangesStatus(stationId: string): Promise<ChangesStatus> {
  const [draft, inbox, [proj]] = await Promise.all([
    getDraft(db, stationId),
    getInboxCount(stationId),
    db
      .select({
        pending: sql<number>`count(*) filter (where ${changesets.projection} = 'pending')`,
        failed: sql<number>`count(*) filter (where ${changesets.projection} = 'failed')`,
      })
      .from(changesets)
      .where(and(eq(changesets.stationId, stationId), eq(changesets.status, "applied"))),
  ]);
  return {
    draftItems: draft?.items.length ?? 0,
    inbox,
    pendingProjection: Number(proj?.pending ?? 0),
    failedProjection: Number(proj?.failed ?? 0),
  };
}

export interface PoolEditing {
  imported: boolean;
  /** Where the draft would put each staged song, by song id. */
  staged: Record<string, Placement>;
}

/** What the category page needs to edit its songs: whether edits are open yet, and the draft's targets. */
export async function getPoolEditing(stationId: string): Promise<PoolEditing> {
  const [[station], draft] = await Promise.all([
    db.select({ importedAt: stations.membershipImportedAt }).from(stations).where(eq(stations.id, stationId)),
    getDraft(db, stationId),
  ]);
  return {
    imported: station?.importedAt != null,
    staged: Object.fromEntries((draft?.items ?? []).map((i) => [i.songId, i.to])),
  };
}

/**
 * Where a song leaving rest is suggested to go (ADR-0002 §6.1): R1, when the station has
 * one. Returning to its own pool is always offered alongside.
 */
export function suggestedRestExit(options: CategoryOption[]): CategoryOption | null {
  return options.find((o) => o.kind === "music" && o.name.toUpperCase() === "R1") ?? null;
}
