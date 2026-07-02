import { describe, expect, it } from "vitest";
import {
  SeparationState,
  eraSpreadScore,
  flowScore,
  moodFitScore,
  nearSeparationPenalty,
  soundFitScore,
} from "../src/index.js";
import { history, song } from "./fixtures.js";

const AT = new Date("2026-07-06T12:00:00.000Z");

describe("scoring components", () => {
  it("flowScore: perfect / worst / null-neutral", () => {
    const prev = song({ rdjSongId: 1, tempo: 3, energy: 3 });
    expect(flowScore(song({ rdjSongId: 2, tempo: 3, energy: 3 }), prev)).toBe(1);
    expect(flowScore(song({ rdjSongId: 3, tempo: 5, energy: 5 }), song({ rdjSongId: 1, tempo: 1, energy: 1 }))).toBe(0);
    expect(flowScore(song({ rdjSongId: 4, tempo: null, energy: 3 }), prev)).toBe(0.5);
    expect(flowScore(song({ rdjSongId: 5, tempo: 3, energy: 3 }), null)).toBe(0.5);
  });

  it("eraSpreadScore: rewards differing eras, neutral on nulls", () => {
    const c = song({ rdjSongId: 1, era: "90s" });
    expect(eraSpreadScore(c, ["00s", "10s", "20s"])).toBe(1);
    expect(eraSpreadScore(c, ["90s", "90s", "90s"])).toBe(0);
    expect(eraSpreadScore(c, ["90s", "00s"])).toBe(0.5);
    expect(eraSpreadScore(c, [null, null])).toBe(0.5);
    expect(eraSpreadScore(song({ rdjSongId: 2, era: null }), ["90s"])).toBe(0.5);
    expect(eraSpreadScore(c, [])).toBe(0.5);
  });

  it("moodFitScore: match / mismatch / neutral", () => {
    expect(moodFitScore(song({ rdjSongId: 1, mood: "dark" }), { moodTarget: "dark" })).toBe(1);
    expect(moodFitScore(song({ rdjSongId: 2, mood: "bright" }), { moodTarget: "dark" })).toBe(0);
    expect(moodFitScore(song({ rdjSongId: 3, mood: null }), { moodTarget: "dark" })).toBe(0.5);
    expect(moodFitScore(song({ rdjSongId: 4, mood: "dark" }), null)).toBe(0.5);
  });

  it("soundFitScore: fractional include match, neutral without data", () => {
    const coded = song({ rdjSongId: 1, soundCodes: ["guitar", "female"] });
    expect(soundFitScore(coded, { soundCodesInclude: ["guitar", "synth"] })).toBe(0.5);
    expect(soundFitScore(coded, { soundCodesInclude: ["guitar", "female"] })).toBe(1);
    expect(soundFitScore(coded, { soundCodesInclude: ["synth"] })).toBe(0);
    expect(soundFitScore(song({ rdjSongId: 2, soundCodes: null }), { soundCodesInclude: ["synth"] })).toBe(0.5);
    expect(soundFitScore(coded, null)).toBe(0.5);
  });

  it("nearSeparationPenalty: 0 beyond 2× window, −0.5 at the window edge", () => {
    const sep = new SeparationState([history(1, "A", "T", new Date("2026-07-06T11:00:00.000Z"))]); // 60 min before AT
    const s = song({ rdjSongId: 2, artist: "A" });
    // window 30: gap 60 = 2×window → 0
    expect(nearSeparationPenalty(sep, s, AT, 30)).toBe(0);
    // window 60: gap 60 = window edge → −0.5
    expect(nearSeparationPenalty(sep, s, AT, 60)).toBeCloseTo(-0.5);
    // window 45: gap 60, 2w=90 → −0.5·(90−60)/45 = −1/3
    expect(nearSeparationPenalty(sep, s, AT, 45)).toBeCloseTo(-1 / 3);
    // never-heard artist → 0
    expect(nearSeparationPenalty(sep, song({ rdjSongId: 3, artist: "B" }), AT, 60)).toBe(0);
    // no window → 0
    expect(nearSeparationPenalty(sep, s, AT, null)).toBe(0);
  });

  it("an all-null candidate is fully neutral on every soft component", () => {
    const blank = song({ rdjSongId: 1, tempo: null, energy: null, era: null, mood: null, soundCodes: null });
    expect(flowScore(blank, song({ rdjSongId: 2, tempo: 3, energy: 3 }))).toBe(0.5);
    expect(eraSpreadScore(blank, ["90s"])).toBe(0.5);
    expect(moodFitScore(blank, { moodTarget: "dark" })).toBe(0.5);
    expect(soundFitScore(blank, { soundCodesInclude: ["guitar"] })).toBe(0.5);
  });
});
