import { beforeEach, describe, expect, it } from "vitest";
import { applyDraft, categories, ChangesetError, setRestReviewDays, songCategories, stageChanges } from "@rotavox/schema";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { getLifecycleOverview, isRestDue } from "../src/lib/library";
import { resetDb } from "./helpers/db";
import { seedCategory, seedSong, seedStation } from "./helpers/fixtures";

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

describe("lifecycle", () => {
  beforeEach(resetDb);

  it("calls a rest due only past its pool's standard", () => {
    expect(isRestDue({ state: "resting", since: daysAgo(91), restReviewDays: 90 })).toBe(true);
    expect(isRestDue({ state: "resting", since: daysAgo(89), restReviewDays: 90 })).toBe(false);
    expect(isRestDue({ state: "resting", since: daysAgo(500), restReviewDays: null })).toBe(false);
    expect(isRestDue({ state: "active", since: daysAgo(500), restReviewDays: 90 })).toBe(false);
  });

  it("splits resting songs, counts them per pool, and lists transitions made in Rotavox", async () => {
    const station = await seedStation({ membershipImportedAt: new Date() });
    const currents = await seedCategory(station.id, { name: "Currents" });
    const a1 = await seedCategory(station.id, { name: "A1", parentId: currents.id, restReviewDays: 90 });
    const r1 = await seedCategory(station.id, { name: "R1" });
    await seedCategory(station.id, { name: "Sweepers", kind: "imaging" });
    const old = await seedSong(station.id, 1, { artist: "Old", lifecycleState: "resting", lifecycleSince: daysAgo(120) });
    const fresh = await seedSong(station.id, 2, { artist: "Fresh", lifecycleState: "resting", lifecycleSince: daysAgo(10) });
    const moving = await seedSong(station.id, 3, { artist: "Moving" });
    await seedSong(station.id, 4, { artist: "Benched", lifecycleState: "benched" });
    await db.insert(songCategories).values([
      { songId: old.id, categoryId: a1.id },
      { songId: fresh.id, categoryId: a1.id },
      { songId: moving.id, categoryId: a1.id },
    ]);
    await stageChanges(db, station.id, [{ songId: moving.id, to: { state: "active", categoryId: r1.id } }]);
    const { changesetId } = await applyDraft(db, station.id, { intent: "Moving to recurrent" });

    const o = await getLifecycleOverview(station.id);
    expect(o.counts).toEqual({ active: 1, resting: 2, benched: 1, retired: 0 });
    expect(o.resting.map((r) => r.artist)).toEqual(["Old", "Fresh"]);
    // Leaf music pools only: not the Currents group, not imaging.
    expect(o.standards.map((s) => [s.name, s.restReviewDays, s.resting, s.due])).toEqual([
      ["A1", 90, 2, 1],
      ["R1", null, 0, 0],
    ]);
    expect(o.recent).toHaveLength(1);
    expect(o.recent[0]).toMatchObject({
      artist: "Moving",
      fromCategoryName: "A1",
      toCategoryName: "R1",
      changesetId,
      reason: "Moving to recurrent",
    });
  });

  it("sets and clears a pool's rest standard, refusing nonsense and other stations' pools", async () => {
    const station = await seedStation();
    const other = await seedStation({ name: "Other" });
    const a1 = await seedCategory(station.id, { name: "A1" });
    const read = async () => (await db.select().from(categories).where(eq(categories.id, a1.id)))[0].restReviewDays;

    await setRestReviewDays(db, station.id, a1.id, 60);
    expect(await read()).toBe(60);
    await setRestReviewDays(db, station.id, a1.id, null);
    expect(await read()).toBeNull();

    for (const bad of [0, 1.5, 9999]) {
      await expect(setRestReviewDays(db, station.id, a1.id, bad)).rejects.toMatchObject({ code: "invalid" });
    }
    await expect(setRestReviewDays(db, other.id, a1.id, 30)).rejects.toBeInstanceOf(ChangesetError);
    await expect(setRestReviewDays(db, station.id, "not-a-uuid", 30)).rejects.toMatchObject({ code: "not_found" });
    expect(await read()).toBeNull();
  });
});
