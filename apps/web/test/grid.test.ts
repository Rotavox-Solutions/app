import { beforeEach, describe, expect, it } from "vitest";
import { formatGrid, getGridForEdit, listGridRevisions, saveGrid, stations } from "@rotavox/schema";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { resetDb } from "./helpers/db";
import { seedClock, seedStation } from "./helpers/fixtures";

describe("week grid editing", () => {
  beforeEach(resetDb);

  async function seed() {
    const station = await seedStation();
    await db.update(stations).set({ formatCycleWeeks: 2 }).where(eq(stations.id, station.id));
    const es = await seedClock(station.id, { name: "ES" });
    const ff = await seedClock(station.id, { name: "FF" });
    await db.insert(formatGrid).values([
      { stationId: station.id, weekInCycle: 0, dayOfWeek: 1, hour: 6, clockId: es.id },
      { stationId: station.id, weekInCycle: 1, dayOfWeek: 1, hour: 6, clockId: es.id },
    ]);
    return { station, es, ff, grid: (await getGridForEdit(db, station.id))! };
  }

  it("replaces the grid whole, keeps the original as a revision, and refuses a stale save", async () => {
    const { station, es, ff, grid } = await seed();
    expect(grid).toMatchObject({ cycleWeeks: 2 });
    expect(grid.cells).toHaveLength(2);

    const cells = [
      { weekInCycle: 0, dayOfWeek: 1, hour: 6, clockId: ff.id },
      { weekInCycle: 1, dayOfWeek: 1, hour: 6, clockId: es.id },
      { weekInCycle: 1, dayOfWeek: 0, hour: 23, clockId: ff.id },
    ];
    const result = await saveGrid(db, station.id, cells, { expectedUpdatedAt: grid.updatedAt, userId: null, note: "FF mornings" });
    expect(result).toMatchObject({ cells: 3, empty: 2 * 7 * 24 - 3 });

    const after = (await getGridForEdit(db, station.id))!;
    expect(after.cells).toEqual([
      { weekInCycle: 0, dayOfWeek: 1, hour: 6, clockId: ff.id },
      { weekInCycle: 1, dayOfWeek: 0, hour: 23, clockId: ff.id },
      { weekInCycle: 1, dayOfWeek: 1, hour: 6, clockId: es.id },
    ]);
    const revs = await listGridRevisions(db, station.id);
    expect(revs.map((r) => r.note)).toEqual(["FF mornings", "As it stood before the first edit in Rotavox"]);
    expect(revs[1].snapshot.cells).toHaveLength(2);

    await expect(saveGrid(db, station.id, cells, { expectedUpdatedAt: grid.updatedAt, userId: null })).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("refuses cells outside the cycle, doubled up, or playing another station's clock, and changes nothing", async () => {
    const { station, es, grid } = await seed();
    const other = await seedStation({ name: "Other" });
    const foreign = await seedClock(other.id, { name: "XX" });
    const err = await saveGrid(
      db,
      station.id,
      [
        { weekInCycle: 2, dayOfWeek: 1, hour: 6, clockId: es.id },
        { weekInCycle: 0, dayOfWeek: 1, hour: 7, clockId: es.id },
        { weekInCycle: 0, dayOfWeek: 1, hour: 7, clockId: es.id },
        { weekInCycle: 0, dayOfWeek: 2, hour: 7, clockId: foreign.id },
      ],
      { expectedUpdatedAt: grid.updatedAt, userId: null }
    ).catch((e) => e);
    expect(err.problems).toEqual([
      "A cell falls outside the week grid.",
      "Week 1, Monday 7:00 is set twice.",
      "A cell plays a clock that isn't at this station.",
    ]);
    expect((await getGridForEdit(db, station.id))!.cells).toHaveLength(2);
    expect(await listGridRevisions(db, station.id)).toHaveLength(0);
  });

  it("allows an empty grid hour, which the engine skips", async () => {
    const { station, es, grid } = await seed();
    const r = await saveGrid(db, station.id, [{ weekInCycle: 0, dayOfWeek: 1, hour: 6, clockId: es.id }], {
      expectedUpdatedAt: grid.updatedAt,
      userId: null,
    });
    expect(r.cells).toBe(1);
  });
});
