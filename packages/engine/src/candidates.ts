import type { EngineSong, EnginePosition } from "./types.js";
import type { EffectiveRules, StationConstraints } from "./rules.js";
import type { SeparationState } from "./separation.js";
import type { Rung } from "./ladder.js";
import { localParts } from "./time.js";

export interface FilterContext {
  at: Date; // the slot's would-be projected_air_at — the ONLY time axis
  timezone: string;
  position: EnginePosition;
  eff: EffectiveRules;
  station: StationConstraints;
  sep: SeparationState;
  /** placed-count per `${localHourKey}|${categoryId}` for max_per_hour */
  hourCounts: Map<string, number>;
  prevMusicTempo: number | null;
}

/** Pool membership + song_type + enabled — the rung-independent base pool. */
export function basePool(
  songs: EngineSong[],
  poolCategoryIds: Set<string>,
  allowedSongTypes: number[]
): EngineSong[] {
  return songs
    .filter(
      (s) =>
        s.enabled === true &&
        s.songType != null &&
        allowedSongTypes.includes(s.songType) &&
        s.categoryIds.some((c) => poolCategoryIds.has(c))
    )
    .sort((a, b) => a.rdjSongId - b.rdjSongId); // stable order for deterministic RNG mapping
}

/** Circular distance between two hours-of-day, 0..12. */
export function hourDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

/**
 * Hard filters for one rung. Separation windows arrive pre-scaled by the rung's
 * shrink factors; `rung.ignoreSeparation` (last resort) drops separations and
 * max_per_hour but keeps content-eligibility rules (daypart, sound-code excludes).
 */
export function hardFilter(candidates: EngineSong[], rung: Rung, ctx: FilterContext): EngineSong[] {
  const { eff, sep, at, station } = ctx;
  const local = localParts(at, ctx.timezone);
  const excludes = ctx.position.constraints?.soundCodesExclude;

  return candidates.filter((song) => {
    // Content eligibility — never relaxed, on any rung.
    if (excludes && excludes.length > 0 && song.soundCodes?.some((c) => excludes.includes(c))) {
      return false;
    }
    for (const dp of station.dayparts) {
      const applies =
        dp.scope === "global" ||
        (dp.scope === "category" && song.categoryIds.some((c) => dp.memberCategoryIds!.has(c))) ||
        (dp.scope === "position" && dp.positionId === ctx.position.id);
      if (!applies) continue;
      // Evaluated at the item's projected air instant in station-local time — an
      // overrunning clock must not leak a restricted song past its boundary.
      if (dp.days && !dp.days.includes(local.dayOfWeek)) return false;
      if (dp.hours && !dp.hours.includes(local.hour)) return false;
    }

    if (rung.ignoreSeparation) return true; // last resort: separations + caps dropped

    if (eff.artistSepMin != null && song.artist) {
      const window = eff.artistSepMin * rung.artistFactor;
      if (sep.gapMinutes("artist", song.artist, at) < window) return false;
    }
    if (eff.titleSepMin != null && song.title) {
      const window = eff.titleSepMin * rung.titleFactor;
      if (sep.gapMinutes("title", song.title, at) < window) return false;
    }
    if (!rung.dropSecondary) {
      // Horizontal separation: this song must not have played near this hour-of-day
      // within the last `minDays`. Treated as a secondary hard rule — it is a quality
      // constraint, not a safety one, so it yields before the schedule goes unfilled.
      if (eff.horizontalSep) {
        const { windowHours, minDays } = eff.horizontalSep;
        const recent = sep.playsWithin(song.rdjSongId, at, minDays * 86_400_000);
        for (const t of recent) {
          const h = localParts(new Date(t), ctx.timezone).hour;
          if (hourDistance(h, local.hour) < windowHours) return false;
        }
      }
      if (eff.albumSepMin != null && song.album) {
        if (sep.gapMinutes("album", song.album, at) < eff.albumSepMin) return false;
      }
      if (eff.tempoClashHard && song.tempo != null && ctx.prevMusicTempo != null) {
        if (Math.abs(song.tempo - ctx.prevMusicTempo) > eff.tempoClashHard.maxJump) return false;
      }
    }
    for (const cap of station.maxPerHour) {
      if (!song.categoryIds.some((c) => cap.memberCategoryIds.has(c))) continue;
      const placed = ctx.hourCounts.get(`${local.hourKey}|${cap.categoryId}`) ?? 0;
      if (placed >= cap.count) return false;
    }
    return true;
  });
}
