import type { EngineConfig, EnginePosition, EngineSong, Violation } from "./types.js";
import type { EffectiveRules } from "./rules.js";
import type { FilterContext } from "./candidates.js";
import { hardFilter } from "./candidates.js";
import type { Rng } from "./rng.js";
import type { ScoreContext } from "./scoring.js";
import { scoreCandidate } from "./scoring.js";

export interface Rung {
  kind: "base" | Violation["step"];
  dropSecondary: boolean;
  artistFactor: number;
  titleFactor: number;
  useFallback: boolean;
  ignoreSeparation: boolean;
  /** shrink factor for violation payloads */
  factor?: number;
}

/**
 * Static, finite rung enumeration — computed once per position fill, purely from
 * config + effective rules + position. Cumulative: each rung keeps every prior
 * relaxation. Rungs that cannot change the outcome (no album/tempo rule to drop,
 * no artist/title window to shrink, no fallback configured) are omitted, keeping
 * the enumeration minimal while still statically determined by the input.
 * The final rung (last_resort) is always present and cannot fail on a non-empty
 * pool — the termination guarantee.
 */
export function buildRungs(
  config: EngineConfig,
  eff: EffectiveRules,
  position: EnginePosition
): Rung[] {
  const rungs: Rung[] = [
    { kind: "base", dropSecondary: false, artistFactor: 1, titleFactor: 1, useFallback: false, ignoreSeparation: false },
  ];
  if (eff.albumSepMin != null || eff.tempoClashHard != null) {
    rungs.push({ ...rungs[rungs.length - 1], kind: "drop_secondary_hard", dropSecondary: true });
  }
  if (eff.artistSepMin != null) {
    for (const factor of config.relaxationSteps) {
      rungs.push({ ...rungs[rungs.length - 1], kind: "shrink_artist", dropSecondary: true, artistFactor: factor, factor });
    }
  }
  if (eff.titleSepMin != null) {
    for (const factor of config.relaxationSteps) {
      rungs.push({ ...rungs[rungs.length - 1], kind: "shrink_title", dropSecondary: true, titleFactor: factor, factor });
    }
  }
  if (position.constraints?.fallbackCategoryId) {
    rungs.push({ ...rungs[rungs.length - 1], kind: "fallback_category", useFallback: true });
  }
  rungs.push({ ...rungs[rungs.length - 1], kind: "last_resort", ignoreSeparation: true });
  return rungs;
}

function violationFor(rung: Rung, eff: EffectiveRules, position: EnginePosition): Violation | null {
  switch (rung.kind) {
    case "base":
      return null;
    case "drop_secondary_hard":
      return {
        step: "drop_secondary_hard",
        detail: {
          rules: [
            ...(eff.albumSepMin != null ? ["album_separation"] : []),
            ...(eff.tempoClashHard != null ? ["tempo_clash"] : []),
          ],
        },
      };
    case "shrink_artist":
      return {
        step: "shrink_artist",
        detail: {
          ruleId: eff.ruleIds.artist,
          windowBeforeMin: eff.artistSepMin,
          windowAfterMin: eff.artistSepMin! * rung.factor!,
          factor: rung.factor,
        },
      };
    case "shrink_title":
      return {
        step: "shrink_title",
        detail: {
          ruleId: eff.ruleIds.title,
          windowBeforeMin: eff.titleSepMin,
          windowAfterMin: eff.titleSepMin! * rung.factor!,
          factor: rung.factor,
        },
      };
    case "fallback_category":
      return {
        step: "fallback_category",
        detail: {
          fromCategoryId: position.categoryId,
          toCategoryId: position.constraints?.fallbackCategoryId,
        },
      };
    default:
      return null; // last_resort / unfillable get bespoke payloads in fillPosition
  }
}

export interface FillResult {
  song: EngineSong | null;
  violations: Violation[];
}

/**
 * Walks the ladder: first rung with ≥1 survivor wins. Violations = every relaxation
 * rung in force at pick time (base excluded), with concrete payloads. Survivors are
 * scored and top-K picked exactly like the base path — except last_resort, which
 * deterministically takes the least-recently-heard song with NO RNG consumption.
 */
export function fillPosition(
  pool: EngineSong[],
  fallbackPool: EngineSong[] | null,
  rungs: Rung[],
  filterCtx: FilterContext,
  scoreCtx: ScoreContext,
  config: EngineConfig,
  rng: Rng,
  eff: EffectiveRules,
  position: EnginePosition
): FillResult {
  const violationsInForce: Violation[] = [];

  for (const rung of rungs) {
    const v = violationFor(rung, eff, position);
    // shrink rungs supersede the previous shrink of the same kind rather than stack
    if (v) {
      const idx = violationsInForce.findIndex((x) => x.step === v.step);
      if (idx >= 0) violationsInForce[idx] = v;
      else violationsInForce.push(v);
    }

    const rungPool = rung.useFallback && fallbackPool ? [...pool, ...fallbackPool] : pool;

    if (rung.kind === "last_resort") {
      const survivors = hardFilter(rungPool, rung, filterCtx);
      if (survivors.length === 0) {
        return {
          song: null,
          violations: [
            ...violationsInForce,
            {
              step: "unfillable",
              detail: {
                poolCategoryId: position.categoryId,
                fallbackCategoryId: position.constraints?.fallbackCategoryId ?? null,
              },
            },
          ],
        };
      }
      // Least recently heard at the slot's projected air time; tie → lowest rdjSongId.
      // survivors are already rdjSongId-sorted, so the first max-gap hit wins ties.
      let best = survivors[0];
      let bestGap = filterCtx.sep.gapMinutes("song", best.rdjSongId, filterCtx.at);
      for (const s of survivors.slice(1)) {
        const gap = filterCtx.sep.gapMinutes("song", s.rdjSongId, filterCtx.at);
        if (gap > bestGap) {
          best = s;
          bestGap = gap;
        }
      }
      return {
        song: best,
        violations: [
          ...violationsInForce,
          {
            step: "last_resort",
            detail: {
              ignoredRules: ["artist_separation", "title_separation", "max_per_hour"],
              pickedGapMinutes: bestGap === Infinity ? null : Math.round(bestGap * 10) / 10,
            },
          },
        ],
      };
    }

    const survivors = hardFilter(rungPool, rung, filterCtx);
    if (survivors.length === 0) continue;

    // Score with one jitter draw per survivor (rdjSongId order — stable RNG mapping),
    // sort desc with rdjSongId tiebreak, then one rank-weighted top-K draw.
    const artistWindow =
      eff.artistSepMin != null ? eff.artistSepMin * rung.artistFactor : null;
    const scored = survivors.map((song) => ({
      song,
      score:
        scoreCandidate(song, { ...scoreCtx, artistWindowMin: artistWindow }) +
        (rng() * 2 - 1) * config.jitterMagnitude,
    }));
    scored.sort((a, b) => b.score - a.score || a.song.rdjSongId - b.song.rdjSongId);

    const k = Math.min(config.searchDepth, scored.length);
    // P(rank i) ∝ K − i
    const totalWeight = (k * (k + 1)) / 2;
    let draw = rng() * totalWeight;
    let picked = scored[0].song;
    for (let i = 0; i < k; i++) {
      draw -= k - i;
      if (draw <= 0) {
        picked = scored[i].song;
        break;
      }
    }
    return { song: picked, violations: [...violationsInForce] };
  }

  // Unreachable: the enumeration always ends in last_resort, which always returns.
  throw new Error("relaxation ladder fell through — buildRungs invariant broken");
}
