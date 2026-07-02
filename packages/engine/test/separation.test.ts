import { describe, expect, it } from "vitest";
import { generateLog, SeparationState, restScore } from "../src/index.js";
import { baseInput, history, rule, song } from "./fixtures.js";

describe("separation across history + in-progress log", () => {
  it("blocks a song's artist by pre-horizon history within the window", () => {
    // Artist 1 aired 10 minutes before the horizon; 45-min window ⇒ song 1
    // cannot appear at the very start of the log.
    const input = baseInput({
      history: [history(1, "Artist 1", "Title 1", new Date("2026-07-05T23:50:00.000Z"))],
      horizonEnd: new Date("2026-07-06T01:00:00.000Z"),
    });
    const result = generateLog(input);
    const firstItem = result.items[0];
    expect(firstItem.rdjSongId).not.toBe(1);
  });

  it("enforces separation against not-yet-aired items already placed in the log", () => {
    // Two songs by the same artist: once one is placed, the other is blocked for
    // 45 min of projected time even though neither has ever aired.
    const input = baseInput({
      songs: [
        song({ rdjSongId: 1, artist: "Shared Artist", categoryIds: ["cat-main"] }),
        song({ rdjSongId: 2, artist: "Shared Artist", categoryIds: ["cat-main"] }),
        song({ rdjSongId: 3, artist: "Other A", categoryIds: ["cat-main"] }),
        song({ rdjSongId: 4, artist: "Other B", categoryIds: ["cat-main"] }),
        song({ rdjSongId: 5, artist: "Other C", categoryIds: ["cat-main"] }),
      ],
      horizonEnd: new Date("2026-07-06T01:00:00.000Z"),
    });
    const result = generateLog(input);
    // Items are ~200s apart; a 45-min window spans the whole hour (3 positions),
    // so Shared Artist may appear at most once among clean (non-relaxed) items.
    const cleanShared = result.items.filter(
      (i) => (i.rdjSongId === 1 || i.rdjSongId === 2) && i.violations.length === 0
    );
    expect(cleanShared.length).toBeLessThanOrEqual(1);
  });

  it("keys separation off projected_air_at, not generation time (23:50 case)", () => {
    // History play at 23:50; horizon starts 00:00; 30-min window.
    // A slot projecting 00:00 (gap 10 min) must block; a slot projecting ≥00:20
    // (gap ≥30 min) must allow. Slots are ~200s apart ⇒ the 7th slot (~00:20) frees it.
    const sep = new SeparationState([history(1, "A", "T", new Date("2026-07-05T23:50:00.000Z"))]);
    expect(sep.gapMinutes("artist", "A", new Date("2026-07-06T00:00:00.000Z"))).toBe(10);
    expect(sep.gapMinutes("artist", "A", new Date("2026-07-06T00:20:00.000Z"))).toBe(30);
  });

  it("fails closed on negative gap (occurrence after the slot)", () => {
    const sep = new SeparationState([history(1, "A", "T", new Date("2026-07-06T01:00:00.000Z"))]);
    const gap = sep.gapMinutes("artist", "A", new Date("2026-07-06T00:00:00.000Z"));
    expect(gap).toBe(-60);
    expect(gap >= 30).toBe(false); // any positive window blocks
  });

  it("computes restScore at slot time, not generation time", () => {
    const aired = new Date("2026-07-06T00:00:00.000Z");
    const sep = new SeparationState([history(1, "A", "T", aired)]);
    const s = song({ rdjSongId: 1 });
    const atPlus12h = new Date("2026-07-06T12:00:00.000Z");
    const atPlus24h = new Date("2026-07-07T00:00:00.000Z");
    // 24h turnover: 12h since → 0.25; 24h since → 0.5 — a function of the slot instant.
    expect(restScore(sep, s, atPlus12h, 24)).toBeCloseTo(0.25);
    expect(restScore(sep, s, atPlus24h, 24)).toBeCloseTo(0.5);
  });

  it("gives never-played songs the maximum rest score", () => {
    const sep = new SeparationState([]);
    expect(restScore(sep, song({ rdjSongId: 99 }), new Date("2026-07-06T00:00:00.000Z"), 24)).toBe(1);
  });
});
