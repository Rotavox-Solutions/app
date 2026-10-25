// Read-only query functions — the single source of truth for both Server
// Components (called directly, no HTTP round-trip) and GET route handlers.
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  categories,
  clockPositions,
  clocks,
  formatGrid,
  logItems,
  logs,
  playHistory,
  songCategories,
  songs,
  stations,
  utcTimestamp,
} from "@rotavox/schema";
import { db } from "./db";
import { canEditItem, deriveDisplayStatus, type DisplayStatus, type EditRejectReason, type LogRow } from "./log-edits";
import { HOUR_MS } from "./constants";
import { computeBalance, type BalanceInput, type CategoryBalance } from "./balance";

export interface LogListRow {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: DisplayStatus;
  generatedAt: Date | null;
  itemCount: number;
  violationCount: number;
}

export async function listLogs(stationId: string): Promise<LogListRow[]> {
  const logRows = await db.select().from(logs).where(eq(logs.stationId, stationId)).orderBy(desc(logs.startsAt));

  const countRows = await db
    .select({
      logId: logItems.logId,
      itemCount: sql<number>`count(*)`,
      violationCount: sql<number>`count(*) filter (where ${logItems.violations} is not null)`,
    })
    .from(logItems)
    .innerJoin(logs, eq(logs.id, logItems.logId))
    .where(eq(logs.stationId, stationId))
    .groupBy(logItems.logId);
  const countsByLog = new Map(countRows.map((r) => [r.logId, r]));

  const now = new Date();
  return logRows.map((log) => {
    const counts = countsByLog.get(log.id);
    return {
      id: log.id,
      startsAt: log.startsAt,
      endsAt: log.endsAt,
      status: deriveDisplayStatus(log, now),
      generatedAt: log.generatedAt,
      itemCount: counts ? Number(counts.itemCount) : 0,
      violationCount: counts ? Number(counts.violationCount) : 0,
    };
  });
}

export interface LogItemDetail {
  id: string;
  sortOrder: number;
  projectedAirAt: Date | null;
  elementType: string;
  songId: string | null;
  rdjSongId: number | null;
  artist: string | null;
  title: string | null;
  categoryId: string | null;
  categoryName: string | null;
  targetOffsetSeconds: number | null;
  violations: unknown;
  pushedAt: Date | null;
  airedAt: Date | null;
  locked: boolean;
  editable: boolean;
  editReason: EditRejectReason | null;
}

export interface LogDetail {
  log: LogRow;
  displayStatus: DisplayStatus;
  items: LogItemDetail[];
}

export async function getLogDetail(logId: string): Promise<LogDetail | null> {
  const [log] = await db.select().from(logs).where(eq(logs.id, logId));
  if (!log) return null;

  const rows = await db
    .select({
      item: logItems,
      songArtist: songs.artist,
      songTitle: songs.title,
      categoryId: clockPositions.categoryId,
      categoryName: categories.name,
      targetOffsetSeconds: clockPositions.targetOffsetSeconds,
    })
    .from(logItems)
    .leftJoin(songs, eq(songs.id, logItems.songId))
    .leftJoin(clockPositions, eq(clockPositions.id, logItems.clockPositionId))
    .leftJoin(categories, eq(categories.id, clockPositions.categoryId))
    .where(eq(logItems.logId, logId))
    .orderBy(asc(logItems.sortOrder));

  const now = new Date();
  const items: LogItemDetail[] = rows.map((r) => {
    const check = canEditItem(r.item, now);
    return {
      id: r.item.id,
      sortOrder: r.item.sortOrder,
      projectedAirAt: r.item.projectedAirAt,
      elementType: r.item.elementType,
      songId: r.item.songId,
      rdjSongId: r.item.rdjSongId,
      artist: r.songArtist,
      title: r.songTitle,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      targetOffsetSeconds: r.targetOffsetSeconds,
      violations: r.item.violations,
      pushedAt: r.item.pushedAt,
      airedAt: r.item.airedAt,
      locked: r.item.locked,
      editable: check.ok,
      editReason: check.ok ? null : check.reason,
    };
  });

  return { log, displayStatus: deriveDisplayStatus(log, now), items };
}

export interface SongSearchResult {
  id: string;
  rdjSongId: number;
  artist: string | null;
  title: string | null;
  album: string | null;
}

/** Replace's song picker — scoped to categoryId by default; omitting it is the explicit override path. */
export async function searchSongs(
  stationId: string,
  opts: { categoryId?: string; q?: string }
): Promise<SongSearchResult[]> {
  const conditions = [eq(songs.stationId, stationId)];
  if (opts.q) {
    const pattern = `%${opts.q}%`;
    conditions.push(sql`(${songs.artist} ilike ${pattern} or ${songs.title} ilike ${pattern})`);
  }

  const cols = { id: songs.id, rdjSongId: songs.rdjSongId, artist: songs.artist, title: songs.title, album: songs.album };

  if (opts.categoryId) {
    return db
      .select(cols)
      .from(songs)
      .innerJoin(songCategories, eq(songCategories.songId, songs.id))
      .where(and(...conditions, eq(songCategories.categoryId, opts.categoryId)))
      .limit(50);
  }

  return db.select(cols).from(songs).where(and(...conditions)).limit(50);
}

export interface AsRunRow {
  logId: string;
  hour: Date;
  projectedAirAt: Date | null;
  airedAt: Date | null;
  deltaSeconds: number | null;
  rdjSongId: number | null;
  artist: string | null;
  title: string | null;
}

/**
 * Per-hour legal-ID/TOH report — one row per item whose clock position has
 * target_offset_seconds = 0, reusing apps/runner/src/cursor.ts's isTohLocked
 * definition rather than inventing a new one. Reporting only (M4a plan,
 * Decision 8) — no compliance guarantee, that's M5.
 */
export async function getAsRunReport(stationId: string, opts?: { from?: Date; to?: Date }): Promise<AsRunRow[]> {
  const conditions = [eq(logs.stationId, stationId), eq(clockPositions.targetOffsetSeconds, 0)];
  if (opts?.from) conditions.push(gte(logItems.projectedAirAt, opts.from));
  if (opts?.to) conditions.push(lte(logItems.projectedAirAt, opts.to));

  const rows = await db
    .select({
      logId: logItems.logId,
      projectedAirAt: logItems.projectedAirAt,
      airedAt: logItems.airedAt,
      rdjSongId: logItems.rdjSongId,
      artist: songs.artist,
      title: songs.title,
    })
    .from(logItems)
    .innerJoin(logs, eq(logs.id, logItems.logId))
    .innerJoin(clockPositions, eq(clockPositions.id, logItems.clockPositionId))
    .leftJoin(songs, eq(songs.id, logItems.songId))
    .where(and(...conditions))
    .orderBy(asc(logItems.projectedAirAt));

  return rows.map((r) => ({
    logId: r.logId,
    hour: r.projectedAirAt ? new Date(Math.floor(r.projectedAirAt.getTime() / HOUR_MS) * HOUR_MS) : new Date(0),
    projectedAirAt: r.projectedAirAt,
    airedAt: r.airedAt,
    deltaSeconds:
      r.projectedAirAt && r.airedAt ? Math.round((r.airedAt.getTime() - r.projectedAirAt.getTime()) / 1000) : null,
    rdjSongId: r.rdjSongId,
    artist: r.artist,
    title: r.title,
  }));
}

/** Window for "recent" spins on the Music screens — one full week of every daypart. */
export const RECENT_SPINS_DAYS = 7;

async function recentSpinsBySong(stationId: string, since: Date): Promise<Map<string, number>> {
  const rows = await db
    .select({ songId: playHistory.songId, spins: sql<number>`count(*)` })
    .from(playHistory)
    .where(and(eq(playHistory.stationId, stationId), gte(playHistory.airedAt, since)))
    .groupBy(playHistory.songId);
  return new Map(rows.filter((r) => r.songId).map((r) => [r.songId!, Number(r.spins)]));
}

export async function getCategoryBalance(stationId: string): Promise<CategoryBalance[]> {
  const input = await loadBalanceInput(stationId);
  return input ? computeBalance(input) : [];
}

/** Everything the balance arithmetic reads, so a caller can compute it for a what-if too. */
export async function loadBalanceInput(stationId: string): Promise<BalanceInput | null> {
  const [station] = await db.select().from(stations).where(eq(stations.id, stationId));
  if (!station) return null;

  const [catRows, memberRows, positionRows, gridRows, spins] = await Promise.all([
    db.select().from(categories).where(eq(categories.stationId, stationId)).orderBy(asc(categories.name)),
    db
      .select({
        songId: songCategories.songId,
        categoryId: songCategories.categoryId,
        enabled: songs.enabled,
        role: songCategories.role,
        lifecycleState: songs.lifecycleState,
        lifecycleSince: songs.lifecycleSince,
      })
      .from(songCategories)
      .innerJoin(songs, eq(songs.id, songCategories.songId))
      .where(eq(songs.stationId, stationId)),
    db
      .select({
        clockId: clockPositions.clockId,
        categoryId: clockPositions.categoryId,
        fallbackCategoryId: sql<string | null>`${clockPositions.constraints}->>'fallbackCategoryId'`,
        fillerPriority: sql<number | null>`(${clockPositions.constraints}->>'fillerPriority')::int`,
      })
      .from(clockPositions)
      .innerJoin(clocks, eq(clocks.id, clockPositions.clockId))
      .where(eq(clocks.stationId, stationId)),
    db.select({ clockId: formatGrid.clockId }).from(formatGrid).where(eq(formatGrid.stationId, stationId)),
    recentSpinsBySong(stationId, new Date(Date.now() - RECENT_SPINS_DAYS * 24 * HOUR_MS)),
  ]);

  return {
    categories: catRows,
    memberships: memberRows,
    positions: positionRows,
    grid: gridRows,
    cycleWeeks: station.formatCycleWeeks ?? 1,
    recentSpinsBySong: spins,
  };
}

export interface PoolSongRow {
  id: string;
  rdjSongId: number;
  artist: string | null;
  title: string | null;
  enabled: boolean | null;
  lifecycleState: string;
  lifecycleSince: Date | null;
  role: string;
  durationMs: number | null;
  lastAiredAt: Date | null;
  recentSpins: number;
}

/** Songs that sit directly in a category (not its sub-pools — those have their own pages). */
export async function getPoolSongs(stationId: string, categoryId: string): Promise<PoolSongRow[]> {
  const since = new Date(Date.now() - RECENT_SPINS_DAYS * 24 * HOUR_MS);
  const rows = await db
    .select({
      id: songs.id,
      rdjSongId: songs.rdjSongId,
      artist: songs.artist,
      title: songs.title,
      enabled: songs.enabled,
      lifecycleState: songs.lifecycleState,
      lifecycleSince: songs.lifecycleSince,
      role: songCategories.role,
      durationMs: sql<number | null>`coalesce(${songs.effectiveDurationMs}, ${songs.durationMs})`,
      lastAiredAt: sql<string | null>`max(${playHistory.airedAt})`,
      recentSpins: sql<number>`count(${playHistory.id}) filter (where ${playHistory.airedAt} >= ${since.toISOString()})`,
    })
    .from(songCategories)
    .innerJoin(songs, eq(songs.id, songCategories.songId))
    .leftJoin(playHistory, and(eq(playHistory.songId, songs.id), eq(playHistory.stationId, stationId)))
    .where(and(eq(songCategories.categoryId, categoryId), eq(songs.stationId, stationId)))
    .groupBy(songs.id, songCategories.role)
    .orderBy(asc(songs.artist), asc(songs.title));

  return rows.map((r) => ({
    ...r,
    // Raw aggregates bypass drizzle's column mapping and come back naive — UTC by convention.
    lastAiredAt: r.lastAiredAt ? utcTimestamp(r.lastAiredAt) : null,
    recentSpins: Number(r.recentSpins),
  }));
}

export interface TodaySummary {
  stationName: string;
  timezone: string;
  airing: LogListRow | null;
  /** End of the contiguous approved run starting from now; null if nothing is approved for now. */
  approvedThrough: Date | null;
  drafts: LogListRow[];
  lastReconciledAt: Date | null;
  assumeLogAired: boolean;
}

export async function getTodaySummary(stationId: string): Promise<TodaySummary | null> {
  const [station] = await db.select().from(stations).where(eq(stations.id, stationId));
  if (!station) return null;

  const all = await listLogs(stationId);
  const now = new Date();
  const airing = all.find((l) => l.status === "airing") ?? null;

  // Walk forward through approved logs while they abut — a gap is where air goes unscheduled.
  const approved = all
    .filter((l) => l.status === "approved" || l.status === "airing")
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  let approvedThrough: Date | null = airing ? airing.endsAt : null;
  if (approvedThrough) {
    for (const l of approved) {
      if (l.startsAt.getTime() <= approvedThrough.getTime() && l.endsAt > approvedThrough) approvedThrough = l.endsAt;
    }
  }

  const [last] = await db
    .select({ at: sql<string | null>`max(${playHistory.airedAt})` })
    .from(playHistory)
    .where(and(eq(playHistory.stationId, stationId), eq(playHistory.source, "reconciled")));

  return {
    stationName: station.name,
    timezone: station.timezone,
    airing,
    approvedThrough,
    drafts: all.filter((l) => l.status === "draft" && l.endsAt > now),
    lastReconciledAt: last?.at ? utcTimestamp(last.at) : null,
    assumeLogAired: station.assumeLogAired,
  };
}
