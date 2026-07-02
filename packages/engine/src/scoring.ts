import type { EngineSong, EngineWeights, PositionConstraints } from "./types.js";
import { SeparationState } from "./separation.js";

// Every soft component is null-neutral: missing data → 0.5, so an untagged library
// (the real mirror today) degrades to rest + jitter — turnover rotation — while
// fixtures exercise the full model.

/** min(hoursSince/target, 2)/2 → [0,1]; never played → 1. Negative gap (regen overlap) clamps to 0. */
export function restScore(sep: SeparationState, song: EngineSong, at: Date, targetTurnoverHours: number): number {
  const gapMin = sep.gapMinutes("song", song.rdjSongId, at);
  if (gapMin === Infinity) return 1;
  const hoursSince = Math.max(0, gapMin) / 60;
  return Math.min(hoursSince / targetTurnoverHours, 2) / 2;
}

/** 1 − (|Δtempo| + |Δenergy|)/8 when both sides fully tagged; else 0.5. */
export function flowScore(song: EngineSong, prevMusic: EngineSong | null): number {
  if (!prevMusic) return 0.5;
  if (song.tempo == null || song.energy == null || prevMusic.tempo == null || prevMusic.energy == null) return 0.5;
  return 1 - (Math.abs(song.tempo - prevMusic.tempo) + Math.abs(song.energy - prevMusic.energy)) / 8;
}

/** Share of the last 3 music items whose era differs; null comparisons count 0.5. */
export function eraSpreadScore(song: EngineSong, recentEras: (string | null)[]): number {
  if (recentEras.length === 0) return 0.5;
  let sum = 0;
  for (const era of recentEras) {
    if (song.era == null || era == null) sum += 0.5;
    else sum += song.era === era ? 0 : 1;
  }
  return sum / recentEras.length;
}

export function moodFitScore(song: EngineSong, constraints: PositionConstraints | null): number {
  const target = constraints?.moodTarget;
  if (!target || song.mood == null) return 0.5;
  return song.mood === target ? 1 : 0;
}

/** Include-list fit; `soundCodesExclude` is a hard filter, not scored here. */
export function soundFitScore(song: EngineSong, constraints: PositionConstraints | null): number {
  const include = constraints?.soundCodesInclude;
  if (!include || include.length === 0 || !song.soundCodes || song.soundCodes.length === 0) return 0.5;
  const codes = new Set(song.soundCodes);
  const matched = include.filter((c) => codes.has(c)).length;
  return matched / include.length;
}

/** 0 when artist gap ≥ 2× window; scales to −0.5 as gap approaches the window. */
export function nearSeparationPenalty(
  sep: SeparationState,
  song: EngineSong,
  at: Date,
  artistWindowMin: number | null
): number {
  if (artistWindowMin == null || artistWindowMin <= 0 || !song.artist) return 0;
  const gap = sep.gapMinutes("artist", song.artist, at);
  if (gap === Infinity || gap >= 2 * artistWindowMin) return 0;
  return -0.5 * ((2 * artistWindowMin - gap) / artistWindowMin);
}

export interface ScoreContext {
  sep: SeparationState;
  at: Date;
  prevMusic: EngineSong | null;
  recentEras: (string | null)[];
  constraints: PositionConstraints | null;
  /** Per-candidate turnover target: song override → pool-category default → config default. */
  resolveTurnover: (song: EngineSong) => number;
  artistWindowMin: number | null;
  weights: EngineWeights;
}

/** Full soft score, excluding jitter (the caller adds its own seeded draw). */
export function scoreCandidate(song: EngineSong, ctx: ScoreContext): number {
  const w = ctx.weights;
  return (
    w.rest * restScore(ctx.sep, song, ctx.at, ctx.resolveTurnover(song)) +
    w.flow * flowScore(song, ctx.prevMusic) +
    w.era * eraSpreadScore(song, ctx.recentEras) +
    w.mood * moodFitScore(song, ctx.constraints) +
    w.sound * soundFitScore(song, ctx.constraints) +
    w.nearSeparationPenalty * nearSeparationPenalty(ctx.sep, song, ctx.at, ctx.artistWindowMin)
  );
}
