/**
 * Landing the hour: choose what to add and what to give up so the hour ends as close to
 * its target as the available pieces allow.
 *
 * THE PROBLEM IS MAKING CHANGE
 * ----------------------------
 * An hour is built from whole songs, so it cannot land just anywhere — it lands on the
 * grid of totals those songs can add up to. Closing a 4-minute gap with pieces that are
 * all 3:18 long is trying to pay $12 in five-dollar bills. Give the scheduler a more
 * varied set of lengths and the grid gets finer, so the nearest reachable total sits
 * closer to the target. That is the entire mechanism, and it is exactly the change-making
 * problem — not an analogy for it.
 *
 * Two consequences worth stating plainly, because both are counter-intuitive:
 *
 *   - A pool with a WIDER spread of lengths fits better, not worse. Variety is what makes
 *     the grid fine. A pool where every song is the same length is the worst case.
 *   - Which categories may close the hour matters far more than which clock is playing.
 *     The clock decides how far the hour has to travel; the closing pool decides the size
 *     of the steps it can travel in.
 *
 * WHY EXACT, NOT GREEDY
 * ---------------------
 * A greedy fit — add while it seems to help — is wrong in a way that hides. It is
 * path-dependent, so its error moves unpredictably when anything else changes, and it
 * cannot see that two pieces together land closer than either alone. tools/drift-curve
 * shipped a greedy version whose p95 error RÓSE as its tolerance widened, which is
 * impossible for a correct fit: widening a tolerance only ever adds permitted landings
 * and can never make the best one worse. That impossibility is the check this module
 * keeps (see fit.test.ts).
 *
 * The reachable totals depend only on the pool's durations and the slot count, so they
 * are computed ONCE per pool (`buildReachable`) and reused for every hour. Per hour the
 * fit is a handful of binary searches.
 */

/** One thing the fit may add or give up. */
export interface FitUnit {
  id: string;
  durationMs: number;
  /** Which pool it came from — lets a caller cap or forbid per category. */
  categoryId: string | null;
}

/** Precomputed reachable totals for a closing pool. Build once, reuse across hours. */
export interface ReachableIndex {
  /** Sorted distinct reachable totals, in quanta. Always includes 0 (add nothing). */
  totals: Int32Array;
  /** For each count k, witness[k][total] = index into `durations` used to reach it, or -1. */
  witness: Int32Array[];
  durations: Int32Array;
  units: FitUnit[];
  quantumMs: number;
  maxAdds: number;
}

export interface FitInput {
  /** Length of the authored hour as actually drawn, ms. */
  currentMs: number;
  /** Length the hour should reach, ms. Already net of any drift carried in. */
  targetMs: number;
  /** How far BEFORE the target the hour may land. 0 forbids landing early. */
  maxEarlyMs: number;
  /** Positions that may be given up, cheapest first. Small — subsets are enumerated. */
  removable: FitUnit[];
  reachable: ReachableIndex;
}

export interface FitResult {
  added: FitUnit[];
  removed: FitUnit[];
  lengthMs: number;
  /** Signed: positive = the hour runs long. */
  driftMs: number;
}

/** Enumerating removal subsets is exact but exponential; refuse rather than crawl. */
export const MAX_REMOVABLE = 12;

/**
 * Reachable totals from a closing pool, using at most `maxAdds` pieces.
 *
 * Distinct durations are what matter, not distinct songs: two songs of the same length
 * are interchangeable to the fit, and collapsing them keeps this linear in the library
 * rather than in its duplicates.
 */
export function buildReachable(units: FitUnit[], maxAdds: number, quantumMs = 100): ReachableIndex {
  const byDur = new Map<number, FitUnit>();
  for (const u of units) {
    const q = Math.round(u.durationMs / quantumMs);
    if (q > 0 && !byDur.has(q)) byDur.set(q, u);
  }
  // Sorted, and `units` is rebuilt in the SAME order below — the DP indexes both by the
  // same `di`, so any divergence silently reconstructs a different set of pieces than the
  // one whose total was chosen.
  const durations = Int32Array.from([...byDur.keys()].sort((a, b) => a - b));
  const sortedUnits = [...durations].map((d) => byDur.get(d)!);
  const pick = durations.length ? durations[durations.length - 1] : 0;
  const maxSum = pick * maxAdds;

  const witness: Int32Array[] = [];
  for (let k = 0; k <= maxAdds; k++) witness.push(new Int32Array(maxSum + 1).fill(-1));
  // k = 0 reaches only zero. Marked with -2 so "reachable" and "reached by a unit" differ.
  witness[0][0] = -2;

  const seen = new Uint8Array(maxSum + 1);
  seen[0] = 1;
  for (let k = 1; k <= maxAdds; k++) {
    for (let s = 0; s <= maxSum; s++) {
      if (witness[k - 1][s] === -1) continue;
      for (let di = 0; di < durations.length; di++) {
        const t = s + durations[di];
        if (t > maxSum) break; // durations are sorted, so everything after also overflows
        if (witness[k][t] === -1) { witness[k][t] = di; seen[t] = 1; }
      }
    }
  }

  const totals: number[] = [];
  for (let s = 0; s <= maxSum; s++) if (seen[s]) totals.push(s);
  return { totals: Int32Array.from(totals), witness, durations, units: sortedUnits, quantumMs, maxAdds };
}

/** Fewest pieces reaching this total, and the units making it up. */
function reconstruct(idx: ReachableIndex, total: number): FitUnit[] {
  for (let k = 0; k <= idx.maxAdds; k++) {
    if (idx.witness[k][total] === -1) continue;
    const out: FitUnit[] = [];
    let s = total;
    for (let kk = k; kk >= 1; kk--) {
      const di = idx.witness[kk][s];
      if (di < 0) break;
      out.push(idx.units[di]);
      s -= idx.durations[di];
    }
    return out;
  }
  return [];
}

/** Index of the largest total <= v, or -1. */
function floorIndex(totals: Int32Array, v: number): number {
  let lo = 0, hi = totals.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (totals[mid] <= v) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * Cost of landing at `lengthMs`.
 *
 * LEXICOGRAPHIC: clear the early bound first, then close on the target. The obvious
 * alternative — infinite cost outside the bound — is a trap, because an hour BEGINS
 * outside it (clocks are authored short). Everything then compares equal-infinite, no
 * move looks like an improvement, and the fit does nothing at all. Violation has to be
 * finite and ordered so that "less early than before" still reads as progress.
 */
function costOf(lengthMs: number, targetMs: number, earliestMs: number): number {
  return Math.max(0, earliestMs - lengthMs) * 1e6 + Math.abs(lengthMs - targetMs);
}

/**
 * Choose additions and sacrifices landing the hour as close to target as reachable.
 *
 * Exact over: every subset of `removable`, and every reachable total from the closing
 * pool. Removals are enumerated because a clock offers only a handful; additions come
 * from the precomputed index, so the per-hour work is a binary search per subset.
 */
export function fitHour(input: FitInput): FitResult {
  const { currentMs, targetMs, maxEarlyMs, removable, reachable } = input;
  if (removable.length > MAX_REMOVABLE) {
    throw new Error(`fitHour: ${removable.length} removable positions exceeds ${MAX_REMOVABLE}`);
  }
  const q = reachable.quantumMs;
  const earliestMs = targetMs - maxEarlyMs;

  let best: FitResult = { added: [], removed: [], lengthMs: currentMs, driftMs: currentMs - targetMs };
  let bestCost = costOf(currentMs, targetMs, earliestMs);

  const subsets = 1 << removable.length;
  for (let mask = 0; mask < subsets; mask++) {
    let cut = 0;
    for (let i = 0; i < removable.length; i++) if (mask & (1 << i)) cut += removable[i].durationMs;
    const base = currentMs - cut;
    const needQ = Math.round((targetMs - base) / q);

    // The best add-total is the reachable one nearest `needQ`; check both neighbours, and
    // the one above as well since landing early may be barred.
    const fi = floorIndex(reachable.totals, needQ);
    for (const ti of [fi, fi + 1, fi + 2]) {
      if (ti < 0 || ti >= reachable.totals.length) continue;
      const total = reachable.totals[ti];
      const lengthMs = base + total * q;
      const c = costOf(lengthMs, targetMs, earliestMs);
      if (c >= bestCost) continue;
      bestCost = c;
      best = {
        added: reconstruct(reachable, total),
        removed: removable.filter((_, i) => mask & (1 << i)),
        lengthMs,
        driftMs: lengthMs - targetMs,
      };
    }
  }
  return best;
}
