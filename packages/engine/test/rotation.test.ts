import { describe, expect, it } from "vitest";
import { generateLog, weekInCycle } from "../src/index.js";
import type { EngineClock, GridSlot } from "../src/index.js";
import { baseInput, category, position, song } from "./fixtures.js";

describe("rotation (week-in-cycle format grid)", () => {
  const tz = "UTC";
  const epoch = new Date("2026-07-05T00:00:00.000Z"); // a Sunday

  it("counts whole local weeks from the epoch, wrapping at cycleWeeks", () => {
    const w = (iso: string) => weekInCycle(new Date(iso), epoch, 5, tz);
    expect(w("2026-07-05T00:00:00.000Z")).toBe(0);
    expect(w("2026-07-11T23:00:00.000Z")).toBe(0); // Saturday — still week 0
    expect(w("2026-07-12T00:00:00.000Z")).toBe(1); // next Sunday rolls the cycle
    expect(w("2026-07-19T00:00:00.000Z")).toBe(2);
    expect(w("2026-08-09T00:00:00.000Z")).toBe(0); // exactly 5 weeks later → wraps to 0
    // Rotation disabled (cycleWeeks ≤ 1) always resolves to week 0.
    expect(weekInCycle(new Date("2026-07-12T00:00:00.000Z"), epoch, 1, tz)).toBe(0);
  });

  it("resolves different clocks for the same dow/hour across cycle weeks", () => {
    const catA = category({ id: "cat-a" });
    const catB = category({ id: "cat-b" });
    const clockA: EngineClock = {
      id: "A",
      name: "A",
      positions: [position({ sortOrder: 1, categoryId: "cat-a" })],
    };
    const clockB: EngineClock = {
      id: "B",
      name: "B",
      positions: [position({ sortOrder: 1, categoryId: "cat-b" })],
    };
    const grid: GridSlot[] = [];
    for (let d = 0; d < 7; d++)
      for (let h = 0; h < 24; h++) {
        grid.push({ weekInCycle: 0, dayOfWeek: d, hour: h, clockId: "A" });
        grid.push({ weekInCycle: 1, dayOfWeek: d, hour: h, clockId: "B" });
      }
    const common = {
      timezone: tz,
      cycleWeeks: 2,
      cycleEpoch: epoch,
      clocks: [clockA, clockB],
      grid,
      categories: [catA, catB],
      songs: [song({ rdjSongId: 1, categoryIds: ["cat-a"] }), song({ rdjSongId: 2, categoryIds: ["cat-b"] })],
      rules: [],
      history: [],
    };
    // Both hours are Monday 00:00 local — same dow/hour, different cycle week.
    const week0 = generateLog(
      baseInput({
        ...common,
        horizonStart: new Date("2026-07-06T00:00:00.000Z"),
        horizonEnd: new Date("2026-07-06T01:00:00.000Z"),
      })
    );
    const week1 = generateLog(
      baseInput({
        ...common,
        horizonStart: new Date("2026-07-13T00:00:00.000Z"),
        horizonEnd: new Date("2026-07-13T01:00:00.000Z"),
      })
    );
    expect(week0.items[0].rdjSongId).toBe(1); // week 0 → clock A → cat-a
    expect(week1.items[0].rdjSongId).toBe(2); // week 1 → clock B → cat-b
  });
});
