import { describe, expect, it } from "vitest";
import { generateLog } from "../src/index.js";
import { baseInput, position, rule, song } from "./fixtures.js";

function sequence(result: ReturnType<typeof generateLog>): string {
  return JSON.stringify(result.items.map((i) => [i.sortOrder, i.rdjSongId, i.projectedAirAt.getTime()]));
}

describe("determinism under logs.seed", () => {
  it("same input + same seed ⇒ byte-identical item sequence", () => {
    const a = generateLog(baseInput({ seed: "alpha" }));
    const b = generateLog(baseInput({ seed: "alpha" }));
    expect(sequence(a)).toBe(sequence(b));
  });

  it("stays aligned when the ladder fires mid-run (RNG stream survives rung-varying paths)", () => {
    // The whole pool shares one artist: after the first placement every subsequent
    // slot within the 45-min window must walk the ladder (typically to last_resort),
    // and the run must still be reproducible end to end.
    const mixed = baseInput({
      seed: "ladder-mix",
      songs: [
        song({ rdjSongId: 1, artist: "Same", categoryIds: ["cat-main"] }),
        song({ rdjSongId: 2, artist: "Same", categoryIds: ["cat-main"] }),
        song({ rdjSongId: 3, artist: "Same", categoryIds: ["cat-main"] }),
      ],
      horizonEnd: new Date("2026-07-06T03:00:00.000Z"),
    });
    const a = generateLog(mixed);
    const b = generateLog(structuredClone(mixed));
    expect(a.items.some((i) => i.violations.length > 0)).toBe(true); // ladder actually fired
    expect(sequence(a)).toBe(sequence(b));
  });

  it("different seed ⇒ different sequence (jitter > 0, K > 1)", () => {
    // 24 hours of 3-position clocks over 12 songs — plenty of picks for divergence.
    const a = generateLog(baseInput({ seed: "seed-one", horizonEnd: new Date("2026-07-07T00:00:00.000Z") }));
    const b = generateLog(baseInput({ seed: "seed-two", horizonEnd: new Date("2026-07-07T00:00:00.000Z") }));
    expect(sequence(a)).not.toBe(sequence(b));
  });

  it("last_resort consumes no RNG (verified via unchanged downstream picks)", () => {
    // Two runs: one where slot 1 is unfillable-with-last-resort, one where slot 1
    // is removed entirely. The downstream slots see identical RNG state, so with
    // the same seed they must pick identically.
    const twoSlot = baseInput({
      seed: "no-rng",
      songs: [
        song({ rdjSongId: 1, artist: "Same", categoryIds: ["cat-main"] }),
        song({ rdjSongId: 2, artist: "Same", categoryIds: ["cat-main"] }),
        ...Array.from({ length: 8 }, (_, i) => song({ rdjSongId: 10 + i, categoryIds: ["cat-free"] })),
      ],
      categories: [
        { id: "cat-main", name: "m", kind: "music", parentId: null, defaultTargetTurnoverHours: null },
        { id: "cat-free", name: "f", kind: "music", parentId: null, defaultTargetTurnoverHours: null },
      ],
      history: [
        // artist gap at 00:00 is 5 min — blocked even at the ×0.25 shrink (11.25 min),
        // so the slot must fall through to last_resort
        { rdjSongId: 1, artist: "Same", title: "Title 1", airedAt: new Date("2026-07-05T23:00:00.000Z") },
        { rdjSongId: 2, artist: "Same", title: "Title 2", airedAt: new Date("2026-07-05T23:55:00.000Z") },
      ],
      horizonEnd: new Date("2026-07-06T01:00:00.000Z"),
      clocks: [
        {
          id: "clock-1",
          name: "LR then free",
          positions: [
            position({ sortOrder: 1, categoryId: "cat-main" }), // forced last_resort (artist self-blocked)
            position({ sortOrder: 2, categoryId: "cat-free" }),
            position({ sortOrder: 3, categoryId: "cat-free" }),
          ],
        },
      ],
    });
    const withLr = generateLog(twoSlot);
    expect(withLr.items[0].violations.some((v) => v.step === "last_resort")).toBe(true);

    const withoutFirst = structuredClone(twoSlot);
    withoutFirst.clocks[0].positions = withoutFirst.clocks[0].positions.slice(1);
    const skipped = generateLog(withoutFirst);

    // Downstream picks identical ⇒ the last_resort slot consumed zero draws.
    expect(withLr.items.slice(1).map((i) => i.rdjSongId)).toEqual(skipped.items.map((i) => i.rdjSongId));
  });
});
