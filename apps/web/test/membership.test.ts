import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  importMembership,
  playHistory,
  lifecycleEvents,
  mirrorChangesetMoves,
  placementForSubcat,
  songCategories,
  songs,
  stations,
  validateProjectionMap,
} from "@rotavox/schema";
import { db } from "../src/lib/db";
import { resetDb } from "./helpers/db";
import { seedCategory, seedSong, seedStation } from "./helpers/fixtures";

const LIFECYCLE = {
  32: { state: "resting" as const },
  33: { state: "resting" as const, origin: "N" },
  34: { state: "retired" as const },
  35: { state: "benched" as const },
};

describe("placementForSubcat", () => {
  const cats = [
    { id: "a1", name: "A1", rdjSubcategoryIds: [5] },
    { id: "n", name: "N", rdjSubcategoryIds: [24] },
  ];
  it("translates pools, states and unmapped subcategories", () => {
    expect(placementForSubcat(5, cats, LIFECYCLE, null)).toEqual({ state: "active", categoryId: "a1" });
    expect(placementForSubcat(33, cats, LIFECYCLE, "a1")).toEqual({ state: "resting", categoryId: "n" });
    expect(placementForSubcat(32, cats, LIFECYCLE, "a1")).toEqual({ state: "resting", categoryId: "a1" });
    expect(placementForSubcat(35, cats, LIFECYCLE, "a1")).toEqual({ state: "benched", categoryId: null });
    expect(placementForSubcat(39, cats, LIFECYCLE, "a1")).toEqual({ state: "active", categoryId: null });
  });
  it("rejects a subcategory claimed twice", () => {
    expect(
      validateProjectionMap([...cats, { id: "b", name: "B", rdjSubcategoryIds: [5] }], { 24: { state: "benched" } })
    ).toHaveLength(2);
  });
});

async function stationFixture() {
  const station = await seedStation({ rdjLifecycleSubcats: LIFECYCLE });
  const a1 = await seedCategory(station.id, { name: "A1", rdjSubcategoryIds: [5] });
  const n = await seedCategory(station.id, { name: "N", rdjSubcategoryIds: [24] });
  const song = (rdj: number, subcat: number) => seedSong(station.id, rdj, { rdjSubcategoryId: subcat });
  const s = {
    a1: await song(1, 5),
    zn: await song(2, 33),
    w: await song(3, 35),
    k: await song(4, 34),
    unmapped: await song(5, 39),
    retiredMirror: await song(-6, 5),
  };
  // The derived snapshot the seed leaves behind before import.
  await db.insert(songCategories).values({ songId: s.a1.id, categoryId: a1.id });
  return { station, a1, n, s };
}

async function placement(songId: string) {
  const [row] = await db.select({ state: songs.lifecycleState }).from(songs).where(eq(songs.id, songId));
  const pools = await db.select().from(songCategories).where(eq(songCategories.songId, songId));
  return { state: row.state, pools: pools.map((p) => `${p.role}:${p.categoryId}`).sort() };
}

describe("importMembership", () => {
  beforeEach(resetDb);

  it("writes nothing on a dry run", async () => {
    const { station } = await stationFixture();
    const summary = await importMembership(db, station.id, { dryRun: true });
    expect(summary.imported).toBe(5);
    expect(await db.select().from(lifecycleEvents)).toHaveLength(0);
    const [st] = await db.select().from(stations).where(eq(stations.id, station.id));
    expect(st.membershipImportedAt).toBeNull();
  });

  it("places every song once, and later runs only pick up new songs", async () => {
    const { station, a1, n, s } = await stationFixture();
    const lastAired = new Date("2026-06-01T10:00:00Z");
    await db
      .insert(playHistory)
      .values({ stationId: station.id, songId: s.zn.id, rdjSongId: 2, airedAt: lastAired, source: "reconciled" });
    const summary = await importMembership(db, station.id);
    expect(summary).toMatchObject({ imported: 5, firstImport: true, unassigned: 1 });
    expect(summary.byState).toEqual({ active: 2, resting: 1, benched: 1, retired: 1 });

    expect(await placement(s.a1.id)).toEqual({ state: "active", pools: [`primary:${a1.id}`] });
    expect(await placement(s.zn.id)).toEqual({ state: "resting", pools: [`primary:${n.id}`] });
    // Rest is dated from the last play, not the import.
    const [zn] = await db.select({ since: songs.lifecycleSince }).from(songs).where(eq(songs.id, s.zn.id));
    expect(zn.since?.toISOString()).toBe(lastAired.toISOString());
    expect(await placement(s.w.id)).toEqual({ state: "benched", pools: [] });
    expect(await placement(s.k.id)).toEqual({ state: "retired", pools: [] });
    expect(await placement(s.unmapped.id)).toEqual({ state: "active", pools: [] });
    // Every imported song carries an event, including the A1 song whose placement held.
    expect(await db.select().from(lifecycleEvents)).toHaveLength(5);
    expect(await db.select().from(lifecycleEvents).where(eq(lifecycleEvents.songId, s.retiredMirror.id))).toHaveLength(0);

    expect((await importMembership(db, station.id)).imported).toBe(0);
    await seedSong(station.id, 7, { rdjSubcategoryId: 24 });
    const again = await importMembership(db, station.id);
    expect(again).toMatchObject({ imported: 1, firstImport: false, byState: { active: 1 } });
  });
});

describe("mirrorChangesetMoves", () => {
  beforeEach(resetDb);

  it("does nothing before the station is imported", async () => {
    const { station } = await stationFixture();
    const result = await mirrorChangesetMoves(db, station.id, "cs-1", [{ rdjSongId: 1, toSubcat: 24, reason: "promote" }]);
    expect(result.skipped).toBe(true);
  });

  it("follows moves into pools and states, idempotently", async () => {
    const { station, a1, n, s } = await stationFixture();
    await importMembership(db, station.id);
    await db.insert(songCategories).values({ songId: s.a1.id, categoryId: n.id, role: "also" });

    // A1 → generic rest: rests FROM A1, keeps its pool and its extra eligibility.
    let r = await mirrorChangesetMoves(db, station.id, "cs-1", [{ rdjSongId: 1, toSubcat: 32, reason: "burned" }]);
    expect(r).toMatchObject({ skipped: false, changed: 1, missing: [] });
    expect(await placement(s.a1.id)).toEqual({ state: "resting", pools: [`also:${n.id}`, `primary:${a1.id}`] });

    // Back to N as its pool: the 'also' row is promoted rather than duplicated.
    await mirrorChangesetMoves(db, station.id, "cs-2", [{ rdjSongId: 1, toSubcat: 24, reason: "rest over" }]);
    expect(await placement(s.a1.id)).toEqual({ state: "active", pools: [`primary:${n.id}`] });

    // Bench clears every pool, and re-running the same changeset changes nothing.
    await mirrorChangesetMoves(db, station.id, "cs-3", [{ rdjSongId: 1, toSubcat: 35, reason: "bench" }]);
    r = await mirrorChangesetMoves(db, station.id, "cs-3", [
      { rdjSongId: 1, toSubcat: 35, reason: "bench" },
      { rdjSongId: 999, toSubcat: 5, reason: "not synced yet" },
    ]);
    expect(r).toMatchObject({ changed: 0, missing: [999] });
    expect(await placement(s.a1.id)).toEqual({ state: "benched", pools: [] });

    const events = await db
      .select()
      .from(lifecycleEvents)
      .where(and(eq(lifecycleEvents.songId, s.a1.id), eq(lifecycleEvents.source, "changeset")));
    expect(events.map((e) => e.sourceRef)).toEqual(["cs-1", "cs-2", "cs-3"]);
  });
});
