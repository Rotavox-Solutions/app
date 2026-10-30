import { beforeEach, describe, expect, it } from "vitest";
import {
  applyDraft,
  categories,
  ChangesetError,
  deriveDirection,
  setPoolLifecycle,
  songCategories,
  stageChanges,
} from "@rotavox/schema";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { getLifecycleOverview, isRestDue } from "../src/lib/library";
import { directionsFor } from "../src/lib/direction";
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

  it("sets and clears a pool's lifecycle settings, refusing nonsense and other stations' pools", async () => {
    const station = await seedStation();
    const other = await seedStation({ name: "Other" });
    const a1 = await seedCategory(station.id, { name: "A1" });
    const read = async () => (await db.select().from(categories).where(eq(categories.id, a1.id)))[0];

    await setPoolLifecycle(db, station.id, a1.id, { restReviewDays: 60, ladderRank: 1 });
    expect(await read()).toMatchObject({ restReviewDays: 60, ladderRank: 1, fallingAfterDays: null });
    await setPoolLifecycle(db, station.id, a1.id, { restReviewDays: null, fallingAfterDays: 42 });
    expect(await read()).toMatchObject({ restReviewDays: null, ladderRank: 1, fallingAfterDays: 42 });

    for (const bad of [0, 1.5, 9999]) {
      await expect(setPoolLifecycle(db, station.id, a1.id, { restReviewDays: bad })).rejects.toMatchObject({ code: "invalid" });
    }
    await expect(setPoolLifecycle(db, station.id, a1.id, { ladderRank: 21 })).rejects.toMatchObject({ code: "invalid" });
    await expect(setPoolLifecycle(db, station.id, a1.id, {})).rejects.toMatchObject({ code: "invalid" });
    await expect(setPoolLifecycle(db, other.id, a1.id, { ladderRank: 2 })).rejects.toBeInstanceOf(ChangesetError);
    await expect(setPoolLifecycle(db, station.id, "not-a-uuid", { ladderRank: 2 })).rejects.toMatchObject({ code: "not_found" });
    expect(await read()).toMatchObject({ restReviewDays: null, ladderRank: 1, fallingAfterDays: 42 });
  });
});

describe("rising and falling", () => {
  beforeEach(resetDb);

  const now = new Date("2026-10-30T12:00:00Z");
  const at = (d: number) => new Date(now.getTime() - d * 86_400_000);
  const pool = (ladderRank: number | null, fallingAfterDays: number | null = null) => ({ ladderRank, fallingAfterDays });

  it("derives direction from where a song came from on the ladder, and from time in its pool", () => {
    const b = pool(3, 42);
    expect(deriveDirection("active", b, { at: at(5), from: pool(1), known: true }, now)).toEqual({ direction: "falling", why: "came_down", days: 5 });
    expect(deriveDirection("active", b, { at: at(5), from: pool(4), known: true }, now)).toEqual({ direction: "rising", why: "came_up", days: 5 });
    expect(deriveDirection("active", b, { at: at(5), from: null, known: true }, now)).toEqual({ direction: "rising", why: "new", days: 5 });
    expect(deriveDirection("active", b, { at: at(5), from: pool(null), known: true }, now)).toMatchObject({ why: "new" });
    // Time overrides how it arrived.
    expect(deriveDirection("active", b, { at: at(50), from: pool(4), known: true }, now)).toEqual({ direction: "falling", why: "time", days: 50 });
    // Back from rest in the same pool: no direction until time says so.
    expect(deriveDirection("active", b, { at: at(5), from: pool(3), known: true }, now)).toBeNull();
    // The import knows when, not from where.
    expect(deriveDirection("active", b, { at: at(5), from: null, known: false }, now)).toBeNull();
    expect(deriveDirection("active", b, { at: at(60), from: null, known: false }, now)).toMatchObject({ why: "time" });
    // Off the ladder, or not active: none.
    expect(deriveDirection("active", pool(null, 1), { at: at(60), from: pool(1), known: true }, now)).toBeNull();
    expect(deriveDirection("resting", b, { at: at(60), from: pool(1), known: true }, now)).toBeNull();
  });

  it("reads each song's entry into its pool from its history", async () => {
    const station = await seedStation({ membershipImportedAt: new Date() });
    const a1 = await seedCategory(station.id, { name: "A1", ladderRank: 1 });
    const b = await seedCategory(station.id, { name: "B", ladderRank: 3, fallingAfterDays: 42 });
    const n = await seedCategory(station.id, { name: "N", ladderRank: 4 });
    const r1 = await seedCategory(station.id, { name: "R1" });
    const down = await seedSong(station.id, 1, { artist: "Down" });
    const up = await seedSong(station.id, 2, { artist: "Up" });
    const fresh = await seedSong(station.id, 3, { artist: "Fresh" });
    const off = await seedSong(station.id, 4, { artist: "Off ladder" });
    await db.insert(songCategories).values([
      { songId: down.id, categoryId: a1.id },
      { songId: up.id, categoryId: n.id },
      { songId: off.id, categoryId: a1.id },
    ]);
    await stageChanges(db, station.id, [
      { songId: down.id, to: { state: "active", categoryId: b.id } },
      { songId: up.id, to: { state: "active", categoryId: b.id } },
      { songId: fresh.id, to: { state: "active", categoryId: b.id } },
      { songId: off.id, to: { state: "active", categoryId: r1.id } },
    ]);
    await applyDraft(db, station.id, { intent: "Weekly moves" });

    const rows = [down, up, fresh, off].map((s) => ({ id: s.id, state: "active", poolId: s === off ? r1.id : b.id }));
    const d = await directionsFor(station.id, rows);
    expect(d[down.id]).toMatchObject({ direction: "falling", why: "came_down" });
    expect(d[up.id]).toMatchObject({ direction: "rising", why: "came_up" });
    expect(d[fresh.id]).toMatchObject({ direction: "rising", why: "new" });
    expect(d[off.id]).toBeUndefined();

    const o = await getLifecycleOverview(station.id);
    expect(o.falling.map((r) => r.artist)).toEqual(["Down"]);
    expect(o.standards.map((p) => [p.name, p.falling])).toEqual([
      ["A1", 0],
      ["B", 1],
      ["N", 0],
      ["R1", 0],
    ]);
  });
});
