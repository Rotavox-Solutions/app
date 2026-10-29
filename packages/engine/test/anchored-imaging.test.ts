import { describe, expect, it } from "vitest";
import { generateLog } from "../src/generate.js";
import type { EngineClock, EnginePosition, GridSlot } from "../src/types.js";
import { baseInput, category, position, song } from "./fixtures.js";

/**
 * Imaging whose copy is about a neighbouring record (constraints.anchorSortOrder) must not
 * outlive that record. On air, 2026-10-29: the fit sacrificed FF's G2010 to land the hour,
 * and its "From the last decade" Gold 10s sweeper aired between a B and an N.
 */

// 20 x 200s of music is 4000s, 400s over. Only slot 11 is sacrificeable, so the fit
// must give it up. Slot 10 is era imaging about slot 11; slot 13 is era imaging about
// slot 14, which stays.
function world(anchored: boolean) {
  const cats = [
    category({ id: "cat-main" }),
    category({ id: "cat-gold" }),
    category({ id: "cat-era", kind: "imaging" }),
    category({ id: "cat-generic", kind: "imaging" }),
  ];
  const songs = [
    ...Array.from({ length: 60 }, (_, i) =>
      song({ rdjSongId: 100 + i, artist: `M${i}`, title: `m${i}`, categoryIds: ["cat-main"], durationMs: 200_000 })
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      song({ rdjSongId: 300 + i, artist: `G${i}`, title: `g${i}`, categoryIds: ["cat-gold"], durationMs: 200_000 })
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      song({ rdjSongId: 500 + i, songType: 2, title: `era ${i}`, categoryIds: ["cat-era"], durationMs: 3_000 })
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      song({ rdjSongId: 600 + i, songType: 2, title: `generic ${i}`, categoryIds: ["cat-generic"], durationMs: 3_000 })
    ),
  ];
  const era = (sortOrder: number, anchor: number): EnginePosition =>
    position({
      sortOrder,
      categoryId: "cat-era",
      positionType: "sweeper",
      constraints: { fallbackCategoryId: "cat-generic", ...(anchored ? { anchorSortOrder: anchor } : {}) },
    });
  const positions: EnginePosition[] = [];
  let n = 1;
  for (let i = 0; i < 22; i++) {
    if (n === 10) positions.push(era(n++, 11));
    else if (n === 11) positions.push(position({ sortOrder: n++, categoryId: "cat-gold", constraints: { trimPriority: 1 } }));
    else if (n === 13) positions.push(era(n++, 14));
    else if (n === 14) positions.push(position({ sortOrder: n++, categoryId: "cat-gold" }));
    else positions.push(position({ sortOrder: n++, categoryId: "cat-main" }));
  }
  const clock: EngineClock = { id: "clock-1", name: "Anchored", positions };
  const grid: GridSlot[] = [];
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) grid.push({ dayOfWeek: d, hour: h, clockId: "clock-1" });
  return { input: baseInput({ clocks: [clock], grid, categories: cats, songs, horizonEnd: new Date("2026-07-06T01:00:00.000Z") }), positions };
}

const pos = (positions: EnginePosition[], sortOrder: number) => positions.find((p) => p.sortOrder === sortOrder)!.id;
const poolOf = (input: ReturnType<typeof world>["input"], songId: string | null) =>
  input.songs.find((s) => s.id === songId)?.categoryIds[0];

describe("anchored imaging", () => {
  it("falls back to generic copy when the fit sacrifices the record it is about", () => {
    const { input, positions } = world(true);
    const res = generateLog(input);
    const ids = new Set(res.items.map((i) => i.clockPositionId));
    expect(ids.has(pos(positions, 11))).toBe(false); // the anchor was sacrificed

    const orphan = res.items.find((i) => i.clockPositionId === pos(positions, 10))!;
    expect(poolOf(input, orphan.songId)).toBe("cat-generic");
    expect(orphan.violations).toContainEqual({
      step: "fallback_category",
      detail: { fromCategoryId: "cat-era", toCategoryId: "cat-generic", anchorSacrificed: 11 },
    });
    expect(res.stats.anchorFallbacks).toBe(1);

    // imaging about a record that stayed keeps its own copy
    const kept = res.items.find((i) => i.clockPositionId === pos(positions, 13))!;
    expect(poolOf(input, kept.songId)).toBe("cat-era");
  });

  it("without an anchor the break keeps its copy: the bug this guards against", () => {
    const { input, positions } = world(false);
    const res = generateLog(input);
    expect(res.items.some((i) => i.clockPositionId === pos(positions, 11))).toBe(false);
    const orphan = res.items.find((i) => i.clockPositionId === pos(positions, 10))!;
    expect(poolOf(input, orphan.songId)).toBe("cat-era");
    expect(res.stats.anchorFallbacks).toBe(0);
  });

  it("never redraws a song another position already took this hour", () => {
    const { input, positions } = world(true);
    // one generic song only, already drawn by a third imaging position
    input.songs = input.songs.filter((s) => !s.categoryIds.includes("cat-generic") || s.rdjSongId === 600);
    input.clocks[0].positions.push(
      position({ sortOrder: 0, categoryId: "cat-generic", positionType: "sweeper" }) // first, so the over-long hour keeps it
    );
    const res = generateLog(input);
    const orphan = res.items.find((i) => i.clockPositionId === pos(positions, 10))!;
    const generic = res.items.filter((i) => poolOf(input, i.songId) === "cat-generic");
    expect(generic).toHaveLength(1);
    expect(poolOf(input, orphan.songId)).toBe("cat-era");
    expect(res.warnings.some((w) => w.includes("no usable fallback"))).toBe(true);
  });
});
