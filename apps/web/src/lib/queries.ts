// Read-only query functions — the single source of truth for both Server
// Components (called directly, no HTTP round-trip) and GET route handlers.
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { categories, clockPositions, logItems, logs, songCategories, songs } from "@rotavox/schema";
import { db } from "./db";
import { canEditItem, deriveDisplayStatus, type DisplayStatus, type EditRejectReason, type LogRow } from "./log-edits";
import { HOUR_MS } from "./constants";

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
