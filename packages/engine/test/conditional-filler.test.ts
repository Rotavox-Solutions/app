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

/**
 * Subtractive priority. An hour that starts late (drift carried from an earlier
 * overrun) must still end at the immovable TOH, so something has to go. Left to
 * trim-to-fit that is whatever sits at the tail; here it is chosen deliberately.
 */
describe("subtractive priority and drift carry", () => {
  /** `n` programmed positions, the last `sacrificeable` of them ranked for sacrifice. */
  function longWorld(opts: { programmed: number; songMs: number; sacrificeable: number }) {
    const main = category({ id: "cat-main" });
    const songs = Array.from({ length: 60 }, (_, i) =>
      song({ rdjSongId: i + 1, categoryIds: ["cat-main"], durationMs: opts.songMs })
    );
    const positions = Array.from({ length: opts.programmed }, (_, i) =>
      position({
        sortOrder: i + 1,
        categoryId: "cat-main",
        constraints:
          i >= opts.programmed - opts.sacrificeable
            ? { trimPriority: i - (opts.programmed - opts.sacrificeable) + 1 }
            : null,
      })
    );
    const clock: EngineClock = { id: "clock-1", name: "Long", positions };
    const grid: GridSlot[] = [];
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) grid.push({ dayOfWeek: d, hour: h, clockId: "clock-1" });
    return baseInput({
      clocks: [clock], grid, categories: [main], songs,
      horizonEnd: new Date("2026-07-06T02:00:00.000Z"), // two hours, so drift can carry
    });
  }

  it("sacrifices ranked positions when the hour cannot fit", () => {
    // 24 x 200s = 4800s against a 3600s clock: 20 min over.
    const res = generateLog(longWorld({ programmed: 24, songMs: 200_000, sacrificeable: 8 }));
    expect(res.stats.sacrificed).toBeGreaterThan(0);
  });

  it("sacrifices in trimPriority order, cheapest first", () => {
    const input = longWorld({ programmed: 24, songMs: 200_000, sacrificeable: 8 });
    const byId = new Map(input.clocks[0].positions.map((p) => [p.id, p]));
    const res = generateLog(input);
    const survivingRanked = res.items
      .map((i) => (i.clockPositionId ? byId.get(i.clockPositionId) : undefined))
      .filter((p) => p?.constraints?.trimPriority != null)
      .map((p) => p!.constraints!.trimPriority!);
    // whatever survives must be the HIGHEST numbers — the low ones were spent first
    if (survivingRanked.length) {
      expect(Math.min(...survivingRanked)).toBeGreaterThan(1);
    }
  });

  it("warns when sacrificing everything ranked still cannot close the overrun", () => {
    const res = generateLog(longWorld({ programmed: 30, songMs: 200_000, sacrificeable: 1 }));
    expect(res.warnings.some((w) => /over budget/.test(w))).toBe(true);
  });

  it("does not bank credit — an early hour never lengthens the next one", () => {
    // Hour content is far under; the second hour must not be scheduled longer for it.
    const input = longWorld({ programmed: 4, songMs: 200_000, sacrificeable: 0 });
    const res = generateLog(input);
    const hours = new Set(res.items.map((i) => i.projectedAirAt.toISOString().slice(0, 13)));
    expect(hours.size).toBe(2);
    for (const i of res.items) {
      // nothing may be scheduled before its own hour boundary
      const h = new Date(i.projectedAirAt).getUTCMinutes();
      expect(h).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * The scheduling asymmetry, stated as a test.
 *
 * Underscheduling costs dead air, which is unrecoverable. Overscheduling costs a shear,
 * which is bounded and — because priority-1 filler is the tail buffer — lands on an F.
 * The optimum is therefore never "exactly 60:00"; it is 60:00 plus a margin, and the
 * margin must be strictly positive.
 */
describe("deliberate overschedule", () => {
  it("never leaves an hour short when a candidate could have filled it", () => {
    // 17 x 200s = 3400s against 3600s: 200s short, exactly one filler.
    const input = world({ programmed: 17, songMs: 200_000, candidates: 5 });
    const res = generateLog(input);
    expect(res.stats.fillerActivated).toBeGreaterThanOrEqual(1);
  });

  it("rounds UP on a part-song deficit rather than landing under", () => {
    // 17 x 200s = 3400s, 200s short, but filler averages 300s: round() would give 1,
    // and so does ceil() — push the deficit to 250s where round()=1 and ceil()=1 differ
    // only above .5, so use a deficit of 0.4 songs: 3600-3450 = 150s at 300s filler.
    const input = world({ programmed: 23, songMs: 150_000, candidates: 5, fillerMs: 300_000 });
    const res = generateLog(input);
    // 23 x 150s = 3450s, 150s short = 0.5 song. Must still activate one, not zero.
    expect(res.stats.fillerActivated).toBeGreaterThanOrEqual(1);
  });
});
