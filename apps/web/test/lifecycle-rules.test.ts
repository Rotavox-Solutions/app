import { beforeEach, describe, expect, it } from "vitest";
import {
  applyDraft,
  nextPoolDown,
  playHistory,
  setPoolLifecycle,
  songCategories,
  stageChanges,
  suggestMoves,
  type RulePool,
  type RuleSong,
} from "@rotavox/schema";
import { db } from "../src/lib/db";
import { dismissSuggestion, getSuggestions } from "../src/lib/suggestions";
import { resetDb } from "./helpers/db";
import { seedCategory, seedSong, seedStation } from "./helpers/fixtures";

const now = new Date("2026-10-30T12:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);
const pool = (id: string, over: Partial<RulePool> = {}): RulePool => ({
  id, name: id, ladderRank: null, fallingAfterDays: null, restReviewDays: null,
  restExitCategoryId: null, promoteAfterDays: null, promoteToCategoryId: null, benchAfterUnairedDays: null, ...over,
});
const song = (id: string, over: Partial<RuleSong>): RuleSong => ({
  id, state: "active", since: null, poolId: null, entry: null, lastAiredAt: null, ...over,
});

describe("standing lifecycle rules", () => {
  const pools = [
    pool("A1", { ladderRank: 1, fallingAfterDays: 42, restReviewDays: 90, restExitCategoryId: "R1" }),
    pool("A2", { ladderRank: 2, fallingAfterDays: 42 }),
    pool("B", { ladderRank: 2 }),
    pool("N", { ladderRank: 4, fallingAfterDays: 28, restReviewDays: 60 }),
    pool("R1", { promoteAfterDays: 180, promoteToCategoryId: "G", benchAfterUnairedDays: 60 }),
    pool("G"),
  ];

  it("finds the next pool down the ladder, ties by name, none at the bottom", () => {
    expect(nextPoolDown(pools[0], pools)?.id).toBe("A2");
    expect(nextPoolDown(pools[1], pools)?.id).toBe("N");
    expect(nextPoolDown(pools[3], pools)).toBeNull();
    expect(nextPoolDown(pools[4], pools)).toBeNull();
  });

  it("suggests one move per song, by rule", () => {
    const entry = (d: number) => ({ at: ago(d), from: null, known: true });
    const out = suggestMoves(
      [
        song("rested-a1", { state: "resting", since: ago(100), poolId: "A1" }),
        song("rested-n", { state: "resting", since: ago(61), poolId: "N" }),
        song("resting-young", { state: "resting", since: ago(10), poolId: "A1" }),
        song("falling-a1", { poolId: "A1", entry: entry(50), lastAiredAt: ago(1) }),
        song("falling-bottom", { poolId: "N", entry: entry(30), lastAiredAt: ago(1) }),
        song("fresh-a1", { poolId: "A1", entry: entry(5), lastAiredAt: ago(1) }),
        song("old-recurrent", { poolId: "R1", entry: entry(200), lastAiredAt: ago(3) }),
        song("unaired-recurrent", { poolId: "R1", entry: entry(200), lastAiredAt: ago(70) }),
        song("new-recurrent", { poolId: "R1", entry: entry(10) }),
        song("benched", { state: "benched", poolId: null }),
      ],
      pools,
      now
    );
    expect(out.map((s) => [s.songId, s.rule, s.to.state, s.to.categoryId])).toEqual([
      ["rested-a1", "rest_exit", "active", "R1"],
      ["rested-n", "rest_exit", "active", "N"],
      ["falling-a1", "falling", "active", "A2"],
      ["falling-bottom", "falling", "resting", "N"],
      ["old-recurrent", "promote", "active", "G"],
      ["unaired-recurrent", "bench", "benched", null],
    ]);
    expect(out[0].why).toBe("Rested 100 days from A1, past its 90-day standard");
    expect(out[5].why).toBe("Not aired in 70 days in R1");
  });
});

describe("suggestions at a station", () => {
  beforeEach(resetDb);

  it("loads them from live data, leaves out dismissed ones, and marks staged ones", async () => {
    const station = await seedStation({ membershipImportedAt: new Date() });
    const r1 = await seedCategory(station.id, { name: "R1" });
    const gold = await seedCategory(station.id, { name: "Gold" });
    await setPoolLifecycle(db, station.id, r1.id, { benchAfterUnairedDays: 30, promoteAfterDays: 1, promoteToCategoryId: gold.id });
    await expect(setPoolLifecycle(db, station.id, r1.id, { promoteToCategoryId: r1.id })).rejects.toMatchObject({ code: "invalid" });

    const quiet = await seedSong(station.id, 1, { artist: "Quiet" });
    const busy = await seedSong(station.id, 2, { artist: "Busy" });
    for (const s of [quiet, busy]) await db.insert(songCategories).values({ songId: s.id, categoryId: gold.id });
    // Move both into R1 through a changeset, so their arrival is on record 2 days ago.
    await stageChanges(db, station.id, [quiet, busy].map((s) => ({ songId: s.id, to: { state: "active" as const, categoryId: r1.id } })));
    await applyDraft(db, station.id, { intent: "Into R1", at: new Date(Date.now() - 2 * 86_400_000) });
    await db.insert(playHistory).values({ stationId: station.id, songId: busy.id, rdjSongId: 2, airedAt: new Date(), source: "reconciled" });

    let s = await getSuggestions(station.id);
    // Neither is past 30 days unaired (both arrived 2 days ago), so both are due to move on.
    expect(s.rows.map((r) => [r.artist, r.rule, r.to.categoryId])).toEqual([
      ["Busy", "promote", gold.id],
      ["Quiet", "promote", gold.id],
    ]);

    await dismissSuggestion(station.id, quiet.id, "promote", null);
    s = await getSuggestions(station.id);
    expect(s.rows.map((r) => r.artist)).toEqual(["Busy"]);
    expect(s.dismissed).toBe(1);

    await stageChanges(db, station.id, [{ songId: busy.id, to: { state: "active", categoryId: gold.id } }]);
    expect((await getSuggestions(station.id)).rows[0].staged).toBe(true);
  });

  it("suggests nothing before the import", async () => {
    const station = await seedStation();
    expect(await getSuggestions(station.id)).toEqual({ imported: false, rows: [], dismissed: 0 });
  });
});
