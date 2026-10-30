// Read models for Music › Library: the whole library searched by text, state and pool, and
// one song's page with its lifecycle history. Writes go through changesets, never here.
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  categories,
  changesets,
  LIFECYCLE_STATES,
  lifecycleEvents,
  playHistory,
  songCategories,
  songs,
  utcTimestamp,
  type DirectionResult,
  type LifecycleState,
} from "@rotavox/schema";
import { db } from "./db";
import { directionsFor } from "./direction";
import { HOUR_MS } from "./constants";
import { RECENT_SPINS_DAYS } from "./queries";

export const LIBRARY_PAGE_SIZE = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LibraryFilter {
  q?: string;
  state?: LifecycleState;
  /** A category id, or "none" for songs with no primary pool. */
  pool?: string;
  page?: number;
}

export interface LibraryRow {
  id: string;
  rdjSongId: number;
  artist: string | null;
  title: string | null;
  album: string | null;
  enabled: boolean | null;
  songType: number | null;
  state: string;
  since: Date | null;
  poolId: string | null;
  poolName: string | null;
  restReviewDays: number | null;
  durationMs: number | null;
  lastAiredAt: Date | null;
  recentSpins: number;
}

export interface LibraryPage {
  rows: LibraryRow[];
  total: number;
  page: number;
  pageCount: number;
}

/** Parses the Library's URL search params, dropping anything that isn't a valid filter. */
export function parseLibraryFilter(params: Record<string, string | string[] | undefined>): LibraryFilter {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const state = one("state");
  const pool = one("pool");
  const page = Number(one("page"));
  return {
    q: one("q"),
    state: LIFECYCLE_STATES.includes(state as LifecycleState) ? (state as LifecycleState) : undefined,
    pool: pool === "none" || (pool && UUID.test(pool)) ? pool : undefined,
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/**
 * The library, a page at a time, by artist then title. The retired mirror (rdj_song_id
 * <= 0) is not inventory and never shows. Airplay is aggregated for the page's songs only.
 */
export async function searchLibrary(stationId: string, filter: LibraryFilter): Promise<LibraryPage> {
  const where: SQL[] = [eq(songs.stationId, stationId), sql`${songs.rdjSongId} > 0`];
  if (filter.q) {
    const pattern = `%${filter.q}%`;
    where.push(
      sql`(${songs.artist} ilike ${pattern} or ${songs.title} ilike ${pattern} or ${songs.album} ilike ${pattern})`
    );
  }
  if (filter.state) where.push(eq(songs.lifecycleState, filter.state));
  if (filter.pool === "none") where.push(sql`${songCategories.categoryId} is null`);
  else if (filter.pool) where.push(eq(songCategories.categoryId, filter.pool));

  const base = songRows().where(and(...where));

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(songs)
    .leftJoin(songCategories, and(eq(songCategories.songId, songs.id), eq(songCategories.role, "primary")))
    .where(and(...where));
  const total = Number(n);
  const pageCount = Math.max(1, Math.ceil(total / LIBRARY_PAGE_SIZE));
  const page = Math.min(filter.page ?? 1, pageCount);
  const rows = await base
    .orderBy(asc(songs.artist), asc(songs.title), asc(songs.rdjSongId))
    .limit(LIBRARY_PAGE_SIZE)
    .offset((page - 1) * LIBRARY_PAGE_SIZE);

  return {
    rows: await withAirplay(stationId, rows),
    total,
    page,
    pageCount,
  };
}

/** A song with its primary pool, in LibraryRow's shape less airplay. */
function songRows() {
  return db
    .select({
      id: songs.id,
      rdjSongId: songs.rdjSongId,
      artist: songs.artist,
      title: songs.title,
      album: songs.album,
      enabled: songs.enabled,
      songType: songs.songType,
      state: songs.lifecycleState,
      since: songs.lifecycleSince,
      poolId: categories.id,
      poolName: categories.name,
      restReviewDays: categories.restReviewDays,
      durationMs: sql<number | null>`coalesce(${songs.effectiveDurationMs}, ${songs.durationMs})`,
    })
    .from(songs)
    .leftJoin(songCategories, and(eq(songCategories.songId, songs.id), eq(songCategories.role, "primary")))
    .leftJoin(categories, eq(categories.id, songCategories.categoryId))
    .$dynamic();
}

async function withAirplay<T extends { id: string }>(stationId: string, rows: T[]) {
  const airplay = await airplayFor(stationId, rows.map((r) => r.id));
  return rows.map((r) => ({
    ...r,
    lastAiredAt: airplay.get(r.id)?.lastAiredAt ?? null,
    recentSpins: airplay.get(r.id)?.recentSpins ?? 0,
  }));
}

async function airplayFor(stationId: string, songIds: string[]) {
  if (songIds.length === 0) return new Map<string, { lastAiredAt: Date | null; recentSpins: number }>();
  const since = new Date(Date.now() - RECENT_SPINS_DAYS * 24 * HOUR_MS);
  const rows = await db
    .select({
      songId: playHistory.songId,
      lastAiredAt: sql<string | null>`max(${playHistory.airedAt})`,
      recentSpins: sql<number>`count(*) filter (where ${playHistory.airedAt} >= ${since.toISOString()})`,
    })
    .from(playHistory)
    .where(and(eq(playHistory.stationId, stationId), inArray(playHistory.songId, songIds)))
    .groupBy(playHistory.songId);
  return new Map(
    rows.map((r) => [
      r.songId!,
      // Raw aggregates bypass drizzle's column mapping and come back naive — UTC by convention.
      { lastAiredAt: r.lastAiredAt ? utcTimestamp(r.lastAiredAt) : null, recentSpins: Number(r.recentSpins) },
    ])
  );
}

export interface SongEvent {
  id: string;
  at: Date;
  fromState: string | null;
  toState: string;
  fromCategoryName: string | null;
  toCategoryName: string | null;
  source: string;
  /** The applied changeset behind a "changeset" event, for a link to it. */
  changesetId: string | null;
  reason: string;
}

export interface SongDetail {
  song: LibraryRow & { path: string | null; rdjSubcategoryId: number | null };
  alsoPools: { id: string; name: string }[];
  events: SongEvent[];
  plays: { airedAt: Date; source: string }[];
  spins30d: number;
  spinsTotal: number;
}

const PLAYS_SHOWN = 25;

export async function getSongDetail(stationId: string, songId: string): Promise<SongDetail | null> {
  const [row] = await db
    .select({
      id: songs.id,
      rdjSongId: songs.rdjSongId,
      artist: songs.artist,
      title: songs.title,
      album: songs.album,
      enabled: songs.enabled,
      songType: songs.songType,
      state: songs.lifecycleState,
      since: songs.lifecycleSince,
      path: songs.path,
      rdjSubcategoryId: songs.rdjSubcategoryId,
      poolId: categories.id,
      poolName: categories.name,
      restReviewDays: categories.restReviewDays,
      durationMs: sql<number | null>`coalesce(${songs.effectiveDurationMs}, ${songs.durationMs})`,
    })
    .from(songs)
    .leftJoin(songCategories, and(eq(songCategories.songId, songs.id), eq(songCategories.role, "primary")))
    .leftJoin(categories, eq(categories.id, songCategories.categoryId))
    .where(and(eq(songs.stationId, stationId), eq(songs.id, songId)));
  if (!row) return null;

  const since30 = new Date(Date.now() - 30 * 24 * HOUR_MS);
  const [alsoPools, eventRows, names, plays, [counts], airplay] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name })
      .from(songCategories)
      .innerJoin(categories, eq(categories.id, songCategories.categoryId))
      .where(and(eq(songCategories.songId, songId), eq(songCategories.role, "also")))
      .orderBy(asc(categories.name)),
    db
      .select({
        id: lifecycleEvents.id,
        at: lifecycleEvents.at,
        fromState: lifecycleEvents.fromState,
        toState: lifecycleEvents.toState,
        fromCategoryId: lifecycleEvents.fromCategoryId,
        toCategoryId: lifecycleEvents.toCategoryId,
        source: lifecycleEvents.source,
        sourceRef: lifecycleEvents.sourceRef,
        reason: lifecycleEvents.reason,
        changesetId: changesets.id,
      })
      .from(lifecycleEvents)
      // Only a ref that names one of this station's changesets becomes a link.
      .leftJoin(
        changesets,
        and(
          eq(lifecycleEvents.source, "changeset"),
          eq(sql`${changesets.id}::text`, lifecycleEvents.sourceRef),
          eq(changesets.stationId, stationId)
        )
      )
      .where(and(eq(lifecycleEvents.stationId, stationId), eq(lifecycleEvents.songId, songId)))
      .orderBy(desc(lifecycleEvents.at)),
    db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.stationId, stationId)),
    db
      .select({ airedAt: playHistory.airedAt, source: playHistory.source })
      .from(playHistory)
      .where(and(eq(playHistory.stationId, stationId), eq(playHistory.songId, songId)))
      .orderBy(desc(playHistory.airedAt))
      .limit(PLAYS_SHOWN),
    db
      .select({
        total: sql<number>`count(*)`,
        last30: sql<number>`count(*) filter (where ${playHistory.airedAt} >= ${since30.toISOString()})`,
      })
      .from(playHistory)
      .where(and(eq(playHistory.stationId, stationId), eq(playHistory.songId, songId))),
    airplayFor(stationId, [songId]),
  ]);
  const nameOf = new Map(names.map((c) => [c.id, c.name]));

  return {
    song: {
      ...row,
      lastAiredAt: airplay.get(songId)?.lastAiredAt ?? null,
      recentSpins: airplay.get(songId)?.recentSpins ?? 0,
    },
    alsoPools,
    events: eventRows.map((e) => ({
      id: e.id,
      at: e.at,
      fromState: e.fromState,
      toState: e.toState,
      fromCategoryName: e.fromCategoryId ? nameOf.get(e.fromCategoryId) ?? null : null,
      toCategoryName: e.toCategoryId ? nameOf.get(e.toCategoryId) ?? null : null,
      source: e.source,
      changesetId: e.changesetId,
      reason: e.reason,
    })),
    plays,
    spins30d: Number(counts?.last30 ?? 0),
    spinsTotal: Number(counts?.total ?? 0),
  };
}

export interface PoolLifecycleRow {
  id: string;
  name: string;
  group: string | null;
  restReviewDays: number | null;
  ladderRank: number | null;
  fallingAfterDays: number | null;
  restExitCategoryId: string | null;
  promoteAfterDays: number | null;
  promoteToCategoryId: string | null;
  benchAfterUnairedDays: number | null;
  resting: number;
  due: number;
  falling: number;
}

export interface RecentTransition {
  id: string;
  at: Date;
  songId: string;
  artist: string | null;
  title: string | null;
  fromState: string | null;
  toState: string;
  fromCategoryName: string | null;
  toCategoryName: string | null;
  changesetId: string | null;
  reason: string;
}

export interface LifecycleOverview {
  counts: Record<LifecycleState, number>;
  /** Every resting song, longest-rested first. */
  resting: LibraryRow[];
  /** Music pools, with their lifecycle settings and how many songs rest or fall in each. */
  standards: PoolLifecycleRow[];
  /** Active songs on the currents ladder that are falling, longest in their pool first. */
  falling: LibraryRow[];
  directions: Record<string, DirectionResult>;
  /** Transitions made in Rotavox (not the one-time import), newest first. */
  recent: RecentTransition[];
}

export const RECENT_TRANSITION_DAYS = 30;
const RECENT_TRANSITIONS_SHOWN = 100;

/** Past its pool's standard rest, so waiting on a decision (ADR-0002 §6.2). */
export function isRestDue(row: Pick<LibraryRow, "state" | "since" | "restReviewDays">, now = new Date()): boolean {
  return (
    row.state === "resting" &&
    row.restReviewDays != null &&
    row.since != null &&
    now.getTime() - row.since.getTime() >= row.restReviewDays * 86_400_000
  );
}

export async function getLifecycleOverview(stationId: string): Promise<LifecycleOverview> {
  const inventory = and(eq(songs.stationId, stationId), sql`${songs.rdjSongId} > 0`);
  const since = new Date(Date.now() - RECENT_TRANSITION_DAYS * 24 * HOUR_MS);
  const [countRows, restingRows, ladderRows, cats, events] = await Promise.all([
    db
      .select({ state: songs.lifecycleState, n: sql<number>`count(*)` })
      .from(songs)
      .where(inventory)
      .groupBy(songs.lifecycleState),
    songRows()
      .where(and(inventory, eq(songs.lifecycleState, "resting")))
      .orderBy(sql`${songs.lifecycleSince} asc nulls first`, asc(songs.artist), asc(songs.title)),
    songRows()
      .where(and(inventory, eq(songs.lifecycleState, "active"), sql`${categories.ladderRank} is not null`))
      .orderBy(asc(songs.artist), asc(songs.title)),
    db
      .select({
        id: categories.id,
        name: categories.name,
        kind: categories.kind,
        parentId: categories.parentId,
        restReviewDays: categories.restReviewDays,
        ladderRank: categories.ladderRank,
        fallingAfterDays: categories.fallingAfterDays,
        restExitCategoryId: categories.restExitCategoryId,
        promoteAfterDays: categories.promoteAfterDays,
        promoteToCategoryId: categories.promoteToCategoryId,
        benchAfterUnairedDays: categories.benchAfterUnairedDays,
      })
      .from(categories)
      .where(eq(categories.stationId, stationId)),
    db
      .select({
        id: lifecycleEvents.id,
        at: lifecycleEvents.at,
        songId: lifecycleEvents.songId,
        artist: songs.artist,
        title: songs.title,
        fromState: lifecycleEvents.fromState,
        toState: lifecycleEvents.toState,
        fromCategoryId: lifecycleEvents.fromCategoryId,
        toCategoryId: lifecycleEvents.toCategoryId,
        reason: lifecycleEvents.reason,
        changesetId: changesets.id,
      })
      .from(lifecycleEvents)
      .innerJoin(songs, eq(songs.id, lifecycleEvents.songId))
      .leftJoin(
        changesets,
        and(
          eq(lifecycleEvents.source, "changeset"),
          eq(sql`${changesets.id}::text`, lifecycleEvents.sourceRef),
          eq(changesets.stationId, stationId)
        )
      )
      .where(
        and(
          eq(lifecycleEvents.stationId, stationId),
          sql`${lifecycleEvents.source} <> 'import'`,
          sql`${lifecycleEvents.at} >= ${since.toISOString()}`
        )
      )
      .orderBy(desc(lifecycleEvents.at))
      .limit(RECENT_TRANSITIONS_SHOWN),
  ]);

  const counts = Object.fromEntries(LIFECYCLE_STATES.map((s) => [s, 0])) as Record<LifecycleState, number>;
  for (const r of countRows) if (r.state in counts) counts[r.state as LifecycleState] = Number(r.n);

  const resting = await withAirplay(stationId, restingRows);
  const directions = await directionsFor(stationId, ladderRows);
  const falling = (await withAirplay(stationId, ladderRows.filter((r) => directions[r.id]?.direction === "falling"))).sort(
    (a, b) => directions[b.id].days - directions[a.id].days
  );
  const now = new Date();
  const nameOf = new Map(cats.map((c) => [c.id, c.name]));
  const parents = new Set(cats.map((c) => c.parentId).filter(Boolean));
  const standards = cats
    .filter((c) => c.kind === "music" && !parents.has(c.id))
    .map((c) => {
      const from = resting.filter((r) => r.poolId === c.id);
      return {
        id: c.id,
        name: c.name,
        group: c.parentId ? nameOf.get(c.parentId) ?? null : null,
        restReviewDays: c.restReviewDays,
        ladderRank: c.ladderRank,
        fallingAfterDays: c.fallingAfterDays,
        restExitCategoryId: c.restExitCategoryId,
        promoteAfterDays: c.promoteAfterDays,
        promoteToCategoryId: c.promoteToCategoryId,
        benchAfterUnairedDays: c.benchAfterUnairedDays,
        resting: from.length,
        due: from.filter((r) => isRestDue(r, now)).length,
        falling: falling.filter((r) => r.poolId === c.id).length,
      };
    })
    // The ladder first, hottest first, then the rest as the Categories page orders them.
    .sort(
      (a, b) =>
        (a.ladderRank ?? Infinity) - (b.ladderRank ?? Infinity) ||
        (a.group ?? a.name).localeCompare(b.group ?? b.name) ||
        a.name.localeCompare(b.name)
    );

  return {
    counts,
    resting,
    standards,
    falling,
    directions,
    recent: events.map((e) => ({
      id: e.id,
      at: e.at,
      songId: e.songId,
      artist: e.artist,
      title: e.title,
      fromState: e.fromState,
      toState: e.toState,
      fromCategoryName: e.fromCategoryId ? nameOf.get(e.fromCategoryId) ?? null : null,
      toCategoryName: e.toCategoryId ? nameOf.get(e.toCategoryId) ?? null : null,
      changesetId: e.changesetId,
      reason: e.reason,
    })),
  };
}
