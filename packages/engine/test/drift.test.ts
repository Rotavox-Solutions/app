import { describe, expect, it } from "vitest";
import { generateLog } from "../src/index.js";
import { baseInput, category, position, song } from "./fixtures.js";
import type { EngineClock, GridSlot } from "../src/index.js";

/**
 * Signed top-of-hour drift.
 *
 * Hours are not independent: an hour that overruns does not move the next TOH, it eats
 * that hour's budget. The previous implementation carried only POSITIVE drift, on the
 * reasoning that an hour finishing early "is simply early". That inverts — if TOH airs at
 * :58, the next hour needs sixty-two minutes for the TOH after it to land at :00. Without
 * negative carry, early drift has no restoring force and accumulates unchecked.
 *
 * EVERY FIXTURE HERE USES NON-UNIFORM DURATIONS. On 2026-08-03 three filler bugs shipped
 * green because every synthetic song was exactly 200 000 ms; uniform durations make hour
 * arithmetic exact, which is precisely the condition under which drift never arises. A
 * fixture that cannot produce drift cannot test drift.
 */

/** Durations that do not divide the hour, so every hour ends somewhere awkward. */
const RAGGED = [187_000, 203_000, 211_000, 194_000, 226_000, 179_000, 241_000, 198_000];

function world(opts: { programmed: number; candidates?: number; hours: number; config?: object }) {
  const main = category({ id: "cat-main" });
  const filler = category({ id: "cat-filler" });
  const songs = [
    ...Array.from({ length: 60 }, (_, i) =>
      song({ rdjSongId: i + 1, categoryIds: ["cat-main"], durationMs: RAGGED[i % RAGGED.length] })
    ),
    ...Array.from({ length: 20 }, (_, i) =>
      song({ rdjSongId: 1000 + i, categoryIds: ["cat-filler"], durationMs: RAGGED[(i + 3) % RAGGED.length] })
    ),
  ];

  const positions = [];
  let sort = 1;
  for (let i = 0; i < opts.programmed; i++) positions.push(position({ sortOrder: sort++, categoryId: "cat-main" }));
  for (let i = 0; i < (opts.candidates ?? 0); i++) {
    positions.push(
      position({ sortOrder: sort++, categoryId: "cat-filler", constraints: { fillerPriority: i + 1 } })
    );
  }

  const clock: EngineClock = { id: "clock-1", name: "Test", positions };
  const grid: GridSlot[] = [];
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) grid.push({ dayOfWeek: d, hour: h, clockId: "clock-1" });

  return baseInput({
    clocks: [clock],
    grid,
    categories: [main, filler],
    songs,
    config: opts.config,
    horizonEnd: new Date(Date.UTC(2026, 6, 6, opts.hours)),
  });
}

/** Signed end-of-hour drift per nominal hour, ms. Positive = that hour ran long. */
function driftPerHour(res: ReturnType<typeof generateLog>, songMs: Map<number, number>): number[] {
  const byHour = new Map<string, { start: number; end: number }>();
  for (const it of res.items) {
    const key = it.nominalHour.toISOString();
    const t = it.projectedAirAt.getTime();
    const dur = it.rdjSongId != null ? (songMs.get(it.rdjSongId) ?? 0) : 0;
    const cur = byHour.get(key) ?? { start: t, end: t };
    cur.start = Math.min(cur.start, t);
    cur.end = Math.max(cur.end, t + dur);
    byHour.set(key, cur);
  }
  return [...byHour]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => v.end - (new Date(key).getTime() + 3_600_000));
}

const durationMap = (input: ReturnType<typeof world>) =>
  new Map(input.songs.map((s) => [s.rdjSongId, s.durationMs ?? 0]));

describe("signed top-of-hour drift", () => {
  it("tags every item with the nominal hour it belongs to", () => {
    const input = world({ programmed: 17, candidates: 2, hours: 6 });
    const res = generateLog(input);
    expect(res.items.length).toBeGreaterThan(0);
    for (const it of res.items) {
      expect(it.nominalHour).toBeInstanceOf(Date);
      // Nominal hours are exact hour boundaries; projected air times are not.
      expect(it.nominalHour.getTime() % 3_600_000).toBe(0);
    }
    expect(new Set(res.items.map((i) => i.nominalHour.toISOString())).size).toBe(6);
  });

  it("nominalHour survives early drift, where projectedAirAt would misattribute", () => {
    // With an early tolerance the first item of an hour can project BEFORE its own :00.
    // Bucketing on projectedAirAt would file it under the previous hour.
    const input = world({
      programmed: 15,
      candidates: 3,
      hours: 12,
      config: { maxEarlyDriftMs: 120_000 },
    });
    const res = generateLog(input);
    const early = res.items.filter((i) => i.projectedAirAt.getTime() < i.nominalHour.getTime());
    expect(early.length).toBeGreaterThan(0);
    for (const it of early) {
      // The item belongs to its own hour despite airing before that hour's :00.
      const byProjection = new Date(Math.floor(it.projectedAirAt.getTime() / 3_600_000) * 3_600_000);
      expect(byProjection.getTime()).toBeLessThan(it.nominalHour.getTime());
    }
  });

  it("late drift is carried into the next hour's budget", () => {
    // No filler candidates and a generous position count: hours run long and the debt
    // must reduce the following hour rather than moving the boundary.
    const input = world({ programmed: 19, hours: 8 });
    const res = generateLog(input);
    const drifts = driftPerHour(res, durationMap(input));
    // An uncorrected overrun would grow without bound; carried, it stays bounded.
    expect(Math.max(...drifts.map(Math.abs))).toBeLessThan(19 * 250_000);
  });

  it("early drift is NOT corrected when maxEarlyDriftMs is 0 (legacy behaviour)", () => {
    const input = world({ programmed: 10, hours: 6, config: { maxEarlyDriftMs: 0 } });
    const res = generateLog(input);
    // Every hour is far short and nothing pulls the schedule back, so each hour starts
    // at its own nominal :00 — the defect this option preserves for compatibility.
    for (const it of res.items) {
      expect(it.projectedAirAt.getTime()).toBeGreaterThanOrEqual(it.nominalHour.getTime());
    }
  });

  it("early drift IS corrected once a tolerance is allowed", () => {
    const input = world({ programmed: 10, hours: 6, config: { maxEarlyDriftMs: 120_000 } });
    const res = generateLog(input);
    const anyEarly = res.items.some((i) => i.projectedAirAt.getTime() < i.nominalHour.getTime());
    expect(anyEarly).toBe(true);
  });

  it("warns rather than silently discarding drift beyond the bound", () => {
    // Hours far too long for a 30s late bound: the clamp throws away real debt, and
    // that is a fact about the schedule the PD has to be told.
    const input = world({ programmed: 22, hours: 4, config: { maxLateDriftMs: 30_000 } });
    const res = generateLog(input);
    expect(res.warnings.some((w) => w.includes("exceeds the") && w.includes("discarded"))).toBe(true);
  });

  it("is deterministic across runs", () => {
    const a = generateLog(world({ programmed: 16, candidates: 3, hours: 10, config: { maxEarlyDriftMs: 60_000 } }));
    const b = generateLog(world({ programmed: 16, candidates: 3, hours: 10, config: { maxEarlyDriftMs: 60_000 } }));
    expect(a.items.map((i) => [i.rdjSongId, i.projectedAirAt.toISOString(), i.nominalHour.toISOString()]))
      .toEqual(b.items.map((i) => [i.rdjSongId, i.projectedAirAt.toISOString(), i.nominalHour.toISOString()]));
  });
});
