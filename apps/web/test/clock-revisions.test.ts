import { beforeEach, describe, expect, it } from "vitest";
import { clockPositions, getClockForEdit, listClockRevisions, saveClock, type ClockForEdit } from "@rotavox/schema";
import { asc, eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { describeDifference, draftFromSnapshot } from "../src/components/format/revisions";
import { resetDb } from "./helpers/db";
import { seedCategory, seedClock, seedClockPosition, seedStation } from "./helpers/fixtures";

const draftOf = ({ id: _id, updatedAt: _u, ...d }: ClockForEdit) => d;

describe("clock revisions", () => {
  beforeEach(resetDb);

  it("restores an older version through the editor's draft, keeping position ids by number", async () => {
    const station = await seedStation();
    const a1 = await seedCategory(station.id, { name: "A1" });
    const a2 = await seedCategory(station.id, { name: "A2" });
    const sell = await seedCategory(station.id, { name: "Back-sell", kind: "imaging" });
    const clock = await seedClock(station.id, { name: "ES" });
    await seedClockPosition(clock.id, { sortOrder: 1, positionType: "category", categoryId: a1.id });
    await seedClockPosition(clock.id, {
      sortOrder: 2, positionType: "sweeper", categoryId: sell.id,
      constraints: { fallbackCategoryId: a2.id, anchorSortOrder: 1 },
    });
    await seedClockPosition(clock.id, { sortOrder: 3, positionType: "category", categoryId: a2.id });
    const original = (await getClockForEdit(db, station.id, clock.id))!;
    const ids = original.positions.map((p) => p.id);

    // Edit: drop the last position and swap the first for A2, then save.
    const edited = draftOf(original);
    edited.positions = [{ ...edited.positions[0], categoryId: a2.id }, edited.positions[1]];
    await saveClock(db, station.id, clock.id, edited, { expectedUpdatedAt: original.updatedAt, userId: null, note: "Trim" });

    const revs = await listClockRevisions(db, station.id, clock.id);
    expect(revs.map((r) => r.note)).toEqual(["Trim", "As it stood before the first edit in Rotavox"]);
    const now = (await getClockForEdit(db, station.id, clock.id))!;
    expect(describeDifference(draftFromSnapshot(revs[0].snapshot, draftOf(now)), draftOf(now))).toBe("same as now");
    expect(describeDifference(draftFromSnapshot(revs[1].snapshot, draftOf(now)), draftOf(now))).toBe(
      "3 positions, not 2 · 2 positions differ"
    );

    // Restore the original: positions 1 and 2 keep their ids, 3 comes back as new, the anchor holds.
    const restored = draftFromSnapshot(revs[1].snapshot, draftOf(now));
    expect(restored.positions[1].anchorKey).toBe(restored.positions[0].key);
    await saveClock(db, station.id, clock.id, restored, { expectedUpdatedAt: now.updatedAt, userId: null, note: "Restore" });

    const rows = await db.select().from(clockPositions).where(eq(clockPositions.clockId, clock.id)).orderBy(asc(clockPositions.sortOrder));
    expect(rows.map((r) => r.categoryId)).toEqual([a1.id, sell.id, a2.id]);
    expect(rows.slice(0, 2).map((r) => r.id)).toEqual(ids.slice(0, 2));
    expect(rows[1].constraints).toMatchObject({ anchorSortOrder: 1 });
    expect((await listClockRevisions(db, station.id, clock.id))[0].note).toBe("Restore");
  });

  it("lists no revisions for another station or a malformed id", async () => {
    const station = await seedStation();
    const clock = await seedClock(station.id);
    const other = await seedStation({ name: "Other" });
    expect(await listClockRevisions(db, other.id, clock.id)).toEqual([]);
    expect(await listClockRevisions(db, station.id, "nope")).toEqual([]);
  });
});
