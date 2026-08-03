import { describe, expect, it } from "vitest";
import { generateLog } from "../src/index.js";
import { baseInput, category, position, song } from "./fixtures.js";
import type { EngineClock, GridSlot } from "../src/index.js";

/**
 * Conditional filler: clocks are authored to a position COUNT, but songs vary in length,
 * so an hour's real duration is only known at generation. Candidates are pre-placed at
 * spread positions and ranked; the generator activates as many as the deficit needs.
 *
 * They must resolve at generation, never at playout — the log is the artifact the PD
 * approves, and filler chosen by the pacer is intent decided past the point of review.
 */

/** `programmed` positions of `songMs`, plus `candidates` ranked filler slots between them. */
function world(opts: { programmed: number; songMs: number; candidates: number; fillerMs?: number }) {
  const main = category({ id: "cat-main" });
  const filler = category({ id: "cat-filler" });
  const songs = [
    ...Array.from({ length: 40 }, (_, i) =>
      song({ rdjSongId: i + 1, categoryIds: ["cat-main"], durationMs: opts.songMs })
    ),
    ...Array.from({ length: 20 }, (_, i) =>
      song({ rdjSongId: 1000 + i, categoryIds: ["cat-filler"], durationMs: opts.fillerMs ?? 200_000 })
    ),
  ];

  // Interleave so candidates are genuinely spread, as clock-order.mjs emits them.
  const positions = [];
  let sort = 1;
  const every = Math.max(1, Math.floor(opts.programmed / (opts.candidates + 1)));
  let placed = 0;
  for (let i = 0; i < opts.programmed; i++) {
    positions.push(position({ sortOrder: sort++, categoryId: "cat-main" }));
    if (placed < opts.candidates && (i + 1) % every === 0) {
      positions.push(
        position({
          sortOrder: sort++,
          categoryId: "cat-filler",
          constraints: { fillerPriority: placed + 1 },
        })
      );
      placed++;
    }
  }
  while (placed < opts.candidates) {
    positions.push(
      position({ sortOrder: sort++, categoryId: "cat-filler", constraints: { fillerPriority: placed + 1 } })
    );
    placed++;
  }

  const clock: EngineClock = { id: "clock-1", name: "Test", positions };
  const grid: GridSlot[] = [];
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) grid.push({ dayOfWeek: d, hour: h, clockId: "clock-1" });

  return baseInput({
    clocks: [clock],
    grid,
    categories: [main, filler],
    songs,
    horizonEnd: new Date("2026-07-06T01:00:00.000Z"), // exactly one hour
  });
}

const fillerCount = (items: { clockPositionId: string | null }[], input: ReturnType<typeof world>) => {
  const fillerIds = new Set(
    input.clocks[0].positions.filter((p) => p.constraints?.fillerPriority != null).map((p) => p.id)
  );
  return items.filter((i) => i.clockPositionId && fillerIds.has(i.clockPositionId)).length;
};

describe("conditional filler", () => {
  it("activates none when the programmed hour already fills the clock", () => {
    // 18 x 200s = 3600s exactly.
    const input = world({ programmed: 18, songMs: 200_000, candidates: 5 });
    const res = generateLog(input);
    expect(fillerCount(res.items, input)).toBe(0);
    expect(res.stats.fillerActivated).toBe(0);
  });

  it("activates enough candidates to close a real deficit", () => {
    // 12 x 200s = 2400s, 20 min short. At 200s filler that is ~6 songs, capped at 5.
    const input = world({ programmed: 12, songMs: 200_000, candidates: 5 });
    const res = generateLog(input);
    expect(fillerCount(res.items, input)).toBe(5);
    expect(res.stats.fillerActivated).toBe(5);
  });

  it("activates proportionally — a small deficit takes few candidates", () => {
    // 16 x 200s = 3200s, 400s short => ~2 filler at 200s each.
    const input = world({ programmed: 16, songMs: 200_000, candidates: 5 });
    const res = generateLog(input);
    const n = fillerCount(res.items, input);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(3);
    expect(res.stats.fillerActivated).toBe(n);
  });

  it("activates in PRIORITY order, so placement stays spread", () => {
    const input = world({ programmed: 16, songMs: 200_000, candidates: 5 });
    const res = generateLog(input);
    const byId = new Map(input.clocks[0].positions.map((p) => [p.id, p]));
    const used = res.items
      .map((i) => (i.clockPositionId ? byId.get(i.clockPositionId) : undefined))
      .filter((p) => p?.constraints?.fillerPriority != null)
      .map((p) => p!.constraints!.fillerPriority!);
    // whatever the count, it must be the top-N prefix: 1, then 2, then 3 ...
    expect(used.sort((a, b) => a - b)).toEqual(used.map((_, i) => i + 1).sort((a, b) => a - b));
  });

  it("warns when the clock has too few candidates to close the deficit", () => {
    // 6 x 200s = 1200s: 40 min short, only 2 candidates authored.
    const input = world({ programmed: 6, songMs: 200_000, candidates: 2 });
    const res = generateLog(input);
    expect(res.warnings.some((w) => /filler candidate/.test(w))).toBe(true);
  });

  it("leaves clocks with no candidates completely unchanged", () => {
    const input = world({ programmed: 12, songMs: 200_000, candidates: 0 });
    const res = generateLog(input);
    expect(res.stats.fillerActivated).toBe(0);
    expect(res.items.length).toBeGreaterThan(0);
  });
});
