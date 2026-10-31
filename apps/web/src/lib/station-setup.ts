// How far a station has got from empty to its first approved log: the steps a PD works
// through after Rotavox staff set it up, each read from what's already there.
import { and, eq, inArray, sql } from "drizzle-orm";
import { categories, clockPositions, clocks, formatGrid, logs, songCategories, songs, stationMembers } from "@rotavox/schema";
import { db } from "./db";

export interface SetupStep {
  key: "library" | "pools" | "placed" | "clocks" | "grid" | "log" | "people";
  done: boolean;
  /** What's there so far, e.g. "1,204 songs". */
  detail: string;
}

const n = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
const count = sql<number>`count(*)::int`;

export async function getSetupSteps(stationId: string): Promise<SetupStep[]> {
  const [[lib], [pools], [placed], [clockRow], [grid], [approved], [people]] = await Promise.all([
    db.select({ count }).from(songs).where(and(eq(songs.stationId, stationId), sql`${songs.rdjSongId} > 0`)),
    db.select({ count }).from(categories).where(and(eq(categories.stationId, stationId), eq(categories.kind, "music"))),
    db
      .select({ count: sql<number>`count(distinct ${songCategories.songId})::int` })
      .from(songCategories)
      .innerJoin(songs, eq(songs.id, songCategories.songId))
      .where(and(eq(songs.stationId, stationId), eq(songCategories.role, "primary"))),
    // A clock with nothing in it can't fill an hour, so only clocks with positions count.
    db
      .select({ count: sql<number>`count(distinct ${clocks.id})::int` })
      .from(clocks)
      .innerJoin(clockPositions, eq(clockPositions.clockId, clocks.id))
      .where(eq(clocks.stationId, stationId)),
    db.select({ count }).from(formatGrid).where(eq(formatGrid.stationId, stationId)),
    db.select({ count }).from(logs).where(and(eq(logs.stationId, stationId), inArray(logs.status, ["approved", "airing", "aired"]))),
    db.select({ count }).from(stationMembers).where(eq(stationMembers.stationId, stationId)),
  ]);
  return [
    { key: "pools", done: pools.count > 0, detail: n(pools.count, "music category", "music categories") },
    { key: "library", done: lib.count > 0, detail: n(lib.count, "song") },
    { key: "placed", done: placed.count > 0, detail: `${n(placed.count, "song")} in a category` },
    { key: "clocks", done: clockRow.count > 0, detail: n(clockRow.count, "clock") },
    { key: "grid", done: grid.count > 0, detail: `${n(grid.count, "hour")} of the week` },
    { key: "log", done: approved.count > 0, detail: n(approved.count, "approved log") },
    { key: "people", done: people.count > 0, detail: n(people.count, "person", "people") },
  ];
}
