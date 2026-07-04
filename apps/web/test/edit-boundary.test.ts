import { eq } from "drizzle-orm";
import { logItems } from "@rotavox/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { applyReplace, applySwap, canEditItem, canMutateItem, EditRejectedError, setLocked, type LogItemRow } from "../src/lib/log-edits";
import { SAFETY_HORIZON_MINUTES } from "../src/lib/constants";
import { db } from "../src/lib/db";
import { resetDb } from "./helpers/db";
import { seedLog, seedLogItem, seedSong, seedStation } from "./helpers/fixtures";

const NOW = new Date("2026-07-03T12:00:00Z");

function makeItem(overrides: Partial<LogItemRow> = {}): LogItemRow {
  return {
    id: "item-1",
    logId: "log-1",
    sortOrder: 0,
    projectedAirAt: new Date(NOW.getTime() + SAFETY_HORIZON_MINUTES * 60_000 + 60_000),
    elementType: "music",
    songId: null,
    rdjSongId: null,
    clockPositionId: null,
    violations: null,
    locked: false,
    pushedAt: null,
    airedAt: null,
    ...overrides,
  };
}

describe("canEditItem / canMutateItem (pure boundary checks)", () => {
  it("rejects fixed_event regardless of timing", () => {
    const item = makeItem({ elementType: "fixed_event" });
    expect(canEditItem(item, NOW)).toEqual({ ok: false, reason: "fixed_event" });
  });

  it("rejects an already-pushed item", () => {
    const item = makeItem({ pushedAt: new Date(NOW.getTime() - 1000) });
    expect(canEditItem(item, NOW)).toEqual({ ok: false, reason: "already_pushed" });
  });

  it("rejects an item 1ms inside the safety horizon", () => {
    const item = makeItem({ projectedAirAt: new Date(NOW.getTime() + SAFETY_HORIZON_MINUTES * 60_000 - 1) });
    expect(canEditItem(item, NOW)).toEqual({ ok: false, reason: "within_safety_horizon" });
  });

  it("accepts an item exactly at the safety horizon boundary", () => {
    const item = makeItem({ projectedAirAt: new Date(NOW.getTime() + SAFETY_HORIZON_MINUTES * 60_000) });
    expect(canEditItem(item, NOW)).toEqual({ ok: true });
  });

  it("rejects an item with no projectedAirAt", () => {
    const item = makeItem({ projectedAirAt: null });
    expect(canEditItem(item, NOW)).toEqual({ ok: false, reason: "within_safety_horizon" });
  });

  it("canMutateItem additionally rejects a locked item that otherwise passes the boundary", () => {
    const item = makeItem({ locked: true });
    expect(canMutateItem(item, NOW)).toEqual({ ok: false, reason: "locked" });
  });

  it("canMutateItem accepts an unlocked item that passes the boundary", () => {
    const item = makeItem({ locked: false });
    expect(canMutateItem(item, NOW)).toEqual({ ok: true });
  });
});

describe("applyReplace / applySwap boundary enforcement (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function setupStationAndSongs() {
    const station = await seedStation();
    const songA = await seedSong(station.id, 1001);
    const songB = await seedSong(station.id, 1002);
    return { station, songA, songB };
  }

  const farFuture = () => new Date(Date.now() + 3_600_000);

  it("applyReplace rejects a fixed_event item; row untouched", async () => {
    const { station, songA, songB } = await setupStationAndSongs();
    const log = await seedLog(station.id, { status: "draft" });
    const item = await seedLogItem(log.id, {
      elementType: "fixed_event",
      songId: songA.id,
      rdjSongId: songA.rdjSongId,
      projectedAirAt: farFuture(),
    });

    await expect(applyReplace(log.id, item.id, songB.id)).rejects.toThrow(EditRejectedError);

    const [after] = await db.select().from(logItems).where(eq(logItems.id, item.id));
    expect(after.songId).toBe(songA.id);
  });

  it("applyReplace rejects an already-pushed item; row untouched", async () => {
    const { station, songA, songB } = await setupStationAndSongs();
    const log = await seedLog(station.id, { status: "draft" });
    const item = await seedLogItem(log.id, {
      songId: songA.id,
      rdjSongId: songA.rdjSongId,
      projectedAirAt: farFuture(),
      pushedAt: new Date(),
    });

    await expect(applyReplace(log.id, item.id, songB.id)).rejects.toThrow(EditRejectedError);

    const [after] = await db.select().from(logItems).where(eq(logItems.id, item.id));
    expect(after.songId).toBe(songA.id);
  });

  it("applyReplace rejects an item inside the safety horizon; row untouched", async () => {
    const { station, songA, songB } = await setupStationAndSongs();
    const log = await seedLog(station.id, { status: "draft" });
    const item = await seedLogItem(log.id, {
      songId: songA.id,
      rdjSongId: songA.rdjSongId,
      projectedAirAt: new Date(Date.now() + 5 * 60_000), // 5 min out, inside the 15 min horizon
    });

    await expect(applyReplace(log.id, item.id, songB.id)).rejects.toThrow(EditRejectedError);

    const [after] = await db.select().from(logItems).where(eq(logItems.id, item.id));
    expect(after.songId).toBe(songA.id);
  });

  it("applySwap rejects all-or-nothing when one side fails the boundary", async () => {
    const { station, songA, songB } = await setupStationAndSongs();
    const log = await seedLog(station.id, { status: "draft" });
    const editableItem = await seedLogItem(log.id, {
      sortOrder: 0,
      songId: songA.id,
      rdjSongId: songA.rdjSongId,
      projectedAirAt: farFuture(),
    });
    const pushedItem = await seedLogItem(log.id, {
      sortOrder: 1,
      songId: songB.id,
      rdjSongId: songB.rdjSongId,
      projectedAirAt: farFuture(),
      pushedAt: new Date(),
    });

    await expect(applySwap(log.id, editableItem.id, pushedItem.id)).rejects.toThrow(EditRejectedError);

    const [afterA] = await db.select().from(logItems).where(eq(logItems.id, editableItem.id));
    const [afterB] = await db.select().from(logItems).where(eq(logItems.id, pushedItem.id));
    expect(afterA.songId).toBe(songA.id);
    expect(afterB.songId).toBe(songB.id);
  });

  it("applyReplace and applySwap reject a locked item until it's explicitly unlocked", async () => {
    const { station, songA, songB } = await setupStationAndSongs();
    const log = await seedLog(station.id, { status: "draft" });
    const item = await seedLogItem(log.id, {
      songId: songA.id,
      rdjSongId: songA.rdjSongId,
      projectedAirAt: farFuture(),
      locked: true,
    });

    await expect(applyReplace(log.id, item.id, songB.id)).rejects.toThrow(EditRejectedError);

    await setLocked(log.id, item.id, false);
    const result = await applyReplace(log.id, item.id, songB.id);
    expect(result.item.songId).toBe(songB.id);
  });
});
