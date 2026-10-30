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
  type LifecycleState,
} from "@rotavox/schema";
import { db } from "./db";
import { HOUR_MS } from "./constants";
import { RECENT_SPINS_DAYS } from "./queries";

export const LIBRARY_PAGE_SIZE = 100;

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
  const page = Number(one("page"));
  return {
    q: one("q"),
    state: LIFECYCLE_STATES.includes(state as LifecycleState) ? (state as LifecycleState) : undefined,
    pool: one("pool"),
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

  const base = db
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
    .where(and(...where));

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

  const airplay = await airplayFor(stationId, rows.map((r) => r.id));
  return {
    rows: rows.map((r) => ({
      ...r,
      lastAiredAt: airplay.get(r.id)?.lastAiredAt ?? null,
      recentSpins: airplay.get(r.id)?.recentSpins ?? 0,
    })),
    total,
    page,
    pageCount,
  };
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
