import { beforeEach, describe, expect, it } from "vitest";
import { formatGrid, playHistory, songCategories } from "@rotavox/schema";
import { db } from "../src/lib/db";
import { getCategoryBalance, getPoolSongs } from "../src/lib/queries";
import { resetDb } from "./helpers/db";
import { seedCategory, seedClock, seedClockPosition, seedSong, seedStation } from "./helpers/fixtures";

describe("category balance queries", () => {
  beforeEach(resetDb);

  it("loads depth, slots and recent spins from the DB", async () => {
    const station = await seedStation();
    const a1 = await seedCategory(station.id, { name: "A1", defaultTargetTurnoverHours: 6 });
    const clock = await seedClock(station.id);
    await seedClockPosition(clock.id, { categoryId: a1.id });
    await db.insert(formatGrid).values(
      Array.from({ length: 24 }, (_, hour) => ({ stationId: station.id, dayOfWeek: 1, hour, clockId: clock.id }))
    );
    const on = await seedSong(station.id, 1, { artist: "B", enabled: true });
    const off = await seedSong(station.id, 2, { artist: "A", enabled: false });
    await db.insert(songCategories).values([
      { songId: on.id, categoryId: a1.id },
      { songId: off.id, categoryId: a1.id },
    ]);
    const hourAgo = new Date(Date.now() - 3_600_000);
    const monthAgo = new Date(Date.now() - 30 * 24 * 3_600_000);
    await db.insert(playHistory).values([
      { stationId: station.id, songId: on.id, rdjSongId: 1, airedAt: hourAgo, source: "reconciled" },
      { stationId: station.id, songId: on.id, rdjSongId: 1, airedAt: monthAgo, source: "reconciled" },
    ]);

    const [row] = await getCategoryBalance(station.id);
    expect(row).toMatchObject({ name: "A1", depth: 2, enabledDepth: 1, weeklySlots: 24, recentSpins: 1 });
    expect(row.projectedTurnoverHours).toBe(7);

    const songs = await getPoolSongs(station.id, a1.id);
    expect(songs.map((s) => s.artist)).toEqual(["A", "B"]);
    expect(songs[1].recentSpins).toBe(1);
    expect(songs[1].lastAiredAt?.getTime()).toBeCloseTo(hourAgo.getTime(), -3);
    expect(songs[0].lastAiredAt).toBeNull();
  });
});
