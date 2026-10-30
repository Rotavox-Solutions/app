// Standing lifecycle rules (ADR-0002 §3): read each song's state, how long it has been in
// its pool, its direction and its airplay, and SUGGEST a move. Never a move: the PD
// accepts a suggestion into the draft, and it is reviewed and applied like any change.
// Pure, so the rules are testable without a database; the web app loads the inputs.
import { deriveDirection, type LadderPool, type PoolEntry } from "./direction.js";
import type { Placement } from "./membership.js";

export type SuggestionRule = "rest_exit" | "falling" | "promote" | "bench";
export const SUGGESTION_RULES: readonly SuggestionRule[] = ["rest_exit", "falling", "promote", "bench"];

export interface RulePool extends LadderPool {
  id: string;
  name: string;
  restReviewDays: number | null;
  restExitCategoryId: string | null;
  promoteAfterDays: number | null;
  promoteToCategoryId: string | null;
  benchAfterUnairedDays: number | null;
}

export interface RuleSong {
  id: string;
  state: string;
  /** When it entered its current state (rest is measured from this). */
  since: Date | null;
  poolId: string | null;
  /** When it last went active in its current pool (lifecycle_events), or null if never seen. */
  entry: PoolEntry | null;
  lastAiredAt: Date | null;
}

export interface Suggestion {
  songId: string;
  rule: SuggestionRule;
  to: Placement;
  /** Why, in a PD's words; becomes the change's reason when accepted. */
  why: string;
}

const DAY_MS = 86_400_000;
const days = (from: Date, now: Date) => Math.floor((now.getTime() - from.getTime()) / DAY_MS);

/**
 * The next pool down the ladder from `pool`: the hottest pool cooler than it (lowest rank
 * above its rank). Ties broken by name, so the answer is stable.
 */
export function nextPoolDown(pool: RulePool, pools: RulePool[]): RulePool | null {
  if (pool.ladderRank == null) return null;
  const cooler = pools
    .filter((p) => p.ladderRank != null && p.ladderRank > pool.ladderRank!)
    .sort((a, b) => a.ladderRank! - b.ladderRank! || a.name.localeCompare(b.name));
  return cooler[0] ?? null;
}

/**
 * At most one suggestion per song, the most pressing first: a rest that has run its
 * course, a song that hasn't aired in too long, a falling song, then a planned promotion.
 */
export function suggestMoves(songs: RuleSong[], pools: RulePool[], now: Date = new Date()): Suggestion[] {
  const byId = new Map(pools.map((p) => [p.id, p]));
  const out: Suggestion[] = [];

  for (const s of songs) {
    const pool = s.poolId ? byId.get(s.poolId) : undefined;
    if (!pool) continue;

    if (s.state === "resting") {
      if (pool.restReviewDays == null || !s.since) continue;
      const rested = days(s.since, now);
      if (rested < pool.restReviewDays) continue;
      const exit = pool.restExitCategoryId ? byId.get(pool.restExitCategoryId) : undefined;
      out.push({
        songId: s.id,
        rule: "rest_exit",
        to: { state: "active", categoryId: exit?.id ?? pool.id },
        why: `Rested ${rested} days from ${pool.name}, past its ${pool.restReviewDays}-day standard`,
      });
      continue;
    }
    if (s.state !== "active") continue;

    const inPool = s.entry ? days(s.entry.at, now) : null;

    // Unaired for too long, counted from the later of its last play and its arrival, so
    // a song just placed isn't benched for never having aired.
    if (pool.benchAfterUnairedDays != null) {
      const ref = [s.lastAiredAt, s.entry?.at].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
      if (ref && days(ref, now) >= pool.benchAfterUnairedDays) {
        out.push({
          songId: s.id,
          rule: "bench",
          to: { state: "benched", categoryId: null },
          why: s.lastAiredAt
            ? `Not aired in ${days(s.lastAiredAt, now)} days in ${pool.name}`
            : `Never aired in ${days(ref, now)} days in ${pool.name}`,
        });
        continue;
      }
    }

    const direction = deriveDirection(s.state, pool, s.entry, now);
    if (direction?.direction === "falling" && direction.why === "time") {
      const down = nextPoolDown(pool, pools);
      out.push({
        songId: s.id,
        rule: "falling",
        to: down ? { state: "active", categoryId: down.id } : { state: "resting", categoryId: pool.id },
        why: down
          ? `Falling: ${direction.days} days in ${pool.name}, past its falling-after time; next down is ${down.name}`
          : `Falling: ${direction.days} days in ${pool.name}, the bottom of the ladder; rest it`,
      });
      continue;
    }

    if (pool.promoteAfterDays != null && pool.promoteToCategoryId && inPool != null && inPool >= pool.promoteAfterDays) {
      const to = byId.get(pool.promoteToCategoryId);
      if (to && to.id !== pool.id) {
        out.push({
          songId: s.id,
          rule: "promote",
          to: { state: "active", categoryId: to.id },
          why: `${inPool} days in ${pool.name}; it moves on to ${to.name} after ${pool.promoteAfterDays}`,
        });
      }
    }
  }
  return out;
}
