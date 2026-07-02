// M2 generation script: loads the mirror + scheduling config from Postgres, runs the
// pure engine, persists the draft log, and dumps it for inspection.
//
// NOTE: in the target architecture generation belongs to apps/web (the SaaS); it
// lives in the runner for M2 only because this is the package already wired to
// Postgres. It touches nothing RadioDJ-side.
import "dotenv/config";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { and, eq, gte, sql } from "drizzle-orm";
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
  type GeneratedItem,
} from "@rotavox/engine";
import { schedulerDb, pgClient, stationId } from "./scheduler-db.js";

const HOUR_MS = 3_600_000;

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const hours = Number(arg("hours") ?? 24);
  const startArg = arg("start");
  const horizonStart = startArg
    ? new Date(startArg)
    : new Date(Math.ceil(Date.now() / HOUR_MS) * HOUR_MS); // next top of hour
  const horizonEnd = new Date(horizonStart.getTime() + hours * HOUR_MS);
  const seed = arg("seed") ?? createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 12);
  const outPath = arg("out");

  const [station] = await schedulerDb.select().from(stations).where(eq(stations.id, stationId));
  if (!station) throw new Error(`No stations row for SCHEDULER_STATION_ID=${stationId}`);

  const catRows = await schedulerDb.select().from(categories).where(eq(categories.stationId, stationId));
  const songRows = await schedulerDb.select().from(songs).where(eq(songs.stationId, stationId));
  const membershipRows = await schedulerDb
    .select({ songId: songCategories.songId, categoryId: songCategories.categoryId })
    .from(songCategories)
    .innerJoin(categories, eq(categories.id, songCategories.categoryId))
    .where(eq(categories.stationId, stationId));
  const clockRows = await schedulerDb.select().from(clocks).where(eq(clocks.stationId, stationId));
  const positionRows = await schedulerDb
    .select()
    .from(clockPositions)
    .innerJoin(clocks, eq(clocks.id, clockPositions.clockId))
    .where(eq(clocks.stationId, stationId));
  const gridRows = await schedulerDb.select().from(formatGrid).where(eq(formatGrid.stationId, stationId));
  const ruleRows = await schedulerDb.select().from(rules).where(eq(rules.stationId, stationId));

  const lookbackStart = new Date(horizonStart.getTime() - 48 * HOUR_MS);
  const historyRows = await schedulerDb
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
    seed,
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

  console.log(
    `Generating ${hours}h log for "${station.name}" from ${horizonStart.toISOString()} (seed=${seed}, engine=${ENGINE_VERSION})`
  );
  console.log(
    `Inputs: ${engineSongs.length} songs, ${historyRows.length} history rows (48h lookback), ${input.rules.length} rules`
  );

  const result = generateLog(input);

  // Persist: draft log + items in one transaction.
  const logId = await schedulerDb.transaction(async (tx) => {
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
    return logRow.id;
  });

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
    await schedulerDb
      .update(songs)
      .set({
        lastScheduledAt: info.at,
        timesScheduled: sql`coalesce(${songs.timesScheduled}, 0) + ${info.count}`,
      })
      .where(eq(songs.id, songId));
  }

  // ── Dump ──────────────────────────────────────────────────────────────────
  const songByRdjId = new Map(engineSongs.map((s) => [s.rdjSongId, s]));
  const categoryNameByPosition = new Map<string, string>();
  const catNameById = new Map(catRows.map((c) => [c.id, c.name]));
  for (const row of positionRows) {
    categoryNameByPosition.set(
      row.clock_positions.id,
      row.clock_positions.categoryId ? catNameById.get(row.clock_positions.categoryId) ?? "?" : "(fixed)"
    );
  }

  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: station.timezone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const lines: string[] = [];
  for (const item of result.items) {
    const song = item.rdjSongId != null ? songByRdjId.get(item.rdjSongId) : undefined;
    const cat = item.clockPositionId ? categoryNameByPosition.get(item.clockPositionId) : "?";
    const label = song ? `${song.artist} — ${song.title}` : "(unfilled)";
    const flags = item.violations.length > 0 ? `  [${item.violations.map((v) => v.step).join(",")}]` : "";
    lines.push(
      `${timeFmt.format(item.projectedAirAt)}  ${item.elementType.padEnd(11)} ${String(cat).padEnd(11)} ${label}${flags}`
    );
  }
  console.log(lines.join("\n"));

  // ── Stats ─────────────────────────────────────────────────────────────────
  const artistTimes = new Map<string, number[]>();
  for (const item of result.items) {
    const song = item.rdjSongId != null ? songByRdjId.get(item.rdjSongId) : undefined;
    if (item.elementType !== "music" || !song?.artist) continue;
    const list = artistTimes.get(song.artist.toLowerCase()) ?? [];
    list.push(item.projectedAirAt.getTime());
    artistTimes.set(song.artist.toLowerCase(), list);
  }
  const gaps: number[] = [];
  for (const [, times] of artistTimes) {
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / 60_000);
  }
  gaps.sort((a, b) => a - b);

  const hash = createHash("sha256")
    .update(JSON.stringify(result.items.map((i: GeneratedItem) => [i.sortOrder, i.rdjSongId])))
    .digest("hex")
    .slice(0, 16);

  console.log(`\n— Summary —`);
  console.log(`log id: ${logId}  items: ${result.items.length}  content hash: ${hash}`);
  console.log(`violations: ${JSON.stringify(result.stats.violationCounts)}  unfillable: ${result.stats.unfillable}`);
  console.log(
    `artist gaps (music, within log): min=${gaps[0]?.toFixed(1) ?? "n/a"}min  median=${
      gaps[Math.floor(gaps.length / 2)]?.toFixed(1) ?? "n/a"
    }min  pairs=${gaps.length}`
  );
  if (result.warnings.length > 0) {
    console.log(`warnings (${result.warnings.length}):`);
    for (const w of result.warnings.slice(0, 10)) console.log(`  - ${w}`);
    if (result.warnings.length > 10) console.log(`  ... and ${result.warnings.length - 10} more`);
  }

  if (outPath) {
    writeFileSync(outPath, JSON.stringify({ logId, seed, hash, items: result.items, stats: result.stats }, null, 2));
    console.log(`full dump written to ${outPath}`);
  }

  await pgClient.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
