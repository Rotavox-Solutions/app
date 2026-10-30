import { beforeEach, describe, expect, it } from "vitest";
import { weekInCycle, localParts } from "@rotavox/engine";
import { formatGrid, getGridForEdit, listGridRevisions, setRotation, setStationName, stations } from "@rotavox/schema";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { epochForAiringWeek } from "../src/lib/rotation";
import { resetDb } from "./helpers/db";
import { seedClock, seedStation } from "./helpers/fixtures";

describe("rotation epoch", () => {
  const now = new Date("2026-10-30T22:00:00Z");

  it("makes the chosen week the airing one, in whole weeks from the existing epoch", () => {
    const epoch = new Date("2026-08-03T12:00:00Z");
    for (const tz of ["America/New_York", "Pacific/Auckland", "Pacific/Kiritimati", "America/Adak"]) {
      for (let target = 0; target < 3; target++) {
        const e = epochForAiringWeek(epoch, 3, target, tz, now);
        expect(weekInCycle(now, e, 3, tz)).toBe(target);
        expect((e.getTime() - epoch.getTime()) % (7 * 86_400_000)).toBe(0);
      }
    }
  });

  it("starts weeks on a Monday when there's no epoch yet", () => {
    for (const tz of ["America/New_York", "Asia/Tokyo"]) {
      const e = epochForAiringWeek(null, 2, 1, tz, now);
      expect(weekInCycle(now, e, 2, tz)).toBe(1);
      expect(localParts(e, tz).dayOfWeek).toBe(1);
    }
  });
});

describe("station settings", () => {
  beforeEach(resetDb);

  async function seed() {
    const station = await seedStation();
    await db.update(stations).set({ formatCycleWeeks: 2, formatCycleEpoch: new Date("2026-08-03T12:00:00Z") }).where(eq(stations.id, station.id));
    const es = await seedClock(station.id, { name: "ES" });
    const ff = await seedClock(station.id, { name: "FF" });
    await db.insert(formatGrid).values([
      { stationId: station.id, weekInCycle: 0, dayOfWeek: 1, hour: 6, clockId: es.id },
      { stationId: station.id, weekInCycle: 0, dayOfWeek: 1, hour: 7, clockId: es.id },
      { stationId: station.id, weekInCycle: 1, dayOfWeek: 1, hour: 6, clockId: ff.id },
    ]);
    return { station, es, ff, grid: (await getGridForEdit(db, station.id))! };
  }

  it("grows the rotation by copying week 1, and shrinks it by dropping weeks, recording each", async () => {
    const { station, es, grid } = await seed();
    const grown = await setRotation(db, station.id, { cycleWeeks: 3, epoch: null }, { expectedUpdatedAt: grid.updatedAt, userId: null });
    expect(grown).toMatchObject({ copied: 2, dropped: 0 });
    let g = (await getGridForEdit(db, station.id))!;
    expect(g.cycleWeeks).toBe(3);
    expect(g.cycleEpoch).toEqual(new Date("2026-08-03T12:00:00Z"));
    expect(g.cells.filter((c) => c.weekInCycle === 2).map((c) => [c.hour, c.clockId])).toEqual([
      [6, es.id],
      [7, es.id],
    ]);

    const shrunk = await setRotation(db, station.id, { cycleWeeks: 1, epoch: null }, { expectedUpdatedAt: g.updatedAt, userId: null, note: "Back to one" });
    expect(shrunk).toMatchObject({ copied: 0, dropped: 3 });
    g = (await getGridForEdit(db, station.id))!;
    expect(g.cells).toHaveLength(2);
    expect((await listGridRevisions(db, station.id)).map((r) => r.note)).toEqual([
      "Rotation 3 → 1 week: Back to one",
      "Rotation 2 → 3 weeks",
      "As it stood before the first edit in Rotavox",
    ]);

    await expect(
      setRotation(db, station.id, { cycleWeeks: 2, epoch: null }, { expectedUpdatedAt: grid.updatedAt, userId: null })
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      setRotation(db, station.id, { cycleWeeks: 9, epoch: null }, { expectedUpdatedAt: g.updatedAt, userId: null })
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("moves the airing week without touching the grid", async () => {
    const { station, grid } = await seed();
    const epoch = new Date("2026-08-10T12:00:00Z");
    const r = await setRotation(db, station.id, { cycleWeeks: 2, epoch }, { expectedUpdatedAt: grid.updatedAt, userId: null });
    expect(r).toMatchObject({ copied: 0, dropped: 0 });
    const g = (await getGridForEdit(db, station.id))!;
    expect(g.cycleEpoch).toEqual(epoch);
    expect(g.cells).toHaveLength(3);
    expect((await listGridRevisions(db, station.id))[0].note).toBe("Moved which week is airing");
  });

  it("renames the station, refusing a blank or overlong name", async () => {
    const { station } = await seed();
    await setStationName(db, station.id, "  The BOLT  ");
    expect((await db.select().from(stations).where(eq(stations.id, station.id)))[0].name).toBe("The BOLT");
    await expect(setStationName(db, station.id, " ")).rejects.toMatchObject({ code: "invalid" });
    await expect(setStationName(db, station.id, "x".repeat(61))).rejects.toMatchObject({ code: "invalid" });
  });
});
