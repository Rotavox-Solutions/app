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
import { buildRungs, pickFromShortlist, rankCandidates, type RankedResult } from "./ladder.js";
import { buildReachable, fitHour, MAX_REMOVABLE, type FitUnit } from "./fit.js";

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
   * SIGNED top-of-hour drift carried into the next hour, ms.
   * Positive = the next TOH runs LATE. Negative = it runs EARLY.
   *
   * The clock boundary is immovable -- the next hour's TOH is due at :00 whatever
   * happened before it. So an hour that overruns does not push the boundary, it eats
   * into the FOLLOWING hour's budget. Modelling that here is what lets the generator
   * decide, in advance and visibly, which position to give up; left unmodelled the
   * shear still happens at playout and simply takes whatever sits at the tail.
   *
   * WHY SIGNED. The previous version clamped at zero, on the reasoning that an hour
   * finishing early "is simply early, and the next TOH is still due at :00". That
   * inverts: if TOH airs at :58, the next hour needs SIXTY-TWO minutes of content for
   * the TOH after it to land at :00. Negative carry is the restoring force for early
   * drift, and without it early drift has no restoring force at all -- it accumulates
   * one-sidedly and is never corrected.
   *
   * Bounds are ASYMMETRIC, and deliberately so. Late and early are not equally bad: a
   * station ID at :58 is ambiguous about which hour it identifies, where the same
   * distance late is merely late. So early is held to a far tighter bound.
   *
   * MAX_EARLY_MS = 0 reproduces the old one-sided behaviour exactly.
   */
  let driftMs = 0;
  const MAX_LATE_MS = config.maxLateDriftMs;
  const MAX_EARLY_MS = config.maxEarlyDriftMs;

  /** Pool + fallback for a position, cached — static across hours. */
  const poolsFor = (position: EnginePosition) => {
    let pools = poolCache.get(position.id);
    if (!pools) {
      const allowedTypes = config.songTypeMap[position.positionType] ?? [];
      const pool = basePool(input.songs, subtree(position.categoryId!, input.categories), allowedTypes);
      const fallbackId = position.constraints?.fallbackCategoryId;
      const fallback = fallbackId
        ? basePool(input.songs, subtree(fallbackId, input.categories), allowedTypes).filter((s) => !pool.includes(s))
        : null;
      pools = { pool, fallback };
      poolCache.set(position.id, pools);
    }
    return pools;
  };

  const durationOf = (song: EngineSong): number => song.durationMs ?? config.defaultDurationMs;
  /** buildReachable works in 100ms quanta, so units are matched back to songs in the same terms. */
  const quantum = (ms: number): number => Math.round(ms / 100);

  /** Rank a position's candidates at a given instant. Shared by both passes. */
  const rankAt = (position: EnginePosition, at: Date, depth?: number): RankedResult => {
    const pools = poolsFor(position);
    const poolAncestry = ancestry(position.categoryId!, categoryIndex);
    const eff = resolveRules(input.rules, position, poolAncestry);
    const prevMusic = recentMusic.length > 0 ? recentMusic[recentMusic.length - 1] : null;
    return rankCandidates(
      pools.pool,
      pools.fallback,
      buildRungs(config, eff, position),
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
      position,
      depth ?? config.searchDepth
    );
  };

  /** Record a placement into the mutable per-hour state. */
  const commitSong = (song: EngineSong, position: EnginePosition, at: Date): void => {
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
  };

  interface Drawn {
    song: EngineSong | null;
    durationMs: number;
    violations: GeneratedItem["violations"];
  }

  for (const hourStart of iterateHours(input.horizonStart, input.horizonEnd)) {
    const hourStartMs = hourStart.getTime();
    // Where this hour's content actually begins. The clock boundary never moves, so a
    // prior overrun eats into this hour rather than pushing the next one.
    const startAt = hourStartMs + driftMs;

    const { dayOfWeek, hour } = localParts(hourStart, input.timezone);
    const wic = cycleEpoch ? weekInCycle(hourStart, cycleEpoch, cycleWeeks, input.timezone) : 0;
    const clockId = gridMap.get(`${wic}|${dayOfWeek}|${hour}`);
    const clock = clockId ? clockById.get(clockId) : undefined;
    if (!clock) {
      warnings.push(`no clock mapped for local week=${wic} dow=${dayOfWeek} hour=${hour} (${hourStart.toISOString()}) — hour skipped`);
      continue;
    }

    const clockEnd = hourStartMs + (clock.lengthMinutes ?? 60) * 60_000;
    const allPositions = [...clock.positions].sort((a, b) => a.sortOrder - b.sortOrder);
    const isCandidate = (p: EnginePosition) => p.constraints?.fillerPriority != null;
    const candidates = allPositions
      .filter(isCandidate)
      .sort((a, b) => a.constraints!.fillerPriority! - b.constraints!.fillerPriority!);
    const programmed = allPositions.filter((p) => !isCandidate(p));

    // ---- PASS A: cost the hour ----------------------------------------------------
    // Draw every programmed position for real, so the fit reasons about the durations
    // this hour will ACTUALLY have rather than about pool means. Sizing from means was
    // the old approach and it cannot work: 16 draws at ~40s sd carry +/-2.7 min of
    // sampling error, the same magnitude as the gap being closed.
    //
    // Placements are recorded into separation as we go -- two positions in one hour
    // would otherwise draw the same artist -- but inside a TRIAL, because pass B
    // re-stamps every time and may give a position up entirely.
    sep.beginTrial();
    const hourCountsBefore = new Map(hourCounts);
    const recentBefore = [...recentMusic];

    const drawn = new Map<string, Drawn>();
    let cursor = startAt;
    for (const position of programmed) {
      if (position.targetOffsetSeconds != null) {
        cursor = Math.max(cursor, hourStartMs + position.targetOffsetSeconds * 1000);
      }
      const at = new Date(cursor);

      if (position.positionType === "fixed_event") {
        const durationMs = (position.constraints?.fixedDurationSeconds ?? 0) * 1000;
        drawn.set(position.id, { song: null, durationMs, violations: [] });
        cursor += durationMs;
        continue;
      }
      if (!position.categoryId) {
        drawn.set(position.id, {
          song: null,
          durationMs: 0,
          violations: [{ step: "unfillable", detail: { poolCategoryId: null, fallbackCategoryId: null } }],
        });
        continue;
      }

      const ranked = rankAt(position, at);
      const song = pickFromShortlist(ranked, config, rng);
      const durationMs = song ? durationOf(song) : 0;
      drawn.set(position.id, { song, durationMs, violations: ranked.violations });
      if (song) commitSong(song, position, at);
      cursor += durationMs;
    }
    const currentMs = cursor - startAt;

    // Closing shortlists, ranked at the hour's tail. Each candidate offers its best-
    // rested K; the fit picks WHICH of them lands the hour. Same candidate set as a
    // normal draw, so turnover is untouched (PERFECT-HOUR.md §3).
    const closerChoices = new Map<string, RankedResult>();
    for (const position of candidates) {
      if (!position.categoryId) continue;
      closerChoices.set(position.id, rankAt(position, new Date(cursor), config.closerSearchDepth));
    }

    sep.rollbackTrial();
    hourCounts.clear();
    for (const [k, v] of hourCountsBefore) hourCounts.set(k, v);
    recentMusic.length = 0;
    recentMusic.push(...recentBefore);

    // ---- THE FIT ------------------------------------------------------------------
    const closerUnits: FitUnit[] = [];
    for (const [posId, ranked] of closerChoices) {
      for (const song of ranked.shortlist) {
        closerUnits.push({ id: `${posId}|${song.id}`, durationMs: durationOf(song), categoryId: song.categoryIds[0] ?? null });
      }
    }
    const reachable = buildReachable(closerUnits, candidates.length);

    const removableAll = programmed
      .filter((p) => p.constraints?.trimPriority != null && (drawn.get(p.id)?.durationMs ?? 0) > 0)
      .sort((a, b) => a.constraints!.trimPriority! - b.constraints!.trimPriority!);
    if (removableAll.length > MAX_REMOVABLE) {
      // Say what was dropped from consideration. A silent truncation reads as "every
      // sacrifice was weighed" when it was not.
      warnings.push(
        `hour ${hourStart.toISOString()} has ${removableAll.length} sacrificeable positions; ` +
          `only the ${MAX_REMOVABLE} cheapest by trimPriority were offered to the fit`
      );
    }
    const removable: FitUnit[] = removableAll.slice(0, MAX_REMOVABLE).map((p) => ({
      id: p.id,
      durationMs: drawn.get(p.id)!.durationMs,
      categoryId: p.categoryId,
    }));

    const fit = fitHour({
      currentMs,
      targetMs: clockEnd - startAt,
      maxEarlyMs: config.maxEarlyDriftMs,
      removable,
      reachable,
    });

    const removedIds = new Set(fit.removed.map((u) => u.id));
    sacrificed += fit.removed.length;

    // Added units name a DURATION, not a song: buildReachable collapses equal-length
    // songs because they are interchangeable to the fit. Assign each back to a
    // candidate position that can actually supply that length, in fillerPriority
    // order so placement stays spread across the hour.
    const activated = new Map<string, EngineSong>();
    const usedSongIds = new Set<string>();

    const takeExact = (unit: FitUnit): boolean => {
      for (const position of candidates) {
        if (activated.has(position.id)) continue;
        const song = (closerChoices.get(position.id)?.shortlist ?? []).find(
          (s) => !usedSongIds.has(s.id) && quantum(durationOf(s)) === quantum(unit.durationMs)
        );
        if (song) {
          activated.set(position.id, song);
          usedSongIds.add(song.id);
          return true;
        }
      }
      return false;
    };

    // SUBSTITUTE, never drop. buildReachable collapses equal lengths, so the fit can
    // legitimately ask for two pieces of a length the pool holds only one unused copy
    // of. Refusing that unit costs the hour a whole record -- measured at 169s, which
    // blew the early bound and forced the carry to discard the remainder. The nearest
    // unused length is off by seconds instead.
    const takeNearest = (unit: FitUnit): number | null => {
      let best: { position: EnginePosition; song: EngineSong; delta: number } | null = null;
      for (const position of candidates) {
        if (activated.has(position.id)) continue;
        for (const song of closerChoices.get(position.id)?.shortlist ?? []) {
          if (usedSongIds.has(song.id)) continue;
          const delta = Math.abs(durationOf(song) - unit.durationMs);
          if (!best || delta < best.delta) best = { position, song, delta };
        }
      }
      if (!best) return null;
      activated.set(best.position.id, best.song);
      usedSongIds.add(best.song.id);
      return best.delta;
    };

    for (const unit of fit.added) {
      if (takeExact(unit)) continue;
      const delta = takeNearest(unit);
      if (delta === null) {
        warnings.push(
          `hour ${hourStart.toISOString()} fit chose a ${Math.round(unit.durationMs / 1000)}s closer but no ` +
            `candidate position has an unused song left — hour lands ${Math.round(unit.durationMs / 1000)}s shorter than planned`
        );
      } else if (delta > 5_000) {
        warnings.push(
          `hour ${hourStart.toISOString()} substituted a closer ${Math.round(delta / 1000)}s from the ` +
            `${Math.round(unit.durationMs / 1000)}s the fit chose — closing pool is thin at that length`
        );
      }
    }
    fillerActivated += activated.size;

    // ---- PASS B: materialise ------------------------------------------------------
    // Nothing is drawn here. Every song was chosen in pass A; this walks the surviving
    // positions in clock order, stamps the times they will really air at, and records
    // separation against THOSE times.
    const final = allPositions.filter((p) =>
      isCandidate(p) ? activated.has(p.id) : drawn.has(p.id) && !removedIds.has(p.id)
    );

    let running = startAt;
    for (let fi = 0; fi < final.length; fi++) {
      const position = final[fi];
      if (position.targetOffsetSeconds != null) {
        running = Math.max(running, hourStartMs + position.targetOffsetSeconds * 1000);
      }
      // Backstop, not the mechanism. The fit lands the hour whenever the clock gives it
      // anything to work with; this only catches a clock authored so long that ranked
      // sacrifice could not close it, and it never fights the fit — an item already
      // under way when the boundary arrives is kept, so a deliberate small overrun
      // survives intact.
      if (running >= clockEnd) {
        trimmed += final.length - fi;
        break;
      }
      const at = new Date(running);
      const closer = activated.get(position.id);
      const drawnHere = drawn.get(position.id);
      const song = closer ?? drawnHere?.song ?? null;
      const violations = closer ? (closerChoices.get(position.id)?.violations ?? []) : (drawnHere?.violations ?? []);

      for (const v of violations) {
        violationCounts[v.step] = (violationCounts[v.step] ?? 0) + 1;
        if (v.step === "unfillable") unfillable++;
      }

      items.push({
        sortOrder: sortOrder++,
        projectedAirAt: at,
        nominalHour: hourStart,
        elementType: position.positionType === "fixed_event" ? "fixed_event" : ELEMENT_TYPE[position.positionType],
        songId: song?.id ?? null,
        rdjSongId: song?.rdjSongId ?? null,
        clockPositionId: position.id,
        violations,
      });

      if (song) {
        commitSong(song, position, at);
        if (song.durationMs == null) {
          warnings.push(`song rdj:${song.rdjSongId} has no duration — assumed ${config.defaultDurationMs}ms`);
        }
        running += durationOf(song);
      } else if (position.positionType === "fixed_event") {
        running += drawnHere?.durationMs ?? 0;
      } else if (!position.categoryId) {
        warnings.push(`position ${position.id} (sort ${position.sortOrder}) has no category — emitted unfillable`);
      }
    }

    // Reported from the ACTUAL result. An hour that still lands short after the fit had
    // every candidate and every sacrifice available is an under-authored clock.
    // Reported from the FIT's own signed result, not from `running`. The trim-to-fit
    // backstop above stops the clock at the boundary, so `running` reads as "landed
    // exactly" for precisely the over-authored hours worth warning about.
    if (fit.driftMs < 0 && candidates.length > 0 && activated.size === candidates.length) {
      warnings.push(
        `hour ${hourStart.toISOString()} ended ~${Math.round(-fit.driftMs / 1000)}s short with every ` +
          `one of its ${candidates.length} filler candidate(s) already activated — clock needs more`
      );
    }
    if (fit.driftMs > 0 && removable.length > 0 && fit.removed.length === removable.length) {
      warnings.push(
        `hour ${hourStart.toISOString()} over budget by ~${Math.round(fit.driftMs / 1000)}s ` +
          `after sacrificing every one of its ${removable.length} ranked position(s)`
      );
    }

    // This hour's end IS the next TOH. Signed, so early drift is corrected as well as
    // late. Clamping DISCARDS the excess rather than deferring it, so say so out loud:
    // beyond the bound the schedule has accepted a TOH it will never claw back.
    const rawDrift = running - clockEnd;
    driftMs = Math.max(-MAX_EARLY_MS, Math.min(MAX_LATE_MS, rawDrift));
    if (rawDrift !== driftMs) {
      warnings.push(
        `hour ${hourStart.toISOString()} drift ${Math.round(rawDrift / 1000)}s exceeds the ` +
          `[-${MAX_EARLY_MS / 1000}s, +${MAX_LATE_MS / 1000}s] bound — clamped to ` +
          `${Math.round(driftMs / 1000)}s, ${Math.round(Math.abs(rawDrift - driftMs) / 1000)}s discarded`
      );
    }
  }

  return {
    items,
    warnings,
    stats: { totalItems: items.length, violationCounts, unfillable, trimmed, fillerActivated, sacrificed },
  };
}
