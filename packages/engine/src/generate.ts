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
import { assertHourAligned, HOUR_MS, iterateHours, localParts } from "./time.js";
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
  const gridMap = new Map<string, string>();
  for (const slot of [...input.grid].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.hour - b.hour)) {
    gridMap.set(`${slot.dayOfWeek}|${slot.hour}`, slot.clockId);
  }

  // Pool + rung caches are keyed per position id — static across hours.
  const poolCache = new Map<string, { pool: EngineSong[]; fallback: EngineSong[] | null }>();

  const items: GeneratedItem[] = [];
  const warnings: string[] = [];
  const violationCounts: Record<string, number> = {};
  let unfillable = 0;

  const hourCounts = new Map<string, number>(); // `${localHourKey}|${categoryId}` → placed
  const recentMusic: EngineSong[] = []; // last 3 music items for era/flow context

  let running = input.horizonStart.getTime();
  let sortOrder = 0;

  for (const hourStart of iterateHours(input.horizonStart, input.horizonEnd)) {
    // Hard re-sync at each top of hour: underruns gap, overruns spill forward.
    running = Math.max(running, hourStart.getTime());

    const { dayOfWeek, hour } = localParts(hourStart, input.timezone);
    const clockId = gridMap.get(`${dayOfWeek}|${hour}`);
    const clock = clockId ? clockById.get(clockId) : undefined;
    if (!clock) {
      warnings.push(`no clock mapped for local dow=${dayOfWeek} hour=${hour} (${hourStart.toISOString()}) — hour skipped`);
      continue;
    }

    for (const position of [...clock.positions].sort((a, b) => a.sortOrder - b.sortOrder)) {
      if (position.targetOffsetSeconds != null) {
        running = Math.max(running, hourStart.getTime() + position.targetOffsetSeconds * 1000);
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
    stats: { totalItems: items.length, violationCounts, unfillable },
  };
}
