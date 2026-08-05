import { describe, expect, it } from "vitest";
import { buildReachable, fitHour, type FitUnit } from "../src/fit.js";

const units = (durs: number[], cat = "F"): FitUnit[] =>
  durs.map((d, i) => ({ id: `${cat}-${i}`, durationMs: d, categoryId: cat }));

const HOUR = 3_600_000;

describe("fitHour", () => {
  it("closes a gap exactly when the pool can make change for it", () => {
    // 200s + 150s = 350s exactly.
    const r = buildReachable(units([200_000, 150_000, 175_000]), 4);
    const res = fitHour({
      currentMs: HOUR - 350_000,
      targetMs: HOUR,
      maxEarlyMs: 60_000,
      removable: [],
      reachable: r,
    });
    expect(res.driftMs).toBe(0);
    expect(res.added.reduce((a, u) => a + u.durationMs, 0)).toBe(350_000);
  });

  it("a pool of one length can only land on multiples of it", () => {
    // Every piece is 200s and the gap is 350s: 200 leaves -150, 400 leaves +50.
    // +50 is nearer, so that is the landing. This is the five-dollar-bills case.
    const r = buildReachable(units([200_000]), 4);
    const res = fitHour({
      currentMs: HOUR - 350_000,
      targetMs: HOUR,
      maxEarlyMs: 60_000,
      removable: [],
      reachable: r,
    });
    expect(res.driftMs).toBe(50_000);
    expect(res.added).toHaveLength(2);
  });

  it("a varied pool beats a uniform one on the same gap", () => {
    const uniform = buildReachable(units([200_000]), 4);
    const varied = buildReachable(units([160_000, 175_000, 190_000, 205_000, 220_000, 245_000]), 4);
    const ask = { currentMs: HOUR - 337_000, targetMs: HOUR, maxEarlyMs: 60_000, removable: [] };
    const a = fitHour({ ...ask, reachable: uniform });
    const b = fitHour({ ...ask, reachable: varied });
    expect(Math.abs(b.driftMs)).toBeLessThan(Math.abs(a.driftMs));
  });

  it("respects the early bound, landing late rather than too early", () => {
    const r = buildReachable(units([200_000]), 4);
    // Gap 350s. Landing at -150s is nearer, but the bound forbids anything before -60s.
    const res = fitHour({
      currentMs: HOUR - 350_000,
      targetMs: HOUR,
      maxEarlyMs: 0,
      removable: [],
      reachable: r,
    });
    expect(res.driftMs).toBeGreaterThanOrEqual(0);
  });

  it("gives up a position when that lands closer than any addition", () => {
    const r = buildReachable(units([200_000]), 3);
    // The hour is 120s long. No addition helps; dropping the 120s position lands it exactly.
    const res = fitHour({
      currentMs: HOUR + 120_000,
      targetMs: HOUR,
      maxEarlyMs: 60_000,
      removable: units([120_000], "G1990"),
      reachable: r,
    });
    expect(res.driftMs).toBe(0);
    expect(res.removed).toHaveLength(1);
  });

  it("combines a removal with an addition when neither alone suffices", () => {
    const r = buildReachable(units([200_000]), 3);
    // 260s long. Drop 460s, add 200s → exact. Greedy single-step logic cannot see this.
    const res = fitHour({
      currentMs: HOUR + 260_000,
      targetMs: HOUR,
      maxEarlyMs: 60_000,
      removable: units([460_000], "G1990"),
      reachable: r,
    });
    expect(res.driftMs).toBe(0);
    expect(res.removed).toHaveLength(1);
    expect(res.added).toHaveLength(1);
  });

  it("takes pieces from several categories in one fit", () => {
    const pool = [...units([200_000], "F"), ...units([137_000], "Discovery")];
    const r = buildReachable(pool, 4);
    const res = fitHour({
      currentMs: HOUR - 337_000,
      targetMs: HOUR,
      maxEarlyMs: 60_000,
      removable: [],
      reachable: r,
    });
    expect(res.driftMs).toBe(0);
    expect(new Set(res.added.map((u) => u.categoryId))).toEqual(new Set(["F", "Discovery"]));
  });

  it("does nothing when the hour already lands", () => {
    const r = buildReachable(units([200_000]), 4);
    const res = fitHour({ currentMs: HOUR, targetMs: HOUR, maxEarlyMs: 60_000, removable: [], reachable: r });
    expect(res.added).toHaveLength(0);
    expect(res.removed).toHaveLength(0);
    expect(res.driftMs).toBe(0);
  });

  it("never exceeds the authored slot count", () => {
    const r = buildReachable(units([200_000]), 2);
    const res = fitHour({
      currentMs: HOUR - 1_200_000, // 20 min short; 6 pieces would be needed, only 2 allowed
      targetMs: HOUR,
      maxEarlyMs: 600_000,
      removable: [],
      reachable: r,
    });
    expect(res.added.length).toBeLessThanOrEqual(2);
  });

  /**
   * THE INVARIANT THAT CAUGHT THE ORIGINAL BUG.
   *
   * Widening the early tolerance only ever ADDS permitted landings, so the best reachable
   * landing can never get worse. A greedy fit violates this — drift-curve's did, and its
   * error rose with tolerance, which is what exposed it.
   */
  it("error is monotone non-increasing in the early tolerance", () => {
    const r = buildReachable(units([169_000, 187_000, 198_000, 214_000, 235_000, 273_000]), 5);
    const gaps = [37_000, 122_000, 260_000, 344_000, 411_000, 505_000, 88_000, 199_000];
    let prev = Array(gaps.length).fill(Infinity);
    for (const tol of [0, 15_000, 30_000, 60_000, 90_000, 120_000, 240_000]) {
      const errs = gaps.map((g) =>
        Math.abs(
          fitHour({
            currentMs: HOUR - g,
            targetMs: HOUR,
            maxEarlyMs: tol,
            removable: units([204_000, 249_000], "G1990"),
            reachable: r,
          }).driftMs
        )
      );
      for (let i = 0; i < errs.length; i++) expect(errs[i]).toBeLessThanOrEqual(prev[i]);
      prev = errs;
    }
  });

  it("is exact: no reachable landing beats the one chosen", () => {
    const durs = [169_000, 198_000, 235_000];
    const r = buildReachable(units(durs), 3);
    const removable = units([204_000], "G1990");
    for (const gap of [50_000, 150_000, 250_000, 350_000, 450_000, -80_000]) {
      const input = { currentMs: HOUR - gap, targetMs: HOUR, maxEarlyMs: 45_000, removable, reachable: r };
      const got = fitHour(input);
      // Brute force every combination the fit was allowed to consider.
      let bestErr = Infinity;
      for (const cut of [0, removable[0].durationMs]) {
        for (let a = 0; a <= 3; a++) {
          const combos = (n: number): number[] =>
            n === 0 ? [0] : combos(n - 1).flatMap((s) => durs.map((d) => s + d));
          for (const add of combos(a)) {
            const len = HOUR - gap - cut + add;
            if (len < HOUR - 45_000) continue;
            bestErr = Math.min(bestErr, Math.abs(len - HOUR));
          }
        }
      }
      expect(Math.abs(got.driftMs)).toBeCloseTo(bestErr, -2);
    }
  });
});
