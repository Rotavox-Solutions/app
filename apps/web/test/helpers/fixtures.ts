import { categories, clockPositions, clocks, logItems, logs, songs, stations } from "@rotavox/schema";
import { db } from "../../src/lib/db";

export async function seedStation(overrides: Partial<typeof stations.$inferInsert> = {}) {
  const [row] = await db
    .insert(stations)
    .values({ name: "Test Station", timezone: "America/New_York", ...overrides })
    .returning();
  return row;
}

export async function seedCategory(stationId: string, overrides: Partial<typeof categories.$inferInsert> = {}) {
  const [row] = await db
    .insert(categories)
    .values({ stationId, name: "Test Category", kind: "music", ...overrides })
    .returning();
  return row;
}

export async function seedClock(stationId: string, overrides: Partial<typeof clocks.$inferInsert> = {}) {
  const [row] = await db.insert(clocks).values({ stationId, name: "Test Clock", ...overrides }).returning();
  return row;
}

export async function seedClockPosition(clockId: string, overrides: Partial<typeof clockPositions.$inferInsert> = {}) {
  const [row] = await db
    .insert(clockPositions)
    .values({ clockId, sortOrder: 0, positionType: "category", ...overrides })
    .returning();
  return row;
}

export async function seedSong(
  stationId: string,
  rdjSongId: number,
  overrides: Partial<typeof songs.$inferInsert> = {}
) {
  const [row] = await db
    .insert(songs)
    .values({
      stationId,
      rdjSongId,
      artist: "Test Artist",
      title: "Test Title",
      enabled: true,
      songType: 0,
      ...overrides,
    })
    .returning();
  return row;
}

export async function seedLog(stationId: string, overrides: Partial<typeof logs.$inferInsert> = {}) {
  const now = new Date();
  const [row] = await db
    .insert(logs)
    .values({
      stationId,
      startsAt: now,
      endsAt: new Date(now.getTime() + 3_600_000),
      status: "draft",
      ...overrides,
    })
    .returning();
  return row;
}

export async function seedLogItem(logId: string, overrides: Partial<typeof logItems.$inferInsert> = {}) {
  const [row] = await db
    .insert(logItems)
    .values({ logId, sortOrder: 0, elementType: "music", ...overrides })
    .returning();
  return row;
}
