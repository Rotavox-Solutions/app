// Rising and falling (ADR-0002 §3, §6.3): direction within the currents ladder is derived
// from the pool's place on the ladder and the time since the song entered it — never
// stored on the song, so nobody has to maintain it by hand. Pure; the caller loads the
// song's entry into its pool from lifecycle_events.

export type Direction = "rising" | "falling";

/** Why a song has the direction it has, for a PD to read. */
export type DirectionWhy =
  | "time" // active in the pool past its falling-after time
  | "came_down" // arrived from a hotter pool
  | "came_up" // arrived from a cooler pool
  | "new"; // arrived from off the ladder: no pool, or a pool with no rank

export interface LadderPool {
  ladderRank: number | null;
  fallingAfterDays: number | null;
}

export interface PoolEntry {
  /** When the song last went active in its current pool. */
  at: Date;
  /**
   * The pool it came from, when that is known. The one-time import knows when, not from
   * where, so it carries `known: false` and only time can make it fall.
   */
  from: LadderPool | null;
  known: boolean;
}

export interface DirectionResult {
  direction: Direction;
  why: DirectionWhy;
  /** Days since it entered the pool. */
  days: number;
}

const DAY_MS = 86_400_000;

export function deriveDirection(
  state: string,
  pool: LadderPool | null,
  entry: PoolEntry | null,
  now: Date = new Date()
): DirectionResult | null {
  if (state !== "active" || pool?.ladderRank == null || !entry) return null;
  const days = Math.floor((now.getTime() - entry.at.getTime()) / DAY_MS);
  if (pool.fallingAfterDays != null && days >= pool.fallingAfterDays) return { direction: "falling", why: "time", days };
  if (!entry.known) return null;
  const fromRank = entry.from?.ladderRank ?? null;
  if (fromRank == null) return { direction: "rising", why: "new", days };
  if (fromRank < pool.ladderRank) return { direction: "falling", why: "came_down", days };
  if (fromRank > pool.ladderRank) return { direction: "rising", why: "came_up", days };
  return null;
}
