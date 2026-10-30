import { beforeEach, describe, expect, it } from "vitest";
import {
  clockPositions,
  clockRevisions,
  clocks,
  createClock,
  deleteClock,
  formatGrid,
  getClockForEdit,
  logItems,
  saveClock,
  type ClockForEdit,
} from "@rotavox/schema";
import { asc, eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { resetDb } from "./helpers/db";
import { seedCategory, seedClock, seedClockPosition, seedLog, seedLogItem, seedStation } from "./helpers/fixtures";

describe("clock editing", () => {
  beforeEach(resetDb);

  async function seed() {
    const station = await seedStation();
    const a1 = await seedCategory(station.id, { name: "A1" });
    const a2 = await seedCategory(station.id, { name: "A2" });
    const liners = await seedCategory(station.id, { name: "Liners", kind: "imaging" });
    const backsell = await seedCategory(station.id, { name: "Back-sell", kind: "imaging" });
    const clock = await seedClock(station.id, { name: "ES" });
    const toh = await seedClockPosition(clock.id, {
      sortOrder: 1, positionType: "sweeper", categoryId: liners.id, targetOffsetSeconds: 0,
    });
    const song1 = await seedClockPosition(clock.id, {
      sortOrder: 2, positionType: "category", categoryId: a1.id,
      constraints: { fallbackCategoryId: a2.id, trimPriority: 3, moodTarget: "up" },
    });
    const sell = await seedClockPosition(clock.id, {
      sortOrder: 3, positionType: "sweeper", categoryId: backsell.id,
      constraints: { fallbackCategoryId: liners.id, anchorSortOrder: 2 },
    });
    const song2 = await seedClockPosition(clock.id, { sortOrder: 4, positionType: "category", categoryId: a2.id });
    const loaded = (await getClockForEdit(db, station.id, clock.id))!;
    return { station, a1, a2, liners, backsell, clock, toh, song1, sell, song2, loaded };
  }

  const draftOf = ({ id: _id, updatedAt: _u, ...d }: ClockForEdit) => d;
  const positionsOf = (clockId: string) =>
    db.select().from(clockPositions).where(eq(clockPositions.clockId, clockId)).orderBy(asc(clockPositions.sortOrder));

  it("loads a clock for the editor with anchors as keys and unknown constraints kept aside", async () => {
    const { loaded, song1, sell } = await seed();
    const p = loaded.positions;
    expect(p.map((x) => x.kind)).toEqual(["sweeper", "category", "sweeper", "category"]);
    expect(p[0].targetOffsetSeconds).toBe(0);
    expect(p[1]).toMatchObject({ trimPriority: 3, extra: { moodTarget: "up" } });
    expect(p[2]).toMatchObject({ key: sell.id, anchorKey: song1.id });
  });

  it("saves in place: ids kept, anchors follow a reorder, other constraints survive", async () => {
    const { station, clock, loaded, toh, song1, sell, song2, a1 } = await seed();
    const [t, s1, b, s2] = loaded.positions;
    const draft = { ...draftOf(loaded), positions: [t, s2, s1, b] }; // back-sell still about s1, now #3
    const result = await saveClock(db, station.id, clock.id, draft, { expectedUpdatedAt: loaded.updatedAt, userId: null });
    expect(result).toMatchObject({ added: 0, removed: 0 });

    const rows = await positionsOf(clock.id);
    expect(rows.map((r) => r.id)).toEqual([toh.id, song2.id, song1.id, sell.id]);
    expect(rows[3].constraints).toMatchObject({ anchorSortOrder: 3 });
    expect(rows[2]).toMatchObject({ categoryId: a1.id });
    expect(rows[2].constraints).toEqual({ fallbackCategoryId: expect.any(String), trimPriority: 3, moodTarget: "up" });
  });

  it("adds and removes positions, detaching logs from removed ones, and keeps the original as a revision", async () => {
    const { station, clock, loaded, song2, a1 } = await seed();
    const log = await seedLog(station.id);
    const item = await seedLogItem(log.id, { clockPositionId: song2.id });
    const kept = loaded.positions.slice(0, 3);
    const added = { ...kept[1], id: null, key: "new-1", trimPriority: null, extra: {}, categoryId: a1.id };
    await saveClock(db, station.id, clock.id, { ...draftOf(loaded), positions: [...kept, added] }, {
      expectedUpdatedAt: loaded.updatedAt,
      userId: null,
      note: "Swap the closer",
    });

    const rows = await positionsOf(clock.id);
    expect(rows).toHaveLength(4);
    expect(rows.some((r) => r.id === song2.id)).toBe(false);
    const [li] = await db.select().from(logItems).where(eq(logItems.id, item.id));
    expect(li.clockPositionId).toBeNull();

    const revs = await db.select().from(clockRevisions).where(eq(clockRevisions.clockId, clock.id)).orderBy(asc(clockRevisions.savedAt));
    expect(revs.map((r) => r.note)).toEqual(["As it stood before the first edit in Rotavox", "Swap the closer"]);
    expect((revs[0].snapshot as { positions: unknown[] }).positions).toHaveLength(4);
  });

  it("refuses a save made against an older version", async () => {
    const { station, clock, loaded } = await seed();
    await saveClock(db, station.id, clock.id, draftOf(loaded), { expectedUpdatedAt: loaded.updatedAt, userId: null });
    await expect(
      saveClock(db, station.id, clock.id, draftOf(loaded), { expectedUpdatedAt: loaded.updatedAt, userId: null })
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("lists every problem and changes nothing when a draft doesn't validate", async () => {
    const { station, clock, loaded, a1 } = await seed();
    const [t, s1, b, s2] = loaded.positions;
    const bad = {
      ...draftOf(loaded),
      name: "",
      positions: [
        { ...t, targetOffsetSeconds: 4000 },
        { ...s1, categoryId: null },
        { ...b, anchorKey: t.key },
        { ...s2, fallbackCategoryId: s2.categoryId, fillerPriority: 0 },
      ],
    };
    const err = await saveClock(db, station.id, clock.id, bad, { expectedUpdatedAt: loaded.updatedAt, userId: null }).catch(
      (e) => e
    );
    expect(err.problems).toEqual([
      "Give the clock a name.",
      "Position 1: its locked time has to fall inside the clock.",
      "Position 2: choose what it plays.",
      "Position 3: its copy can only be about a music position.",
      "Position 4: it can't fall back to itself.",
      "Position 4: filler priority is a whole number, 1 to 99.",
    ]);
    const rows = await positionsOf(clock.id);
    expect(rows[1].categoryId).toBe(a1.id);
    expect(await db.select().from(clockRevisions)).toHaveLength(0);
  });

  it("copies a clock with its positions, and deletes only a clock the grid doesn't play", async () => {
    const { station, clock } = await seed();
    const { id } = await createClock(db, station.id, { name: "ES copy", copyFromClockId: clock.id });
    const copy = (await getClockForEdit(db, station.id, id))!;
    expect(copy.positions).toHaveLength(4);
    expect(copy.positions[2].anchorKey).toBe(copy.positions[1].key);
    await expect(createClock(db, station.id, { name: "es" })).rejects.toMatchObject({ code: "invalid" });

    await db.insert(formatGrid).values({ stationId: station.id, dayOfWeek: 1, hour: 6, clockId: clock.id });
    await expect(deleteClock(db, station.id, clock.id)).rejects.toMatchObject({ code: "invalid" });
    await deleteClock(db, station.id, id);
    expect(await db.select().from(clocks).where(eq(clocks.id, id))).toHaveLength(0);
  });

  it("keeps one station's clocks from another", async () => {
    const { clock, loaded } = await seed();
    const other = await seedStation({ name: "Other" });
    expect(await getClockForEdit(db, other.id, clock.id)).toBeNull();
    await expect(
      saveClock(db, other.id, clock.id, draftOf(loaded), { expectedUpdatedAt: loaded.updatedAt, userId: null })
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteClock(db, other.id, clock.id)).rejects.toMatchObject({ code: "not_found" });
  });
});
