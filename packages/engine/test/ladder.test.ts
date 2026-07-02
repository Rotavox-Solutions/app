import { describe, expect, it } from "vitest";
import { buildRungs, generateLog, resolveRules, DEFAULT_CONFIG } from "../src/index.js";
import type { EngineClock } from "../src/index.js";
import { baseInput, category, position, rule, song } from "./fixtures.js";

describe("relaxation ladder", () => {
  it("builds the static rung enumeration in spec order", () => {
    const pos = position({ sortOrder: 1, categoryId: "cat-main", constraints: { fallbackCategoryId: "cat-fb" } });
    const eff = resolveRules(
      [
        rule({ id: "r-artist", ruleType: "artist_separation", params: { minMinutes: 45 } }),
        rule({ id: "r-title", ruleType: "title_separation", params: { minMinutes: 150 } }),
        rule({ id: "r-album", ruleType: "album_separation", params: { minMinutes: 60 } }),
      ],
      pos,
      ["cat-main"]
    );
    const rungs = buildRungs(DEFAULT_CONFIG, eff, pos);
    expect(rungs.map((r) => r.kind)).toEqual([
      "base",
      "drop_secondary_hard",
      "shrink_artist",
      "shrink_artist",
      "shrink_artist",
      "shrink_title",
      "shrink_title",
      "shrink_title",
      "fallback_category",
      "last_resort",
    ]);
    // cumulative: the fallback rung retains full shrink + dropped secondaries
    const fb = rungs[8];
    expect(fb.dropSecondary).toBe(true);
    expect(fb.artistFactor).toBe(0.25);
    expect(fb.titleFactor).toBe(0.25);
    // rungs that can't change anything are omitted
    const noRules = resolveRules([], pos, ["cat-main"]);
    const minimal = buildRungs(DEFAULT_CONFIG, noRules, position({ sortOrder: 2, categoryId: "cat-main" }));
    expect(minimal.map((r) => r.kind)).toEqual(["base", "last_resort"]);
  });

  it("records exact payloads for every rung in force, shrink steps superseding", () => {
    // Single song, artist aired 20 min ago, 45-min window: base blocks (gap 20 < 45),
    // ×0.75 blocks (33.75), ×0.5 blocks (22.5), ×0.25 passes (11.25).
    const input = baseInput({
      songs: [song({ rdjSongId: 1, artist: "Only Artist", categoryIds: ["cat-main"] })],
      history: [
        { rdjSongId: 99, artist: "Only Artist", title: "Elsewhere", airedAt: new Date("2026-07-05T23:40:00.000Z") },
      ],
      horizonEnd: new Date("2026-07-06T01:00:00.000Z"),
      clocks: [
        {
          id: "clock-1",
          name: "One Slot",
          positions: [position({ sortOrder: 1, categoryId: "cat-main" })],
        } satisfies EngineClock,
      ],
    });
    const result = generateLog(input);
    const item = result.items[0];
    expect(item.rdjSongId).toBe(1);
    const shrink = item.violations.filter((v) => v.step === "shrink_artist");
    expect(shrink).toHaveLength(1); // superseded, not stacked
    expect(shrink[0].detail).toMatchObject({
      ruleId: "r-artist",
      windowBeforeMin: 45,
      windowAfterMin: 11.25,
      factor: 0.25,
    });
  });

  it("falls back to the configured category (single hop) and records from/to", () => {
    const main = category({ id: "cat-main" });
    const fb = category({ id: "cat-fb" });
    const input = baseInput({
      categories: [main, fb],
      // main pool is a song whose artist just aired ⇒ blocked even at ×0.25;
      // fallback pool has a clean song.
      songs: [
        song({ rdjSongId: 1, artist: "Blocked", categoryIds: ["cat-main"] }),
        song({ rdjSongId: 2, artist: "Clean", categoryIds: ["cat-fb"] }),
      ],
      history: [
        { rdjSongId: 99, artist: "Blocked", title: "X", airedAt: new Date("2026-07-05T23:59:00.000Z") },
      ],
      horizonEnd: new Date("2026-07-06T01:00:00.000Z"),
      clocks: [
        {
          id: "clock-1",
          name: "One Slot",
          positions: [
            position({
              sortOrder: 1,
              categoryId: "cat-main",
              constraints: { fallbackCategoryId: "cat-fb" },
            }),
          ],
        } satisfies EngineClock,
      ],
    });
    const result = generateLog(input);
    const item = result.items[0];
    expect(item.rdjSongId).toBe(2);
    const fbViolation = item.violations.find((v) => v.step === "fallback_category");
    expect(fbViolation?.detail).toMatchObject({ fromCategoryId: "cat-main", toCategoryId: "cat-fb" });
  });

  it("last resort picks the least-recently-heard at slot time, deterministically", () => {
    // Both songs share one artist that aired 1 min ago ⇒ nothing survives any
    // separation rung. Song 1 aired 3h ago, song 2 aired 1h ago ⇒ pick song 1.
    const input = baseInput({
      songs: [
        song({ rdjSongId: 1, artist: "Same", categoryIds: ["cat-main"] }),
        song({ rdjSongId: 2, artist: "Same", categoryIds: ["cat-main"] }),
      ],
      history: [
        { rdjSongId: 1, artist: "Same", title: "Title 1", airedAt: new Date("2026-07-05T21:00:00.000Z") },
        { rdjSongId: 2, artist: "Same", title: "Title 2", airedAt: new Date("2026-07-05T23:00:00.000Z") },
        { rdjSongId: 99, artist: "Same", title: "Z", airedAt: new Date("2026-07-05T23:59:00.000Z") },
      ],
      horizonEnd: new Date("2026-07-06T01:00:00.000Z"),
      clocks: [
        {
          id: "clock-1",
          name: "One Slot",
          positions: [position({ sortOrder: 1, categoryId: "cat-main" })],
        } satisfies EngineClock,
      ],
    });
    const result = generateLog(input);
    const item = result.items[0];
    expect(item.rdjSongId).toBe(1);
    const lastResort = item.violations.find((v) => v.step === "last_resort");
    expect(lastResort?.detail).toMatchObject({
      ignoredRules: ["artist_separation", "title_separation", "max_per_hour"],
    });
    expect(lastResort?.detail["pickedGapMinutes"]).toBe(180);
  });

  it("emits an unfillable null item on an empty pool and keeps generating", () => {
    const empty = category({ id: "cat-empty" });
    const main = category({ id: "cat-main" });
    const input = baseInput({
      categories: [empty, main],
      clocks: [
        {
          id: "clock-1",
          name: "Two Slots",
          positions: [
            position({ sortOrder: 1, categoryId: "cat-empty" }),
            position({ sortOrder: 2, categoryId: "cat-main" }),
          ],
        } satisfies EngineClock,
      ],
      horizonEnd: new Date("2026-07-06T01:00:00.000Z"),
    });
    const result = generateLog(input);
    expect(result.items[0].rdjSongId).toBeNull();
    expect(result.items[0].violations.at(-1)?.step).toBe("unfillable");
    expect(result.items[1].rdjSongId).not.toBeNull(); // generation continued
    expect(result.stats.unfillable).toBeGreaterThan(0);
  });
});
