// Resolving "make week N the one airing now" into a rotation epoch, with the engine's own
// weekInCycle so the result is exactly what generation will read.
import { localParts, weekInCycle } from "@rotavox/engine";

const DAY_MS = 86_400_000;

/**
 * The epoch that makes `airingWeek` (0-based) the week airing at `now`. An existing
 * epoch moves in whole weeks, so week boundaries stay on the same weekday; with none,
 * weeks start on the most recent local Monday.
 */
export function epochForAiringWeek(
  current: Date | null,
  cycleWeeks: number,
  airingWeek: number,
  timezone: string,
  now: Date = new Date()
): Date {
  let base = current;
  if (!base) {
    const dow = localParts(now, timezone).dayOfWeek; // 0 = Sunday
    base = new Date(now.getTime() - ((dow + 6) % 7) * DAY_MS);
  }
  if (cycleWeeks <= 1) return base;
  const airing = weekInCycle(now, base, cycleWeeks, timezone);
  const shift = (((airing - airingWeek) % cycleWeeks) + cycleWeeks) % cycleWeeks;
  const epoch = new Date(base.getTime() + shift * 7 * DAY_MS);
  // Moving by whole weeks can't change the answer's weekday, but say so if it ever did.
  if (weekInCycle(now, epoch, cycleWeeks, timezone) !== airingWeek) {
    throw new Error(`epochForAiringWeek: week ${airingWeek} did not resolve as airing`);
  }
  return epoch;
}
