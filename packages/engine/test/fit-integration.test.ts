import { describe, expect, it } from "vitest";
import { generateLog } from "../src/generate.js";
import type { EngineClock, GridSlot } from "../src/types.js";
import { baseInput, category, position, song } from "./fixtures.js";

/**
 * The exact fit, reached through generateLog rather than called directly.
 *
 * fit.test.ts already proves fitHour is correct in isolation. It shipped in a6162ef and
 * was then reached only by tools/drift-curve.mts, so production kept landing hours with
 * the in-line ceil filler activation and overscheduled every hour it drew — measured on
 * air as 48 of 48 hours over, median 117s. These tests exist so that gap cannot reopen
 * silently: they assert properties only an exact fit can produce.
 */

const HOUR_MS = 3_600_000;

/**
 * A clock of `programmed` fixed-length positions plus `candidates` closing positions,
 * whose pool has the given duration spread.
 */
function world(opts: {
  programmed: number;
  programmedMs: number;
  candidates: number;
  closerDurationsMs: number[];
  hours?: number;
  trimmable?: number;
  /** Songs per distinct length. Real F carries 1-2; more clusters the shortlist. */
  songsPerDuration?: number;
}) {
  const main = category({ id: "cat-main" });
  const closer = category({ id: "cat-closer" });

  const songs = [
    ...Array.from({ length: 200 }, (_, i) =>
      song({ rdjSongId: 1000 + i, categoryIds: ["cat-main"], durationMs: opts.programmedMs })
    ),
    // ids INTERLEAVE the length groups. Clustering them means that when every closer
    // is equally rested -- which is most of the time, since the pool is deep and only
    // one or two air per hour -- the rest-ranked shortlist fills from one or two
    // adjacent groups and the fit is handed almost no duration spread at all.
    ...Array.from({ length: opts.songsPerDuration ?? 12 }, (_, rep) =>
      opts.closerDurationsMs.map((ms, di) =>
        song({
          rdjSongId: 5000 + rep * opts.closerDurationsMs.length + di,
          categoryIds: ["cat-closer"],
          durationMs: ms,
        })
      )
    ).flat(),
  ];

  const trimmable = opts.trimmable ?? 0;
  const positions = [
    ...Array.from({ length: opts.programmed }, (_, i) =>
      position({
        sortOrder: i + 1,
        categoryId: "cat-main",
        constraints: i >= opts.programmed - trimmable ? { trimPriority: i - (opts.programmed - trimmable) + 1 } : null,
      })
    ),
    ...Array.from({ length: opts.candidates }, (_, i) =>
      position({
        sortOrder: opts.programmed + i + 1,
        categoryId: "cat-closer",
        constraints: { fillerPriority: i + 1 },
      })
    ),
  ];

  const clock: EngineClock = { id: "clock-1", name: "Fit", positions };
  const grid: GridSlot[] = [];
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) grid.push({ dayOfWeek: d, hour: h, clockId: "clock-1" });

  return baseInput({
    clocks: [clock],
    grid,
    categories: [main, closer],
    songs,
    horizonEnd: new Date(Date.parse("2026-07-06T00:00:00.000Z") + (opts.hours ?? 1) * HOUR_MS),
  });
}

/** Signed landing error of each hour, in seconds: positive = the hour ran long. */
function landingErrors(res: ReturnType<typeof generateLog>, input: ReturnType<typeof world>): number[] {
  const durationById = new Map(input.songs.map((s) => [s.id, s.durationMs ?? 0]));
  const byHour = new Map<string, number>();
  for (const item of res.items) {
    const key = item.nominalHour.toISOString();
    byHour.set(key, (byHour.get(key) ?? 0) + (item.songId ? (durationById.get(item.songId) ?? 0) : 0));
  }
  return [...byHour.values()].map((ms) => (ms - HOUR_MS) / 1000);
}

/**
 * Signed TOH drift of each hour after the first, in seconds.
 *
 * This is the product metric, and it is NOT the same as an hour's content length. Carry
 * is deliberate: an hour that inherits +20s is TARGETED at 3580s, so measuring its
 * content against 3600 reports the carry it was asked to absorb rather than how well it
 * landed. What matters is where the top of the hour actually falls.
 */
function tohDrifts(res: ReturnType<typeof generateLog>): number[] {
  const firstByHour = new Map<string, number>();
  for (const item of res.items) {
    const key = item.nominalHour.toISOString();
    const t = item.projectedAirAt.getTime();
    if (!firstByHour.has(key) || t < firstByHour.get(key)!) firstByHour.set(key, t);
  }
  return [...firstByHour.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(1) // the first hour starts at its boundary by construction
    .map(([hour, first]) => (first - Date.parse(hour)) / 1000);
}

describe("the fit, as reached by generateLog", () => {
  it("lands an hour exactly when the closing pool can make change for the gap", () => {
    // 17 x 200s = 3400s, 200s short, and the pool holds a 200s piece. An exact fit
    // takes it and lands on the nose.
    const input = world({
      programmed: 17,
      programmedMs: 200_000,
      candidates: 3,
      closerDurationsMs: [200_000, 173_000, 241_000],
    });
    expect(landingErrors(generateLog(input), input)).toEqual([0]);
  });

  it("a varied closing pool lands closer than a uniform one — the change-making signature", () => {
    // Same gap, same slot count; only the SPREAD of available lengths differs. A
    // uniform pool can only land on multiples of its one length, so it cannot close a
    // gap that is not such a multiple. This is the property that distinguishes an
    // exact fit from any amount of filler counting, and it must survive the wiring.
    const gapArgs = { programmed: 17, programmedMs: 197_000, candidates: 3 };
    const uniform = world({ ...gapArgs, closerDurationsMs: [240_000] });
    const varied = world({ ...gapArgs, closerDurationsMs: [151_000, 178_000, 199_000, 217_000, 244_000] });

    const uniformErr = Math.abs(landingErrors(generateLog(uniform), uniform)[0]);
    const variedErr = Math.abs(landingErrors(generateLog(varied), varied)[0]);
    expect(variedErr).toBeLessThan(uniformErr);
  });

  it("holds precision across a full day rather than drifting", () => {
    // 24 consecutive hours. Carry means an error in one hour becomes the next one's
    // problem, so a fit that were merely good on average would still walk away.
    //
    // The closing pool mirrors the real F pool's SHAPE, because that is what sets the
    // achievable precision: 46 distinct lengths over 169-245s, whose largest interior
    // gap is 6s. A coarser fixture measures the fixture, not the fit — with only seven
    // lengths spread over the same span the p95 here is ~51s, which is the grid
    // spacing showing through rather than a defect.
    // 17 x 200s = 3400s, closed by one piece from [169s, 245s] => a reachable range of
    // [3569s, 3645s], which STRADDLES 3600. That matters more than pool size: a clock
    // whose maximum single-piece landing falls short of its own target (17 x 197s +
    // 245s = 3594s) can never land on time, and the carry then walks out to the bound
    // one hour at a time until a two-piece jump overshoots. That is a clock-authoring
    // fault, not a fit fault, and it is worth knowing the difference.
    const dense = Array.from({ length: 46 }, (_, i) => Math.round(169_000 + (i * 76_000) / 45));
    const input = world({
      programmed: 17,
      programmedMs: 200_000,
      candidates: 3,
      closerDurationsMs: dense,
      songsPerDuration: 2,
      hours: 24,
    });
    const errors = tohDrifts(generateLog(input)).map(Math.abs).sort((a, b) => a - b);
    const p95 = errors[Math.floor(errors.length * 0.95)];
    // a6162ef measured p95 6s at 5 candidates and ~0s at 25+ in simulation. Asserted as
    // an order of magnitude, not the exact figure: the shortlist is rest-ranked, so the
    // lengths actually on offer depend on rotation state rather than on the pool alone.
    expect(p95).toBeLessThanOrEqual(15);
    expect(errors[errors.length - 1]).toBeLessThanOrEqual(30);
  });

  it("combines a sacrifice with an addition when neither alone lands the hour", () => {
    // 20 x 200s = 4000s, 400s over. Giving up one 200s position leaves 200s over;
    // giving up two leaves it 0s over but the fit can do better by giving up two and
    // adding back a short closer. Either way it must both remove AND land close.
    const input = world({
      programmed: 20,
      programmedMs: 200_000,
      candidates: 2,
      closerDurationsMs: [151_000, 178_000, 199_000],
      trimmable: 4,
    });
    const res = generateLog(input);
    expect(res.stats.sacrificed).toBeGreaterThan(0);
    expect(Math.abs(landingErrors(res, input)[0])).toBeLessThanOrEqual(30);
  });

  it("declines to overschedule an hour that already lands", () => {
    // The old ceil path always took one more piece. Measured on air, that is what made
    // 48 hours in 48 run long.
    const input = world({
      programmed: 18,
      programmedMs: 200_000,
      candidates: 3,
      closerDurationsMs: [200_000, 173_000],
    });
    const res = generateLog(input);
    expect(res.stats.fillerActivated).toBe(0);
    expect(landingErrors(res, input)).toEqual([0]);
  });

  it("never lands earlier than maxEarlyDriftMs allows", () => {
    // Only long closers available against a small gap, so every addition overshoots.
    // The fit must take the overshoot rather than land outside the backward bound.
    const input = world({
      programmed: 17,
      programmedMs: 205_000,
      candidates: 3,
      closerDurationsMs: [240_000],
    });
    const err = landingErrors(generateLog(input), input)[0];
    expect(err).toBeGreaterThanOrEqual(-30);
  });

  it("stays deterministic under a seed once the fit is in the path", () => {
    const mk = () =>
      world({
        programmed: 17,
        programmedMs: 197_000,
        candidates: 3,
        closerDurationsMs: [151_000, 178_000, 199_000, 217_000],
        hours: 6,
      });
    const a = generateLog(mk());
    const b = generateLog(mk());
    expect(a.items.map((i) => `${i.sortOrder}:${i.rdjSongId}:${i.projectedAirAt.toISOString()}`)).toEqual(
      b.items.map((i) => `${i.sortOrder}:${i.rdjSongId}:${i.projectedAirAt.toISOString()}`)
    );
  });
});
