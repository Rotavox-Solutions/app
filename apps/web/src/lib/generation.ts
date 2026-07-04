// Log generation, moved here from apps/runner/src/generate-log.ts (M4a plan,
// Decision 1) — this is now the single place that creates `logs`/`log_items` rows.
// apps/runner keeps its other direct Postgres writes (pushed_at, aired_at,
// play_history, sync_state) until M4.5; only generation moved this milestone.
import { createHash } from "node:crypto";
import { and, desc, eq, gt, gte, lt, sql } from "drizzle-orm";
import {
  categories,
  clockPositions,
  clocks,
  formatGrid,
  logItems,
  logs,
  playHistory,
  rules,
  songCategories,
  songs,
  stations,
} from "@rotavox/schema";
import {
  ENGINE_VERSION,
  generateLog,
  type EngineClock,
  type EngineSong,
  type GenerateLogInput,
  type GenerateLogResult,
} from "@rotavox/engine";
import { db } from "./db";
import { HOUR_MS } from "./constants";

export class HorizonConflictError extends Error {
  conflictingLogId: string;
  constructor(conflictingLogId: string) {
    super(`Requested horizon overlaps existing log ${conflictingLogId}`);
    this.name = "HorizonConflictError";
    this.conflictingLogId = conflictingLogId;
  }
}

export interface GenerateNextHoursResult {
  logId: string;
  itemCount: number;
  warnings: string[];
  stats: GenerateLogResult["stats"];
}

/** Next hour-aligned instant at or after `now` — same rounding the old script used. */
function hourAlignUp(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / HOUR_MS) * HOUR_MS);
}

/** max(now, latest existing log's ends_at for this station), hour-aligned up. */
async function computeHorizonStart(stationId: string): Promise<Date> {
  // ORDER BY ... LIMIT 1 instead of a raw max() aggregate: a raw SQL aggregate
  // result bypasses Drizzle's normal per-column timestamp parser and comes back
  // as a bare string, which a manual `new Date(str)` then misreads as local time
  // instead of UTC for a `timestamp` (no-tz) column — this way the value is
  // read through the exact same typed path as every other query in this file.
  const [row] = await db
    .select({ endsAt: logs.endsAt })
    .from(logs)
    .where(eq(logs.stationId, stationId))
    .orderBy(desc(logs.endsAt))
    .limit(1);
  const latestEndsAt = row?.endsAt ?? null;
  const now = new Date();
  const base = latestEndsAt && latestEndsAt.getTime() > now.getTime() ? latestEndsAt : now;
  return hourAlignUp(base);
}

export async function loadGenerationInputs(
  stationId: string,
  horizonStart: Date,
  horizonEnd: Date
): Promise<{ input: GenerateLogInput; stationName: string }> {
  const [station] = await db.select().from(stations).where(eq(stations.id, stationId));
  if (!station) throw new Error(`No stations row for station ${stationId}`);

  const catRows = await db.select().from(categories).where(eq(categories.stationId, stationId));
  const songRows = await db.select().from(songs).where(eq(songs.stationId, stationId));
  const membershipRows = await db
    .select({ songId: songCategories.songId, categoryId: songCategories.categoryId })
    .from(songCategories)
    .innerJoin(categories, eq(categories.id, songCategories.categoryId))
    .where(eq(categories.stationId, stationId));
  const clockRows = await db.select().from(clocks).where(eq(clocks.stationId, stationId));
  const positionRows = await db
    .select()
    .from(clockPositions)
    .innerJoin(clocks, eq(clocks.id, clockPositions.clockId))
    .where(eq(clocks.stationId, stationId));
  const gridRows = await db.select().from(formatGrid).where(eq(formatGrid.stationId, stationId));
  const ruleRows = await db.select().from(rules).where(eq(rules.stationId, stationId));

  const lookbackStart = new Date(horizonStart.getTime() - 48 * HOUR_MS);
  const historyRows = await db
    .select({
      rdjSongId: playHistory.rdjSongId,
      artist: playHistory.artist,
      airedAt: playHistory.airedAt,
      title: songs.title,
      album: songs.album,
    })
    .from(playHistory)
    .leftJoin(songs, eq(songs.id, playHistory.songId))
    .where(and(eq(playHistory.stationId, stationId), gte(playHistory.airedAt, lookbackStart)));

  const categoryIdsBySong = new Map<string, string[]>();
  for (const m of membershipRows) {
    const list = categoryIdsBySong.get(m.songId) ?? [];
    list.push(m.categoryId);
    categoryIdsBySong.set(m.songId, list);
  }

  const engineSongs: EngineSong[] = songRows.map((s) => ({
    id: s.id,
    rdjSongId: s.rdjSongId,
    artist: s.artist,
    title: s.title,
    album: s.album,
    durationMs: s.durationMs,
    songType: s.songType,
    categoryIds: categoryIdsBySong.get(s.id) ?? [],
    era: s.era,
    tempo: s.tempo,
    energy: s.energy,
    mood: s.mood,
    soundCodes: s.soundCodes,
    targetTurnoverHours: s.targetTurnoverHours,
    enabled: s.enabled,
  }));

  const engineClocks: EngineClock[] = clockRows.map((c) => ({
    id: c.id,
    name: c.name,
    positions: positionRows
      .filter((row) => row.clock_positions.clockId === c.id)
      .map((row) => ({
        id: row.clock_positions.id,
        sortOrder: row.clock_positions.sortOrder,
        positionType: row.clock_positions.positionType as EngineClock["positions"][number]["positionType"],
        categoryId: row.clock_positions.categoryId,
        targetOffsetSeconds: row.clock_positions.targetOffsetSeconds,
        constraints: row.clock_positions.constraints as EngineClock["positions"][number]["constraints"],
        fixedRef: row.clock_positions.fixedRef,
      })),
  }));

  const input: GenerateLogInput = {
    timezone: station.timezone,
    horizonStart,
    horizonEnd,
    seed: "", // set by the caller
    clocks: engineClocks,
    grid: gridRows.map((g) => ({ dayOfWeek: g.dayOfWeek, hour: g.hour, clockId: g.clockId })),
    categories: catRows.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      parentId: c.parentId,
      defaultTargetTurnoverHours: c.defaultTargetTurnoverHours,
    })),
    songs: engineSongs,
    rules: ruleRows.map((r) => ({
      id: r.id,
      scope: r.scope as "global" | "category" | "position",
      scopeRef: r.scopeRef,
      ruleType: r.ruleType,
      params: r.params as Record<string, unknown> | null,
      hardness: r.hardness as "hard" | "soft",
      weight: r.weight,
    })),
    history: historyRows.map((h) => ({
      rdjSongId: h.rdjSongId,
      artist: h.artist,
      title: h.title,
      airedAt: h.airedAt,
    })),
  };

  return { input, stationName: station.name };
}

/** Idempotency guard + transactional insert. Throws HorizonConflictError on overlap. */
async function persistGeneratedLog(
  stationId: string,
  horizonStart: Date,
  horizonEnd: Date,
  seed: string,
  result: GenerateLogResult
): Promise<string> {
  return db.transaction(async (tx) => {
    const [conflict] = await tx
      .select({ id: logs.id })
      .from(logs)
      .where(and(eq(logs.stationId, stationId), lt(logs.startsAt, horizonEnd), gt(logs.endsAt, horizonStart)));
    if (conflict) throw new HorizonConflictError(conflict.id);

    const [logRow] = await tx
      .insert(logs)
      .values({
        stationId,
        startsAt: horizonStart,
        endsAt: horizonEnd,
        status: "draft",
        generatedAt: new Date(),
        generatorVersion: ENGINE_VERSION,
        seed,
      })
      .returning({ id: logs.id });

    for (let i = 0; i < result.items.length; i += 500) {
      const chunk = result.items.slice(i, i + 500);
      await tx.insert(logItems).values(
        chunk.map((item) => ({
          logId: logRow.id,
          sortOrder: item.sortOrder,
          projectedAirAt: item.projectedAirAt,
          elementType: item.elementType,
          songId: item.songId,
          rdjSongId: item.rdjSongId,
          clockPositionId: item.clockPositionId,
          violations: item.violations.length > 0 ? item.violations : null,
        }))
      );
    }

    // Scheduling state (spec §5): bump last_scheduled_at / times_scheduled.
    const lastAirBySong = new Map<string, { at: Date; count: number }>();
    for (const item of result.items) {
      if (!item.songId) continue;
      const prev = lastAirBySong.get(item.songId);
      lastAirBySong.set(item.songId, {
        at: prev && prev.at > item.projectedAirAt ? prev.at : item.projectedAirAt,
        count: (prev?.count ?? 0) + 1,
      });
    }
    for (const [songId, info] of lastAirBySong) {
      await tx
        .update(songs)
        .set({
          lastScheduledAt: info.at,
          timesScheduled: sql`coalesce(${songs.timesScheduled}, 0) + ${info.count}`,
        })
        .where(eq(songs.id, songId));
    }

    return logRow.id;
  });
}

export async function generateNextHours(
  stationId: string,
  hours: number = 24,
  opts?: { start?: Date }
): Promise<GenerateNextHoursResult> {
  const horizonStart = opts?.start ?? (await computeHorizonStart(stationId));
  const horizonEnd = new Date(horizonStart.getTime() + hours * HOUR_MS);
  const seed = createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 12);

  const { input } = await loadGenerationInputs(stationId, horizonStart, horizonEnd);
  input.seed = seed;

  const result = generateLog(input);
  const logId = await persistGeneratedLog(stationId, horizonStart, horizonEnd, seed, result);

  return { logId, itemCount: result.items.length, warnings: result.warnings, stats: result.stats };
}
