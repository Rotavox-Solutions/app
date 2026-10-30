import { beforeEach, describe, expect, it } from "vitest";
import { applyDraft, playHistory, songCategories, stageChanges, stations } from "@rotavox/schema";
import { db } from "../src/lib/db";
import { getSongDetail, parseLibraryFilter, searchLibrary } from "../src/lib/library";
import { resetDb } from "./helpers/db";
import { seedCategory, seedSong, seedStation } from "./helpers/fixtures";

describe("library queries", () => {
  beforeEach(resetDb);

  async function seed() {
    const station = await seedStation({ membershipImportedAt: new Date() });
    const a1 = await seedCategory(station.id, { name: "A1" });
    const r1 = await seedCategory(station.id, { name: "R1" });
    const deftones = await seedSong(station.id, 1, { artist: "Deftones", title: "Mountain", album: "Private Music" });
    const djo = await seedSong(station.id, 2, { artist: "Djo", title: "End of Beginning", lifecycleState: "resting" });
    const loose = await seedSong(station.id, 3, { artist: "Aaa", title: "No pool yet" });
    await seedSong(station.id, -3, { artist: "Mirror", title: "Retired mirror row" });
    await db.insert(songCategories).values([
      { songId: deftones.id, categoryId: a1.id },
      { songId: djo.id, categoryId: a1.id },
    ]);
    return { station, a1, r1, deftones, djo, loose };
  }

  it("searches by text, state and pool, and never shows the retired mirror", async () => {
    const { station, a1, deftones, djo, loose } = await seed();

    const all = await searchLibrary(station.id, {});
    expect(all.total).toBe(3);
    expect(all.rows.map((r) => r.id)).toEqual([loose.id, deftones.id, djo.id]);
    expect(all.rows[1]).toMatchObject({ poolId: a1.id, poolName: "A1", state: "active" });

    expect((await searchLibrary(station.id, { q: "private" })).rows.map((r) => r.id)).toEqual([deftones.id]);
    expect((await searchLibrary(station.id, { state: "resting" })).rows.map((r) => r.id)).toEqual([djo.id]);
    expect((await searchLibrary(station.id, { pool: "none" })).rows.map((r) => r.id)).toEqual([loose.id]);
    expect((await searchLibrary(station.id, { pool: a1.id, state: "active" })).rows.map((r) => r.id)).toEqual([
      deftones.id,
    ]);
  });

  it("clamps a page past the end to the last page", async () => {
    const { station } = await seed();
    const result = await searchLibrary(station.id, { page: 9 });
    expect(result).toMatchObject({ page: 1, pageCount: 1, total: 3 });
  });

  it("drops filters it doesn't understand", () => {
    expect(parseLibraryFilter({ q: "  djo ", state: "sleeping", page: "0" })).toEqual({
      q: "djo",
      state: undefined,
      pool: undefined,
      page: 1,
    });
    expect(parseLibraryFilter({ state: "benched", page: "3", pool: "none" })).toMatchObject({
      state: "benched",
      page: 3,
      pool: "none",
    });
  });

  it("gives a song's history newest first, linked to the changeset behind it, with airplay", async () => {
    const { station, r1, djo } = await seed();
    await stageChanges(db, station.id, [{ songId: djo.id, to: { state: "active", categoryId: r1.id } }]);
    const applied = await applyDraft(db, station.id, { intent: "Djo out of rest" });
    const hourAgo = new Date(Date.now() - 3_600_000);
    await db.insert(playHistory).values([
      { stationId: station.id, songId: djo.id, rdjSongId: 2, airedAt: hourAgo, source: "reconciled" },
      { stationId: station.id, songId: djo.id, rdjSongId: 2, airedAt: new Date(Date.now() - 60 * 86_400_000), source: "reconciled" },
    ]);

    const detail = await getSongDetail(station.id, djo.id);
    expect(detail?.song).toMatchObject({ state: "active", poolName: "R1", recentSpins: 1 });
    expect(detail?.events[0]).toMatchObject({
      fromState: "resting",
      fromCategoryName: "A1",
      toState: "active",
      toCategoryName: "R1",
      source: "changeset",
      changesetId: applied.changesetId,
    });
    expect(detail).toMatchObject({ spins30d: 1, spinsTotal: 2 });
    expect(detail?.plays).toHaveLength(2);
  });

  it("won't show one station's song to another", async () => {
    const { djo } = await seed();
    const [other] = await db.insert(stations).values({ name: "Other", timezone: "UTC" }).returning();
    expect(await getSongDetail(other.id, djo.id)).toBeNull();
  });
});
