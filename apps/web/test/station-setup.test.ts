import { beforeEach, describe, expect, it } from "vitest";
import { createRunnerKey, createStation, isTimeZone, libraryFromFile, stations } from "@rotavox/schema";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { getSetupSteps } from "../src/lib/station-setup";
import { resetDb } from "./helpers/db";
import { seedCategory, seedClock, seedClockPosition, seedSong } from "./helpers/fixtures";

beforeEach(resetDb);

describe("setting up a station", () => {
  it("makes a file station tier 0: approved logs count as aired, Rotavox owns the pools", async () => {
    const now = new Date("2026-10-31T12:00:00Z");
    const { id } = await createStation(db, { name: "  KXYZ  ", timezone: "America/Chicago", playout: "file", now });
    const [st] = await db.select().from(stations).where(eq(stations.id, id));
    expect(st).toMatchObject({ name: "KXYZ", timezone: "America/Chicago", playout: "file", assumeLogAired: true, membershipImportedAt: now });
    expect(await libraryFromFile(db, id)).toBe(true);
  });

  it("leaves a RadioDJ station to its Runner's sync and the one-time pool import", async () => {
    const { id } = await createStation(db, { name: "The BOLT", timezone: "America/New_York", playout: "radiodj" });
    const [st] = await db.select().from(stations).where(eq(stations.id, id));
    expect(st).toMatchObject({ playout: "radiodj", assumeLogAired: false, membershipImportedAt: null });
    expect(await libraryFromFile(db, id)).toBe(false);
  });

  it("refuses a missing name, an unknown time zone or playout", async () => {
    await expect(createStation(db, { name: " ", timezone: "UTC", playout: "file" })).rejects.toMatchObject({ code: "invalid" });
    await expect(createStation(db, { name: "A", timezone: "Mars/Olympus", playout: "file" })).rejects.toMatchObject({ code: "invalid" });
    await expect(createStation(db, { name: "A", timezone: "EST", playout: "file" })).rejects.toMatchObject({ code: "invalid" });
    await expect(createStation(db, { name: "A", timezone: "UTC", playout: "zara" as "file" })).rejects.toMatchObject({ code: "invalid" });
    expect(isTimeZone("Europe/London")).toBe(true);
  });

  it("a file station stops taking file imports once it has a Runner", async () => {
    const { id } = await createStation(db, { name: "A", timezone: "UTC", playout: "file" });
    await createRunnerKey(db, { stationId: id, label: "Box", createdBy: null });
    expect(await libraryFromFile(db, id)).toBe(false);
  });
});

describe("setup steps", () => {
  it("reads progress from what's there", async () => {
    const { id } = await createStation(db, { name: "A", timezone: "UTC", playout: "file" });
    const done = async () => Object.fromEntries((await getSetupSteps(id)).map((s) => [s.key, s.done]));
    expect(Object.values(await done()).every((d) => !d)).toBe(true);

    await seedSong(id, 1);
    const pool = await seedCategory(id, { name: "A1" });
    const empty = await seedClock(id, { name: "Empty" });
    expect(await done()).toMatchObject({ library: true, pools: true, placed: false, clocks: false });

    const clock = await seedClock(id, { name: "Hour" });
    await seedClockPosition(clock.id, { categoryId: pool.id });
    const steps = await getSetupSteps(id);
    expect(steps.find((s) => s.key === "clocks")).toMatchObject({ done: true, detail: "1 clock" });
    expect(steps.find((s) => s.key === "library")?.detail).toBe("1 song");
    void empty;
  });
});
