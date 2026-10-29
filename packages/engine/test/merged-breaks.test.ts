import { describe, expect, it } from "vitest";
import { generateLog } from "../src/generate.js";
import type { EngineClock, EnginePosition, GridSlot } from "../src/types.js";
import { baseInput, category, position, song } from "./fixtures.js";

/**
 * Two breaks never air back to back unless the clock puts them together. On air,
 * 2026-10-29: the fit gave up FF's G2010 and R3, the only records between a Front-sell and
 * a Back-sell, and the two sweepers played one after the other.
 */

type Slot = "music" | "trim" | "sweeper";

// Music is 200s a record. `layout` lists the clock in order; every "trim" is sacrificeable.
function world(layout: Slot[]) {
  const cats = [category({ id: "cat-main" }), category({ id: "cat-trim" }), category({ id: "cat-img", kind: "imaging" })];
  const songs = [
    ...Array.from({ length: 60 }, (_, i) =>
      song({ rdjSongId: 100 + i, artist: `M${i}`, title: `m${i}`, categoryIds: ["cat-main"], durationMs: 200_000 })
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      song({ rdjSongId: 300 + i, artist: `T${i}`, title: `t${i}`, categoryIds: ["cat-trim"], durationMs: 200_000 })
    ),
    ...Array.from({ length: 8 }, (_, i) =>
      song({ rdjSongId: 500 + i, songType: 2, title: `img ${i}`, categoryIds: ["cat-img"], durationMs: 3_000 })
    ),
  ];
  let trim = 1;
  const positions: EnginePosition[] = layout.map((kind, i) =>
    kind === "sweeper"
      ? position({ sortOrder: i + 1, categoryId: "cat-img", positionType: "sweeper" })
      : kind === "trim"
        ? position({ sortOrder: i + 1, categoryId: "cat-trim", constraints: { trimPriority: trim++ } })
        : position({ sortOrder: i + 1, categoryId: "cat-main" })
  );
  const clock: EngineClock = { id: "clock-1", name: "Breaks", positions };
  const grid: GridSlot[] = [];
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) grid.push({ dayOfWeek: d, hour: h, clockId: "clock-1" });
  const input = baseInput({ clocks: [clock], grid, categories: cats, songs, horizonEnd: new Date("2026-07-06T01:00:00.000Z") });
  return { input, slot: (n: number) => positions[n - 1].id };
}

const music = (n: number): Slot[] => Array.from({ length: n }, () => "music");

describe("merged breaks", () => {
  it("drops the later break when the fit gives up every record between two breaks", () => {
    // 20 records (4000s) is 400s over: the fit gives up both trims, slots 12 and 13.
    const { input, slot } = world([...music(10), "sweeper", "trim", "trim", "sweeper", ...music(8)]);
    const res = generateLog(input);
    const ids = res.items.map((i) => i.clockPositionId);
    expect(ids).not.toContain(slot(12));
    expect(ids).not.toContain(slot(13));
    expect(ids).toContain(slot(11)); // the first break stays
    expect(ids).not.toContain(slot(14));
    expect(res.stats.mergedBreaks).toBe(1);
    // and nowhere in the hour do two sweepers touch
    res.items.forEach((item, i) => {
      if (i > 0) expect(item.elementType === "sweeper" && res.items[i - 1].elementType === "sweeper").toBe(false);
    });
  });

  it("keeps both breaks when a record still sits between them", () => {
    // Only one trim is given up (200s over); slot 14's record still separates the breaks.
    const { input, slot } = world([...music(9), "sweeper", "trim", ...music(1), "sweeper", ...music(8)]);
    const res = generateLog(input);
    const ids = res.items.map((i) => i.clockPositionId);
    expect(ids).not.toContain(slot(11));
    expect(ids).toContain(slot(10));
    expect(ids).toContain(slot(13));
    expect(res.stats.mergedBreaks).toBe(0);
  });

  it("leaves breaks the clock itself places together", () => {
    const { input, slot } = world([...music(5), "sweeper", "sweeper", ...music(12)]);
    const res = generateLog(input);
    const ids = res.items.map((i) => i.clockPositionId);
    expect(ids).toContain(slot(6));
    expect(ids).toContain(slot(7));
    expect(res.stats.mergedBreaks).toBe(0);
  });
});
