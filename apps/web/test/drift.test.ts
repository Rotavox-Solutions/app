import { beforeEach, describe, expect, it } from "vitest";
import {
  applyDraft,
  categories,
  findDrift,
  getDraft,
  listPendingProjections,
  reprojectDrift,
  songCategories,
  songs,
  stageChanges,
  stations,
  type ProjectedCategory,
} from "@rotavox/schema";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { planProjection } from "../../runner/src/projection";
import { resetDb } from "./helpers/db";
import { seedCategory, seedSong, seedStation } from "./helpers/fixtures";

describe("RadioDJ drift", () => {
  beforeEach(resetDb);

  async function seed() {
    const station = await seedStation({
      membershipImportedAt: new Date(),
      rdjLifecycleSubcats: { "35": { state: "benched" } },
    });
    const a1 = await seedCategory(station.id, { name: "A1", rdjSubcategoryIds: [10] });
    const r1 = await seedCategory(station.id, { name: "R1", rdjSubcategoryIds: [20, 21] });
    const unmapped = await seedCategory(station.id, { name: "Discovery" });
    const mk = async (n: number, subcat: number | null, categoryId: string | null, state = "active") => {
      const s = await seedSong(station.id, n, { artist: `Artist ${n}`, title: `Song ${n}`, rdjSubcategoryId: subcat, lifecycleState: state });
      if (categoryId) await db.insert(songCategories).values({ songId: s.id, categoryId });
      return s;
    };
    return {
      station, a1, r1, unmapped,
      inStep: await mk(1, 10, a1.id),
      otherR1Subcat: await mk(2, 21, r1.id), // R1 spans 20 and 21: not drift
      moved: await mk(3, 20, a1.id), // Rotavox A1, RadioDJ moved it to R1
      benched: await mk(4, 35, a1.id), // Rotavox A1, RadioDJ benched it
      toUnmapped: await mk(5, 99, a1.id), // RadioDJ moved it somewhere Rotavox has no pool for
      unprojectedPool: await mk(6, 77, unmapped.id), // Rotavox pool RadioDJ can't express: nothing to compare
      inbox: await mk(7, 99, null), // active with no pool is the Inbox's, not drift
    };
  }

  it("reports songs RadioDJ disagrees about, as placements, and nothing else", async () => {
    const { station, moved, benched, toUnmapped, r1 } = await seed();
    const report = await findDrift(db, station.id);
    expect(report.rows.map((r) => r.artist)).toEqual(["Artist 3", "Artist 4", "Artist 5"]);
    expect(report.rows[0]).toMatchObject({ songId: moved.id, radiodj: { state: "active", categoryId: r1.id }, canAccept: true, canReproject: true });
    expect(report.rows[1]).toMatchObject({ songId: benched.id, radiodj: { state: "benched", categoryId: null }, canAccept: true });
    expect(report.rows[2]).toMatchObject({ songId: toUnmapped.id, canAccept: false, canReproject: true });
  });

  it("is quiet before the import and while a change is on its way to RadioDJ", async () => {
    const { station, moved, r1 } = await seed();
    await db.update(stations).set({ membershipImportedAt: null }).where(eq(stations.id, station.id));
    expect((await findDrift(db, station.id)).rows).toHaveLength(0);
    await db.update(stations).set({ membershipImportedAt: new Date() }).where(eq(stations.id, station.id));

    // Accepting RadioDJ's filing for the moved song: once applied, Rotavox agrees.
    await stageChanges(db, station.id, [{ songId: moved.id, to: { state: "active", categoryId: r1.id } }]);
    expect((await findDrift(db, station.id)).rows.find((r) => r.songId === moved.id)?.staged).toBe(true);
    await applyDraft(db, station.id, { intent: "Keep RadioDJ's" });
    const after = await findDrift(db, station.id);
    expect(after.rows.some((r) => r.songId === moved.id)).toBe(false);
  });

  it("re-projects as an applied change that leaves Rotavox alone and moves RadioDJ back", async () => {
    const { station, moved, toUnmapped, a1 } = await seed();
    const r = await reprojectDrift(db, station.id, [moved.id, toUnmapped.id], { appliedBy: null });
    expect(r.songs).toBe(2);
    expect(await getDraft(db, station.id)).toBeNull();
    // Rotavox placements untouched.
    const [sc] = await db.select().from(songCategories).where(eq(songCategories.songId, moved.id));
    expect(sc.categoryId).toBe(a1.id);
    // While the write is pending, the songs aren't reported as drift.
    const during = await findDrift(db, station.id);
    expect(during.rows.map((x) => x.songId)).not.toContain(moved.id);
    expect(during.awaitingProjection).toBe(2);

    // The Runner's own planner turns it into moves back to A1's subcategory.
    const [pending] = await listPendingProjections(db, station.id);
    const cats = (await db.select({ id: categories.id, name: categories.name, rdjSubcategoryIds: categories.rdjSubcategoryIds })
      .from(categories).where(eq(categories.stationId, station.id))) as ProjectedCategory[];
    const plan = planProjection(pending, station.id, cats, { "35": { state: "benched" } });
    expect(plan.errors).toEqual([]);
    expect(plan.changeset!.moves!.map((m) => [m.rdj_song_id, m.from_subcat, m.to_subcat]).sort()).toEqual([
      [3, 20, 10],
      [5, 99, 10],
    ]);
  });

  it("skips songs that no longer drift", async () => {
    const { station, moved } = await seed();
    await db.update(songs).set({ rdjSubcategoryId: 10 }).where(eq(songs.id, moved.id));
    expect(await reprojectDrift(db, station.id, [moved.id])).toEqual({ changesetId: null, songs: 0 });
  });
});
