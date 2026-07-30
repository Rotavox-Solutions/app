import { describe, expect, it } from "vitest";
import { generateLog, resolveRules } from "../src/index.js";
import type { EngineClock } from "../src/index.js";
import { baseInput, category, position, rule, song } from "./fixtures.js";

describe("rule resolution & hard filters", () => {
  it("narrower scope wins: position > category > global", () => {
    const pos = position({ sortOrder: 1, categoryId: "cat-child" });
    const rules = [
      rule({ id: "r1-global", ruleType: "artist_separation", params: { minMinutes: 60 } }),
      rule({ id: "r2-parent", ruleType: "artist_separation", scope: "category", scopeRef: "cat-parent", params: { minMinutes: 45 } }),
      rule({ id: "r3-child", ruleType: "artist_separation", scope: "category", scopeRef: "cat-child", params: { minMinutes: 30 } }),
      rule({ id: "r4-pos", ruleType: "title_separation", scope: "position", scopeRef: "pos-1", params: { minMinutes: 15 } }),
      rule({ id: "r5-global-title", ruleType: "title_separation", params: { minMinutes: 150 } }),
    ];
    // child category overrides parent overrides global
    const eff = resolveRules(rules, pos, ["cat-child", "cat-parent"]);
    expect(eff.artistSepMin).toBe(30);
    expect(eff.ruleIds.artist).toBe("r3-child");
    // position scope overrides global for title
    expect(eff.titleSepMin).toBe(15);
    expect(eff.ruleIds.title).toBe("r4-pos");
    // soft rules never contribute to hard windows
    const softOnly = resolveRules(
      [rule({ id: "r-soft", ruleType: "artist_separation", hardness: "soft", params: { minMinutes: 10 } })],
      pos,
      ["cat-child"]
    );
    expect(softOnly.artistSepMin).toBeNull();
  });

  it("hard tempo_clash filters candidates against the previous music item", () => {
    // prev item tempo 1; candidates tempo 5 (clash, |Δ|=4 > 2) vs tempo 2 (ok).
    const input = baseInput({
      songs: [
        song({ rdjSongId: 1, tempo: 1, energy: 3, artist: "P", categoryIds: ["cat-main"] }),
        song({ rdjSongId: 2, tempo: 5, energy: 3, artist: "Q", categoryIds: ["cat-main"] }),
        song({ rdjSongId: 3, tempo: 2, energy: 3, artist: "R", categoryIds: ["cat-main"] }),
      ],
      rules: [
        rule({ id: "r-tempo", ruleType: "tempo_clash", params: { maxJump: 2 } }),
        // pin slot 1 to song 1 by blocking the others via daypart? simpler: rely on
        // song 1 being the only never-played... all are never-played. Instead make
        // slot 1's pool contain only song 1:
      ],
      categories: [category({ id: "cat-main" }), category({ id: "cat-first" })],
      clocks: [
        {
          id: "clock-1",
          name: "Tempo",
          positions: [
            position({ sortOrder: 1, categoryId: "cat-first" }),
            position({ sortOrder: 2, categoryId: "cat-main" }),
          ],
        } satisfies EngineClock,
      ],
      horizonEnd: new Date("2026-07-06T01:00:00.000Z"),
    });
    input.songs[0].categoryIds = ["cat-first"]; // song 1 seeds slot 1 deterministically
    const result = generateLog(input);
    expect(result.items[0].rdjSongId).toBe(1);
    // slot 2 must avoid the tempo-clashing song 2 without any violations recorded
    expect(result.items[1].rdjSongId).toBe(3);
    expect(result.items[1].violations).toEqual([]);
  });

  it("song_type gates pools per position type", () => {
    const music = category({ id: "cat-music" });
    const imaging = category({ id: "cat-imaging", kind: "imaging" });
    const input = baseInput({
      categories: [music, imaging],
      songs: [
        song({ rdjSongId: 1, songType: 0, categoryIds: ["cat-music"] }),
        song({ rdjSongId: 2, songType: 2, categoryIds: ["cat-imaging"] }), // sweeper
      ],
      clocks: [
        {
          id: "clock-1",
          name: "Typed",
          positions: [
            position({ sortOrder: 1, positionType: "sweeper", categoryId: "cat-imaging" }),
            position({ sortOrder: 2, positionType: "category", categoryId: "cat-music" }),
          ],
        } satisfies EngineClock,
      ],
      horizonEnd: new Date("2026-07-06T01:00:00.000Z"),
    });
    const result = generateLog(input);
    expect(result.items[0].rdjSongId).toBe(2);
    expect(result.items[0].elementType).toBe("sweeper");
    expect(result.items[1].rdjSongId).toBe(1);
    expect(result.items[1].elementType).toBe("music");
  });

  it("sweeper positions can schedule song_type 4 (station promos)", () => {
    const promos = category({ id: "cat-promos", kind: "imaging" });
    const input = baseInput({
      categories: [promos],
      songs: [song({ rdjSongId: 9, songType: 4, categoryIds: ["cat-promos"] })],
      clocks: [
        {
          id: "clock-1",
          name: "Promo",
          positions: [position({ sortOrder: 1, positionType: "sweeper", categoryId: "cat-promos" })],
        } satisfies EngineClock,
      ],
      horizonEnd: new Date("2026-07-06T01:00:00.000Z"),
    });
    const result = generateLog(input);
    expect(result.items[0].rdjSongId).toBe(9);
    expect(result.items[0].elementType).toBe("sweeper");
  });
});
