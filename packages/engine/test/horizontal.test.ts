import { describe, expect, it } from "vitest";
import { generateLog, resolveRules, hourDistance, hourSpreadScore, SeparationState } from "../src/index.js";
import { baseInput, history, position, rule, song } from "./fixtures.js";

/**
 * Horizontal separation exists because depth cannot deliver it. A 7-song power pool
 * against 318 weekly slots returns to any given hour-of-day no matter how the numbers
 * are chosen, so keeping a song off the same slot has to be enforced, not inferred.
 *
 * It is a QUALITY rule, not a safety one: it must yield before the schedule goes
 * unfilled, which is why it sits on the secondary-hard rung alongside album and tempo.
 */

const DAY = 86_400_000;

describe("hourDistance", () => {
  it("is circular", () => {
    expect(hourDistance(9, 9)).toBe(0);
    expect(hourDistance(9, 11)).toBe(2);
    expect(hourDistance(23, 1)).toBe(2); // wraps midnight
    expect(hourDistance(0, 12)).toBe(12); // maximum
    expect(hourDistance(1, 23)).toBe(2);
  });
});

describe("rule resolution", () => {
  it("parses windowHours and minDays", () => {
    const eff = resolveRules(
      [rule({ id: "h1", ruleType: "horizontal_separation", params: { windowHours: 3, minDays: 4 } })],
      position({ sortOrder: 1 }),
      []
    );
    expect(eff.horizontalSep).toEqual({ ruleId: "h1", windowHours: 3, minDays: 4 });
  });

  it("ignores malformed or non-positive params rather than half-applying them", () => {
    const bad = (params: Record<string, unknown>) =>
      resolveRules(
        [rule({ id: "h", ruleType: "horizontal_separation", params })],
        position({ sortOrder: 1 }),
        []
      ).horizontalSep;
    expect(bad({ windowHours: 3 })).toBeNull();
    expect(bad({ windowHours: 0, minDays: 3 })).toBeNull();
    expect(bad({ windowHours: "3", minDays: 3 })).toBeNull();
  });

  it("is not applied from a soft rule", () => {
    const eff = resolveRules(
      [rule({ id: "h", ruleType: "horizontal_separation", hardness: "soft", params: { windowHours: 3, minDays: 3 } })],
      position({ sortOrder: 1 }),
      []
    );
    expect(eff.horizontalSep).toBeNull();
  });
});

describe("SeparationState.playsWithin", () => {
  const at = new Date("2026-08-05T09:00:00Z");
  const state = () =>
    new SeparationState([
      history(1, "A", "T", new Date("2026-08-04T09:00:00Z")), // 1 day back
      history(1, "A", "T", new Date("2026-08-02T09:00:00Z")), // 3 days back
      history(1, "A", "T", new Date("2026-07-20T09:00:00Z")), // far outside
    ]);

  it("returns only plays inside the window", () => {
    expect(state().playsWithin(1, at, 2 * DAY)).toHaveLength(1);
    expect(state().playsWithin(1, at, 4 * DAY)).toHaveLength(2);
  });

  it("excludes plays at or after the slot instant — a regen must not use the future", () => {
    const s = new SeparationState([history(1, "A", "T", new Date("2026-08-06T09:00:00Z"))]);
    expect(s.playsWithin(1, at, 30 * DAY)).toEqual([]);
  });

  it("returns empty for a song never played", () => {
    expect(state().playsWithin(999, at, 30 * DAY)).toEqual([]);
  });
});

describe("hourSpreadScore", () => {
  const at = new Date("2026-08-05T09:00:00Z");
  const toHour = (t: number) => new Date(t).getUTCHours();
  const s = song({ rdjSongId: 1 });

  it("is 1 for a song with no plays in the window", () => {
    const sep = new SeparationState([]);
    expect(hourSpreadScore(sep, s, at, 9, 3, toHour, hourDistance)).toBe(1);
  });

  it("is 0 when a recent play sits on the same hour", () => {
    const sep = new SeparationState([history(1, "A", "T", new Date("2026-08-04T09:00:00Z"))]);
    expect(hourSpreadScore(sep, s, at, 9, 3, toHour, hourDistance)).toBe(0);
  });

  it("scales with distance from the nearest recent play", () => {
    const sep = new SeparationState([history(1, "A", "T", new Date("2026-08-04T21:00:00Z"))]);
    expect(hourSpreadScore(sep, s, at, 9, 3, toHour, hourDistance)).toBe(1); // 12h away
  });

  it("takes the NEAREST play, not the average — one close play is disqualifying", () => {
    const sep = new SeparationState([
      history(1, "A", "T", new Date("2026-08-04T21:00:00Z")), // far
      history(1, "A", "T", new Date("2026-08-03T10:00:00Z")), // 1h away
    ]);
    expect(hourSpreadScore(sep, s, at, 9, 3, toHour, hourDistance)).toBeCloseTo(1 / 12);
  });
});

describe("end to end", () => {
  /** One song per slot, so the engine has no choice but to reveal the constraint. */
  const START = new Date("2026-07-06T00:00:00.000Z");
  const back = (ms: number) => new Date(START.getTime() - ms);

  function twoSongWorld(rules = [] as ReturnType<typeof rule>[]) {
    return baseInput({
      songs: [
        song({ rdjSongId: 1, categoryIds: ["cat-main"], artist: "A", title: "One" }),
        song({ rdjSongId: 2, categoryIds: ["cat-main"], artist: "B", title: "Two" }),
      ],
      rules,
      horizonEnd: new Date("2026-07-06T01:00:00.000Z"),
    });
  }

  it("blocks a song that played near this hour-of-day yesterday", () => {
    const input = twoSongWorld([
      rule({ id: "h", ruleType: "horizontal_separation", params: { windowHours: 2, minDays: 3 } }),
    ]);
    // song 1 aired at the same hour on each of the two previous days
    input.history = [
      history(1, "A", "One", back(1 * DAY)),
      history(1, "A", "One", back(2 * DAY)),
    ];
    const out = generateLog(input);
    const first = out.items.filter((i) => i.rdjSongId != null)[0];
    expect(first.rdjSongId).toBe(2); // song 1 is horizontally blocked
  });

  it("permits the same song once the lookback has passed", () => {
    const input = twoSongWorld([
      rule({ id: "h", ruleType: "horizontal_separation", params: { windowHours: 2, minDays: 1 } }),
    ]);
    input.history = [history(1, "A", "One", back(5 * DAY))];
    const out = generateLog(input);
    expect(out.items.some((i) => i.rdjSongId === 1)).toBe(true);
  });

  it("permits a play at a distant hour on the same day", () => {
    const input = twoSongWorld([
      rule({ id: "h", ruleType: "horizontal_separation", params: { windowHours: 2, minDays: 3 } }),
    ]);
    input.history = [history(1, "A", "One", back(10 * 3_600_000))];
    const out = generateLog(input);
    expect(out.items.some((i) => i.rdjSongId === 1)).toBe(true);
  });

  it("yields rather than leaving the hour unfilled — it is a quality rule", () => {
    // Only one song exists and it is horizontally blocked; the ladder must still fill.
    const input = baseInput({
      songs: [song({ rdjSongId: 1, categoryIds: ["cat-main"], artist: "A", title: "One" })],
      rules: [rule({ id: "h", ruleType: "horizontal_separation", params: { windowHours: 12, minDays: 7 } })],
      horizonEnd: new Date("2026-07-06T01:00:00.000Z"),
    });
    input.history = [history(1, "A", "One", back(1 * DAY))];
    const out = generateLog(input);
    expect(out.stats.unfillable).toBe(0);
    expect(out.items.some((i) => i.rdjSongId === 1)).toBe(true);
  });

  // Plays placed during generation are recorded, so the rule binds against the log
  // being built, not only against aired history. That makes it a same-broadcast
  // constraint too: a song cannot come back around at the same time of day.
  it("also blocks a song recurring at the same hour-of-day within the same run", () => {
    const input = baseInput({
      rules: [rule({ id: "h", ruleType: "horizontal_separation", params: { windowHours: 6, minDays: 7 } })],
      horizonEnd: new Date("2026-07-06T06:00:00.000Z"), // 6 hours, 3 slots each
    });
    const ids = generateLog(input).items.filter((i) => i.rdjSongId != null).map((i) => i.rdjSongId);
    expect(ids.length).toBe(18);
    // 12 songs, 18 slots — reuse is unavoidable, but never inside the 6h window
    const seen = new Map<number, number>();
    input.grid; // grid is uniform; slot n falls in hour floor(n/3)
    ids.forEach((id, i) => {
      const hour = Math.floor(i / 3);
      const prev = seen.get(id!);
      if (prev !== undefined) expect(hour - prev).toBeGreaterThanOrEqual(1);
      seen.set(id!, hour);
    });
  });
});
