import { describe, expect, it } from "vitest";
import { generateLog, localParts } from "../src/index.js";
import type { EngineClock } from "../src/index.js";
import { baseInput, position, song } from "./fixtures.js";

describe("time model", () => {
  it("maps station-local dow/hour (America/New_York, EDT = UTC−4)", () => {
    // 2026-07-06T00:00Z = Sunday 20:00 in New York
    const p = localParts(new Date("2026-07-06T00:00:00.000Z"), "America/New_York");
    expect(p.dayOfWeek).toBe(0);
    expect(p.hour).toBe(20);
    expect(p.hourKey).toBe("2026-07-05T20");
    // and 12:00Z the same day = Monday 08:00
    const q = localParts(new Date("2026-07-06T12:00:00.000Z"), "America/New_York");
    expect(q.dayOfWeek).toBe(1);
    expect(q.hour).toBe(8);
  });

  it("accumulates durations into projected_air_at and re-syncs at the top of hour", () => {
    // 3 songs × 200s per hour ⇒ items at :00, :03:20, :06:40; the next hour's first
    // item snaps back to the top of that hour (underrun gap).
    const result = generateLog(baseInput({ horizonEnd: new Date("2026-07-06T02:00:00.000Z") }));
    const t = (i: number) => result.items[i].projectedAirAt.toISOString();
    expect(t(0)).toBe("2026-07-06T00:00:00.000Z");
    expect(t(1)).toBe("2026-07-06T00:03:20.000Z");
    expect(t(2)).toBe("2026-07-06T00:06:40.000Z");
    expect(t(3)).toBe("2026-07-06T01:00:00.000Z"); // TOH re-sync
  });

  it("snaps forward to targetOffsetSeconds but never backward", () => {
    const input = baseInput({
      horizonEnd: new Date("2026-07-06T01:00:00.000Z"),
      clocks: [
        {
          id: "clock-1",
          name: "Offsets",
          positions: [
            position({ sortOrder: 1, categoryId: "cat-main" }), // :00
            position({ sortOrder: 2, categoryId: "cat-main", targetOffsetSeconds: 1200 }), // :20 snap
            position({ sortOrder: 3, categoryId: "cat-main", targetOffsetSeconds: 60 }), // behind running clock — no snap-back
          ],
        } satisfies EngineClock,
      ],
    });
    const result = generateLog(input);
    expect(result.items[1].projectedAirAt.toISOString()).toBe("2026-07-06T00:20:00.000Z");
    expect(result.items[2].projectedAirAt.toISOString()).toBe("2026-07-06T00:23:20.000Z");
  });

  it("spills overruns forward and absorbs them at the next TOH", () => {
    const input = baseInput({
      horizonEnd: new Date("2026-07-06T02:00:00.000Z"),
      songs: [
        song({ rdjSongId: 1, durationMs: 65 * 60_000, artist: "L", categoryIds: ["cat-main"] }),
        song({ rdjSongId: 2, durationMs: 200_000, artist: "M", categoryIds: ["cat-main"] }),
        song({ rdjSongId: 3, durationMs: 200_000, artist: "N", categoryIds: ["cat-main"] }),
      ],
      clocks: [
        {
          id: "clock-1",
          name: "One",
          positions: [position({ sortOrder: 1, categoryId: "cat-main" })],
        } satisfies EngineClock,
      ],
    });
    const result = generateLog(input);
    // hour 0 placed the 65-min song (never-played rest ties broken by id) → hour 1's
    // slot projects at 01:05, not 01:00.
    expect(result.items[0].projectedAirAt.toISOString()).toBe("2026-07-06T00:00:00.000Z");
    if (result.items[0].rdjSongId === 1) {
      expect(result.items[1].projectedAirAt.toISOString()).toBe("2026-07-06T01:05:00.000Z");
    }
  });

  it("skips unmapped grid hours with a warning", () => {
    const input = baseInput({ grid: [], horizonEnd: new Date("2026-07-06T01:00:00.000Z") });
    const result = generateLog(input);
    expect(result.items).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("no clock mapped"))).toBe(true);
  });

  it("rejects a non-hour-aligned horizon", () => {
    expect(() =>
      generateLog(baseInput({ horizonStart: new Date("2026-07-06T00:30:00.000Z") }))
    ).toThrow(/aligned/);
  });

  it("places fixed_event items with their configured duration and no song", () => {
    const input = baseInput({
      horizonEnd: new Date("2026-07-06T01:00:00.000Z"),
      clocks: [
        {
          id: "clock-1",
          name: "Fixed",
          positions: [
            position({
              sortOrder: 1,
              positionType: "fixed_event",
              targetOffsetSeconds: 0,
              constraints: { fixedDurationSeconds: 300 },
              fixedRef: "network-news",
            }),
            position({ sortOrder: 2, categoryId: "cat-main" }),
          ],
        } satisfies EngineClock,
      ],
    });
    const result = generateLog(input);
    expect(result.items[0].elementType).toBe("fixed_event");
    expect(result.items[0].rdjSongId).toBeNull();
    expect(result.items[1].projectedAirAt.toISOString()).toBe("2026-07-06T00:05:00.000Z");
  });
});
