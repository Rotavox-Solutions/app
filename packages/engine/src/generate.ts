import type {
  ElementType,
  EngineCategory,
  EngineConfig,
  EngineSong,
  GeneratedItem,
  GenerateLogInput,
  GenerateLogResult,
  PositionType,
} from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import { createRng } from "./rng.js";
import { assertHourAligned, iterateHours, localParts, weekInCycle } from "./time.js";
import { SeparationState } from "./separation.js";
import { ancestry, buildCategoryIndex, buildStationConstraints, resolveRules, subtree } from "./rules.js";
import { basePool } from "./candidates.js";
import { buildRungs, fillPosition } from "./ladder.js";

const ELEMENT_TYPE: Record<PositionType, ElementType> = {
  category: "music",
  sweeper: "sweeper",
  voicetrack: "voicetrack",
  fixed_event: "fixed_event",
};

function targetTurnoverFor(
  song: EngineSong,
  poolAncestryIds: string[],
  categoryIndex: Map<string, EngineCategory>,
  config: EngineConfig
): number {
  if (song.targetTurnoverHours != null) return song.targetTurnoverHours;
  for (const catId of poolAncestryIds) {
    const def = categoryIndex.get(catId)?.defaultTargetTurnoverHours;
    if (def != null) return def;
  }
  return config.defaultTurnoverHours;
}

export function generateLog(input: GenerateLogInput): GenerateLogResult {
  const config: EngineConfig = {
    ...DEFAULT_CONFIG,
    ...input.config,
    weights: { ...DEFAULT_CONFIG.weights, ...input.config?.weights },
  };
  assertHourAligned(input.horizonStart, "horizonStart");
  assertHourAligned(input.horizonEnd, "horizonEnd");

  const rng = createRng(input.seed);
  const sep = new SeparationState(input.history);
  const categoryIndex = buildCategoryIndex(input.categories);
  const station = buildStationConstraints(input.rules, input.categories);

  const clockById = new Map(input.clocks.map((c) => [c.id, c]));
  // Grid is keyed by (week-in-cycle, dow, hour). A static weekly grid leaves every
  // cell at week 0, and with cycleWeeks≤1 every hour resolves to week 0 — identical
  // to the pre-rotation lookup.
  const cycleWeeks = input.cycleWeeks ?? 1;
  const cycleEpoch = input.cycleEpoch ?? null;
  const gridMap = new Map<string, string>();
  for (const slot of input.grid) {
    gridMap.set(`${slot.weekInCycle ?? 0}|${slot.dayOfWeek}|${slot.hour}`, slot.clockId);
  }

  // Pool + rung caches are keyed per position id — static across hours.
  const poolCache = new Map<string, { pool: EngineSong[]; fallback: EngineSong[] | null }>();

  const items: GeneratedItem[] = [];
  const warnings: string[] = [];
  const violationCounts: Record<string, number> = {};
  let unfillable = 0;

  const hourCounts = new Map<string, number>(); // `${localHourKey}|${categoryId}` → placed
  const recentMusic: EngineSong[] = []; // last 3 music items for era/flow context

  let sortOrder = 0;
  let trimmed = 0;

  for (const hourStart of iterateHours(input.horizonStart, input.horizonEnd)) {
    // Each hour is independent: a hard top-of-hour re-sync (no spill-forward). A
    // clock whose content overruns is trimmed from the tail (below); a clock that
    // underruns simply leaves the hour short. Either way the next hour starts at :00.
    let running = hourStart.getTime();

    const { dayOfWeek, hour } = localParts(hourStart, input.timezone);
    const wic = cycleEpoch ? weekInCycle(hourStart, cycleEpoch, cycleWeeks, input.timezone) : 0;
    const clockId = gridMap.get(`${wic}|${dayOfWeek}|${hour}`);
    const clock = clockId ? clockById.get(clockId) : undefined;
    if (!clock) {
      warnings.push(`no clock mapped for local week=${wic} dow=${dayOfWeek} hour=${hour} (${hourStart.toISOString()}) — hour skipped`);
      continue;
    }

    const clockEnd = hourStart.getTime() + (clock.lengthMinutes ?? 60) * 60_000;
    const sortedPositions = [...clock.positions].sort((a, b) => a.sortOrder - b.sortOrder);
    for (let pi = 0; pi < sortedPositions.length; pi++) {
      const position = sortedPositions[pi];
      if (position.targetOffsetSeconds != null) {
        running = Math.max(running, hourStart.getTime() + position.targetOffsetSeconds * 1000);
      }
      // Trim-to-fit: once a position's projected start reaches the clock's length,
      // drop it and everything after it. Filler authored at the tail falls off first.
      // (A future trim priority would reorder which positions survive here.)
      if (running >= clockEnd) {
        trimmed += sortedPositions.length - pi;
        break;
      }
      const at = new Date(running);

      if (position.positionType === "fixed_event") {
        const durationMs = (position.constraints?.fixedDurationSeconds ?? 0) * 1000;
        items.push({
          sortOrder: sortOrder++,
          projectedAirAt: at,
          elementType: "fixed_event",
          songId: null,
          rdjSongId: null,
          clockPositionId: position.id,
          violations: [],
        });
        running += durationMs;
        continue;
      }

      if (!position.categoryId) {
        warnings.push(`position ${position.id} (sort ${position.sortOrder}) has no category — emitted unfillable`);
        items.push({
          sortOrder: sortOrder++,
          projectedAirAt: at,
          elementType: ELEMENT_TYPE[position.positionType],
          songId: null,
          rdjSongId: null,
          clockPositionId: position.id,
          violations: [{ step: "unfillable", detail: { poolCategoryId: null, fallbackCategoryId: null } }],
        });
        unfillable++;
        continue;
      }

      let pools = poolCache.get(position.id);
      if (!pools) {
        const allowedTypes = config.songTypeMap[position.positionType] ?? [];
        const pool = basePool(input.songs, subtree(position.categoryId, input.categories), allowedTypes);
        const fallbackId = position.constraints?.fallbackCategoryId;
        const fallback = fallbackId
          ? basePool(input.songs, subtree(fallbackId, input.categories), allowedTypes).filter(
              (s) => !pool.includes(s)
            )
          : null;
        pools = { pool, fallback };
        poolCache.set(position.id, pools);
      }

      const poolAncestry = ancestry(position.categoryId, categoryIndex);
      const eff = resolveRules(input.rules, position, poolAncestry);
      const rungs = buildRungs(config, eff, position);

      const prevMusic = recentMusic.length > 0 ? recentMusic[recentMusic.length - 1] : null;
      const result = fillPosition(
        pools.pool,
        pools.fallback,
        rungs,
        {
          at,
          timezone: input.timezone,
          position,
          eff,
          station,
          sep,
          hourCounts,
          prevMusicTempo: prevMusic?.tempo ?? null,
        },
        {
          sep,
          at,
          prevMusic,
          recentEras: recentMusic.slice(-3).map((s) => s.era),
          constraints: position.constraints,
          resolveTurnover: (song) => targetTurnoverFor(song, poolAncestry, categoryIndex, config),
          artistWindowMin: eff.artistSepMin,
          weights: config.weights,
        },
        config,
        rng,
        eff,
        position
      );

      for (const v of result.violations) {
        violationCounts[v.step] = (violationCounts[v.step] ?? 0) + 1;
        if (v.step === "unfillable") unfillable++;
      }

      const song = result.song;
      items.push({
        sortOrder: sortOrder++,
        projectedAirAt: at,
        elementType: ELEMENT_TYPE[position.positionType],
        songId: song?.id ?? null,
        rdjSongId: song?.rdjSongId ?? null,
        clockPositionId: position.id,
        violations: result.violations,
      });

      if (song) {
        sep.record(song, at);
        const local = localParts(at, input.timezone);
        for (const cap of station.maxPerHour) {
          if (song.categoryIds.some((c) => cap.memberCategoryIds.has(c))) {
            const key = `${local.hourKey}|${cap.categoryId}`;
            hourCounts.set(key, (hourCounts.get(key) ?? 0) + 1);
          }
        }
        if (position.positionType === "category") {
          recentMusic.push(song);
          if (recentMusic.length > 3) recentMusic.shift();
        }
        running += song.durationMs ?? config.defaultDurationMs;
        if (song.durationMs == null) {
          warnings.push(`song rdj:${song.rdjSongId} has no duration — assumed ${config.defaultDurationMs}ms`);
        }
      }
    }
  }

  return {
    items,
    warnings,
    stats: { totalItems: items.length, violationCounts, unfillable, trimmed },
  };
}
