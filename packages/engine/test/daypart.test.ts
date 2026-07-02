import { describe, expect, it } from "vitest";
import { generateLog } from "../src/index.js";
import type { EngineClock } from "../src/index.js";
import { baseInput, category, position, rule, song } from "./fixtures.js";

describe("daypart + max_per_hour evaluate at projected air time", () => {
  it("does not leak a daypart-restricted song past its boundary when the clock overruns", () => {
    // One long filler (55 min) pushes the hour's later slots past the 21:xx→22:00
    // boundary. 'Restricted' songs are only allowed hours 6..21; the slot that
    // projects into 22:0x must exclude them even though it belongs to the 21:00 clock.
    const restricted = category({ id: "cat-restricted" });
    const filler = category({ id: "cat-filler" });
    const clock: EngineClock = {
      id: "clock-1",
      name: "Overrun Hour",
      positions: [
        position({ sortOrder: 1, categoryId: "cat-filler" }), // 55-min song → next slot lands 21:55
        position({ sortOrder: 2, categoryId: "cat-filler" }), // 8-min song → next slot lands 22:03
        position({ sortOrder: 3, categoryId: "cat-restricted" }), // projects 22:03 — restricted must not appear
      ],
    };
    const input = baseInput({
      horizonStart: new Date("2026-07-06T21:00:00.000Z"),
      horizonEnd: new Date("2026-07-06T22:00:00.000Z"),
      categories: [restricted, filler],
      clocks: [clock],
      songs: [
        song({ rdjSongId: 1, durationMs: 55 * 60_000, categoryIds: ["cat-filler"], artist: "F1" }),
        song({ rdjSongId: 2, durationMs: 8 * 60_000, categoryIds: ["cat-filler"], artist: "F2" }),
        song({ rdjSongId: 10, categoryIds: ["cat-restricted"], artist: "R1" }),
        song({ rdjSongId: 11, categoryIds: ["cat-restricted"], artist: "R2" }),
      ],
      rules: [
        rule({
          id: "r-daypart",
          ruleType: "daypart_restrict",
          scope: "category",
          scopeRef: "cat-restricted",
          params: { hours: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21] },
        }),
      ],
    });
    const result = generateLog(input);
    const third = result.items[2];
    expect(third.projectedAirAt.getUTCHours()).toBe(22); // slot really overran
    // Restricted songs are ineligible at 22:03 — daypart holds through last_resort,
    // so the position is unfillable rather than leaking a restricted song.
    expect([10, 11]).not.toContain(third.rdjSongId);
    expect(third.violations.some((v) => v.step === "unfillable")).toBe(true);
  });

  it("allows the same song at a slot projecting inside its daypart", () => {
    const restricted = category({ id: "cat-restricted" });
    const clock: EngineClock = {
      id: "clock-1",
      name: "Simple",
      positions: [position({ sortOrder: 1, categoryId: "cat-restricted" })],
    };
    const input = baseInput({
      horizonStart: new Date("2026-07-06T21:00:00.000Z"),
      horizonEnd: new Date("2026-07-06T22:00:00.000Z"),
      categories: [restricted],
      clocks: [clock],
      songs: [song({ rdjSongId: 10, categoryIds: ["cat-restricted"] })],
      rules: [
        rule({
          id: "r-daypart",
          ruleType: "daypart_restrict",
          scope: "category",
          scopeRef: "cat-restricted",
          params: { hours: [21] },
        }),
      ],
    });
    const result = generateLog(input);
    expect(result.items[0].rdjSongId).toBe(10);
    expect(result.items[0].violations).toEqual([]);
  });

  it("buckets max_per_hour by projected air hour, enforced station-wide across pools", () => {
    // Cap cat-capped at 1/hour. The clock pulls from a parent pool containing both
    // capped and free songs; two hours ⇒ capped songs can appear at most once per
    // projected hour, even entering via the parent pool.
    const parent = category({ id: "cat-parent" });
    const capped = category({ id: "cat-capped", parentId: "cat-parent" });
    const free = category({ id: "cat-free", parentId: "cat-parent" });
    const clock: EngineClock = {
      id: "clock-1",
      name: "Cap Hour",
      positions: [1, 2, 3, 4].map((n) => position({ sortOrder: n, categoryId: "cat-parent" })),
    };
    const input = baseInput({
      horizonStart: new Date("2026-07-06T00:00:00.000Z"),
      horizonEnd: new Date("2026-07-06T02:00:00.000Z"),
      categories: [parent, capped, free],
      clocks: [clock],
      songs: [
        song({ rdjSongId: 1, categoryIds: ["cat-capped"], artist: "C1" }),
        song({ rdjSongId: 2, categoryIds: ["cat-capped"], artist: "C2" }),
        song({ rdjSongId: 3, categoryIds: ["cat-free"], artist: "F1" }),
        song({ rdjSongId: 4, categoryIds: ["cat-free"], artist: "F2" }),
        song({ rdjSongId: 5, categoryIds: ["cat-free"], artist: "F3" }),
        song({ rdjSongId: 6, categoryIds: ["cat-free"], artist: "F4" }),
        song({ rdjSongId: 7, categoryIds: ["cat-free"], artist: "F5" }),
        song({ rdjSongId: 8, categoryIds: ["cat-free"], artist: "F6" }),
      ],
      rules: [
        rule({ id: "r-artist", ruleType: "artist_separation", params: { minMinutes: 10 } }),
        rule({
          id: "r-cap",
          ruleType: "max_per_hour",
          scope: "category",
          scopeRef: "cat-capped",
          params: { count: 1 },
        }),
      ],
    });
    const result = generateLog(input);
    const cappedPerHour = new Map<number, number>();
    for (const item of result.items) {
      if (item.rdjSongId === 1 || item.rdjSongId === 2) {
        if (item.violations.some((v) => v.step === "last_resort")) continue; // cap dropped only at last resort
        const h = item.projectedAirAt.getUTCHours();
        cappedPerHour.set(h, (cappedPerHour.get(h) ?? 0) + 1);
      }
    }
    for (const [, n] of cappedPerHour) expect(n).toBeLessThanOrEqual(1);
  });
});
