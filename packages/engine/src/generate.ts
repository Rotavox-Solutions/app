import type {
  ElementType,
  EngineCategory,
  EngineConfig,
  EngineSong,
  GeneratedItem,
  GenerateLogInput,
  GenerateLogResult,
  PositionType,
  EnginePosition,
} from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

/** Lookback for the soft hour-spread component when no horizontal rule is configured. */
const DEFAULT_HOUR_SPREAD_DAYS = 3;
import { createRng } from "./rng.js";
import { assertHourAligned, iterateHours, localParts, weekInCycle } from "./time.js";
import { SeparationState } from "./separation.js";
import { ancestry, buildCategoryIndex, buildStationConstraints, resolveRules, subtree } from "./rules.js";
import { basePool, hourDistance } from "./candidates.js";
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
  let fillerActivated = 0;
  let sacrificed = 0;

  /**
   * Playout drift carried into the next hour, ms.
   *
   * The clock boundary is immovable -- the next hour's TOH is due at :00 whatever
   * happened before it. So an hour that overruns does not push the boundary, it eats
   * into the FOLLOWING hour's budget. Modelling that here is what lets the generator
   * decide, in advance and visibly, which position to give up; left unmodelled the
   * shear still happens at playout and simply takes whatever sits at the tail.
   *
   * Capped so a pathological hour cannot cascade: past the cap the schedule accepts it
   * is late rather than gutting an entire hour to catch up.
   */
  let carryMs = 0;
  const MAX_CARRY_MS = 5 * 60_000;

  /** Mean duration of a position's own pool, used only to size the hour before picking. */
  const meanPoolDuration = (position: EnginePosition): number | null => {
    if (!position.categoryId) return null;
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
    const src = pools.pool.length ? pools.pool : (pools.fallback ?? []);
    if (!src.length) return null;
    const withDur = src.filter((s) => s.durationMs != null);
    if (!withDur.length) return null;
    return withDur.reduce((a, s) => a + (s.durationMs ?? 0), 0) / withDur.length;
  };

  for (const hourStart of iterateHours(input.horizonStart, input.horizonEnd)) {
    // Hours are NOT independent. An hour that overruns pushes its successor late, and
    // the successor's TOH is still due at :00 — so the overrun becomes a reduced budget
    // rather than a moved boundary. carryMs is that debt; underruns never bank credit.
    let running = hourStart.getTime() + carryMs;

    const { dayOfWeek, hour } = localParts(hourStart, input.timezone);
    const wic = cycleEpoch ? weekInCycle(hourStart, cycleEpoch, cycleWeeks, input.timezone) : 0;
    const clockId = gridMap.get(`${wic}|${dayOfWeek}|${hour}`);
    const clock = clockId ? clockById.get(clockId) : undefined;
    if (!clock) {
      warnings.push(`no clock mapped for local week=${wic} dow=${dayOfWeek} hour=${hour} (${hourStart.toISOString()}) — hour skipped`);
      continue;
    }

    const clockEnd = hourStart.getTime() + (clock.lengthMinutes ?? 60) * 60_000;
    const allPositions = [...clock.positions].sort((a, b) => a.sortOrder - b.sortOrder);

    // ---- conditional filler activation -------------------------------------------
    // Estimate the hour from each position's pool mean, then activate as many filler
    // candidates as the deficit needs, in priority order. Candidates are pre-placed at
    // spread positions by the clock author, so activating the top N yields filler
    // distributed across the hour rather than stacked at its tail -- the same reason
    // music uses two-level proportional placement.
    const isCandidate = (p: EnginePosition) => p.constraints?.fillerPriority != null;
    const candidates = allPositions
      .filter(isCandidate)
      .sort((a, b) => a.constraints!.fillerPriority! - b.constraints!.fillerPriority!);

    // The budget is what is left of the clock AFTER absorbing drift from earlier hours.
    // The boundary itself never moves: the next TOH is due at :00 regardless.
    const budget = clockEnd - running;

    const estimateOf = (p: EnginePosition): number =>
      p.positionType === "fixed_event"
        ? (p.constraints?.fixedDurationSeconds ?? 0) * 1000
        : (meanPoolDuration(p) ?? config.defaultDurationMs);

    let programmed = allPositions.filter((p) => !isCandidate(p));
    let estimate = programmed.reduce((t, p) => t + estimateOf(p), 0);
    const live = new Set<string>();

    if (estimate < budget && candidates.length > 0) {
      // Deliberate overschedule: the hour is planned to exceed its budget so the excess
      // is shorn on purpose rather than the hour running dry by accident.
      // ---- ADDITIVE: hour is short, activate filler in priority order ---------------
      const fillerMean = meanPoolDuration(candidates[0]) ?? config.defaultDurationMs;
      // CEIL, not round. The costs are wildly asymmetric: underscheduling risks dead
      // air, which is unrecoverable, while overscheduling costs a shear -- and since
      // priority-1 filler is the tail buffer, that shear lands on an F by construction.
      // An earlier version rounded, on the reasoning that overshooting would trim a
      // programmed position. That stopped being true once the buffer existed, and
      // rounding can leave the hour up to half a song SHORT, which is the one outcome
      // there is no recovery from.
      const want = Math.ceil((budget - estimate) / fillerMean);
      const activate = Math.min(candidates.length, want);
      for (const p of candidates.slice(0, activate)) live.add(p.id);
      fillerActivated += activate;
      if (want > candidates.length) {
        warnings.push(
          `hour ${hourStart.toISOString()} short by ~${Math.round((budget - estimate) / 60000)}min but only ` +
            `${candidates.length} filler candidate(s) authored — clock needs more`
        );
      }
    } else if (estimate > budget) {
      // ---- SUBTRACTIVE: hour cannot fit, give something up DELIBERATELY -------------
      // Without this the overrun still happens, it just happens at playout and takes
      // whatever sits at the tail — arbitrary with respect to programming value. Here
      // the choice is explicit, ordered, and visible in the log before air.
      const sacrificeable = programmed
        .filter((p) => p.constraints?.trimPriority != null)
        .sort((a, b) => a.constraints!.trimPriority! - b.constraints!.trimPriority!);
      const dropped = new Set<string>();
      let over = estimate - budget;
      for (const p of sacrificeable) {
        if (over <= 0) break;
        dropped.add(p.id);
        over -= estimateOf(p);
        sacrificed++;
      }
      if (over > 0) {
        warnings.push(
          `hour ${hourStart.toISOString()} over budget by ~${Math.round(over / 60000)}min after ` +
            `sacrificing ${dropped.size} position(s) — remainder will trim from the tail`
        );
      }
      programmed = programmed.filter((p) => !dropped.has(p.id));
    }

    const sortedPositions = allPositions.filter((p) => (isCandidate(p) ? live.has(p.id) : programmed.includes(p)));

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
          slotHour: localParts(at, input.timezone).hour,
          hourSpreadDays: eff.horizontalSep?.minDays ?? DEFAULT_HOUR_SPREAD_DAYS,
          hourDistance,
          toLocalHour: (t) => localParts(new Date(t), input.timezone).hour,
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

    // Whatever this hour overran by is the next hour's reduced budget. Underruns do NOT
    // carry negative — an hour that finishes early is simply early, and the next TOH is
    // still due at :00; letting it bank credit would schedule the next hour long.
    carryMs = Math.min(MAX_CARRY_MS, Math.max(0, running - clockEnd));
  }

  return {
    items,
    warnings,
    stats: { totalItems: items.length, violationCounts, unfillable, trimmed, fillerActivated, sacrificed },
  };
}
