import { eq } from "drizzle-orm";
import { logItems, logs, playHistory } from "@rotavox/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteLogHours, EditRejectedError, regenerateLogHours, removableFrom } from "../src/lib/log-edits";
import { db } from "../src/lib/db";
import { HOUR_MS } from "../src/lib/constants";
import { resetDb } from "./helpers/db";
import { seedLog, seedLogItem, seedSong, seedStation } from "./helpers/fixtures";

const MIN = 60_000;
const hourFloor = (t: number) => Math.floor(t / HOUR_MS) * HOUR_MS;
const hourCeil = (t: number) => Math.ceil(t / HOUR_MS) * HOUR_MS;

/** An approved log from an hour before this one to five hours ahead, with one item every 20 minutes. */
async function seedAiringLog(stationId: string, now: number) {
  const startsAt = hourFloor(now) - HOUR_MS;
  const log = await seedLog(stationId, {
    status: "approved",
    startsAt: new Date(startsAt),
    endsAt: new Date(startsAt + 6 * HOUR_MS),
  });
  for (let k = 0; k < 18; k++) {
    const at = startsAt + k * 20 * MIN;
    await seedLogItem(log.id, {
      sortOrder: k,
      projectedAirAt: new Date(at),
      pushedAt: at < now ? new Date(at - 5 * MIN) : null,
    });
  }
  return log;
}

const itemsOf = (logId: string) => db.select().from(logItems).where(eq(logItems.logId, logId));
const logById = async (id: string) => (await db.select().from(logs).where(eq(logs.id, id)))[0];

describe("log removal", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("deletes a draft whole", async () => {
    const station = await seedStation();
    const log = await seedLog(station.id, { status: "draft" });
    await seedLogItem(log.id, { projectedAirAt: new Date() });

    const removal = await deleteLogHours(station.id, log.id);

    expect(removal.whole).toBe(true);
    expect(await logById(log.id)).toBeUndefined();
    expect(await itemsOf(log.id)).toHaveLength(0);
  });

  it("deletes a not-yet-airing approved log whole", async () => {
    const station = await seedStation();
    const start = hourCeil(Date.now()) + 2 * HOUR_MS;
    const log = await seedLog(station.id, { status: "approved", startsAt: new Date(start), endsAt: new Date(start + HOUR_MS) });

    const removal = await deleteLogHours(station.id, log.id);

    expect(removal.whole).toBe(true);
    expect(await logById(log.id)).toBeUndefined();
  });

  it("cuts an airing log at the first top of the hour past the safety horizon", async () => {
    const station = await seedStation();
    const now = Date.now();
    const log = await seedAiringLog(station.id, now);
    const cut = hourCeil(now + 15 * MIN);

    const removal = await deleteLogHours(station.id, log.id, new Date(now));

    expect(removal.whole).toBe(false);
    expect(removal.from.getTime()).toBe(cut);
    expect((await logById(log.id)).endsAt.getTime()).toBe(cut);
    const kept = await itemsOf(log.id);
    expect(kept.every((i) => i.projectedAirAt!.getTime() < cut)).toBe(true);
    expect(kept.length + removal.removedItems).toBe(18);
  });

  it("never cuts before an item already pushed to RadioDJ", async () => {
    const station = await seedStation();
    const now = Date.now();
    const log = await seedAiringLog(station.id, now);
    const firstCut = hourCeil(now + 15 * MIN);
    // The pacer ran ahead: an item past the first eligible hour is already in the queue.
    const [ahead] = await db
      .update(logItems)
      .set({ pushedAt: new Date(now) })
      .where(eq(logItems.projectedAirAt, new Date(firstCut + 20 * MIN)))
      .returning();
    expect(ahead).toBeDefined();

    const removal = await deleteLogHours(station.id, log.id, new Date(now));

    expect(removal.from.getTime()).toBe(firstCut + HOUR_MS);
  });

  it("refuses an aired log, or one with nothing left outside the safety horizon", async () => {
    const station = await seedStation();
    const now = Date.now();
    const aired = await seedLog(station.id, {
      status: "approved",
      startsAt: new Date(hourFloor(now) - 3 * HOUR_MS),
      endsAt: new Date(hourFloor(now) - HOUR_MS),
    });
    const endingSoon = await seedLog(station.id, {
      status: "approved",
      startsAt: new Date(hourFloor(now) - HOUR_MS),
      endsAt: new Date(now + 10 * MIN),
    });

    for (const log of [aired, endingSoon]) {
      await expect(deleteLogHours(station.id, log.id, new Date(now))).rejects.toMatchObject({ reason: "nothing_remaining" });
      expect(await logById(log.id)).toBeDefined();
    }
  });

  it("removes the assumed play_history rows of the hours it cuts", async () => {
    const station = await seedStation({ assumeLogAired: true });
    const song = await seedSong(station.id, 1001);
    const now = Date.now();
    const log = await seedAiringLog(station.id, now);
    const cut = hourCeil(now + 15 * MIN);
    for (const at of [cut - 30 * MIN, cut + 30 * MIN]) {
      await db.insert(playHistory).values({
        stationId: station.id,
        songId: song.id,
        rdjSongId: song.rdjSongId,
        airedAt: new Date(at),
        source: "assumed",
      });
    }

    await deleteLogHours(station.id, log.id, new Date(now));

    const rows = await db.select().from(playHistory).where(eq(playHistory.stationId, station.id));
    expect(rows.map((r) => r.airedAt.getTime())).toEqual([cut - 30 * MIN]);
  });

  it("is scoped to the caller's station", async () => {
    const station = await seedStation();
    const other = await seedStation();
    const log = await seedLog(other.id, { status: "draft" });

    await expect(deleteLogHours(station.id, log.id)).rejects.toBeInstanceOf(EditRejectedError);
    expect(await logById(log.id)).toBeDefined();
  });
});

describe("log regeneration", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("replaces a future draft with a new draft over the same hours", async () => {
    const station = await seedStation();
    const start = hourCeil(Date.now()) + HOUR_MS;
    const log = await seedLog(station.id, { status: "draft", startsAt: new Date(start), endsAt: new Date(start + 2 * HOUR_MS) });

    const { removal, generated } = await regenerateLogHours(station.id, log.id);

    expect(removal.whole).toBe(true);
    expect(await logById(log.id)).toBeUndefined();
    const fresh = await logById(generated.logId);
    expect(fresh.status).toBe("draft");
    expect(fresh.startsAt.getTime()).toBe(start);
    expect(fresh.endsAt.getTime()).toBe(start + 2 * HOUR_MS);
  });

  it("replaces an airing log's remaining hours with an approved log from the cut", async () => {
    const station = await seedStation();
    const now = Date.now();
    const log = await seedAiringLog(station.id, now);
    const cut = hourCeil(now + 15 * MIN);

    const { removal, generated } = await regenerateLogHours(station.id, log.id, new Date(now));

    expect(removal.from.getTime()).toBe(cut);
    expect((await logById(log.id)).endsAt.getTime()).toBe(cut);
    const fresh = await logById(generated.logId);
    expect(fresh.status).toBe("approved");
    expect(fresh.startsAt.getTime()).toBe(cut);
    expect(fresh.endsAt.getTime()).toBe(log.endsAt.getTime());
  });

  it("leaves the log as it was when it can't regenerate", async () => {
    const station = await seedStation();
    const now = Date.now();
    const log = await seedAiringLog(station.id, now);
    const cut = hourCeil(now + 15 * MIN);
    // Another log already sits in the span: the insert conflicts and the cut is rolled back.
    await seedLog(station.id, { status: "draft", startsAt: new Date(cut + HOUR_MS), endsAt: new Date(cut + 2 * HOUR_MS) });

    await expect(regenerateLogHours(station.id, log.id, new Date(now))).rejects.toThrow();

    expect((await logById(log.id)).endsAt.getTime()).toBe(log.endsAt.getTime());
    expect(await itemsOf(log.id)).toHaveLength(18);
  });
});

describe("removableFrom", () => {
  it("is the start of a draft regardless of time", () => {
    const start = new Date(Date.now() - 5 * HOUR_MS);
    const log = { status: "draft", startsAt: start, endsAt: new Date(start.getTime() + HOUR_MS) } as Parameters<typeof removableFrom>[0];
    expect(removableFrom(log, [])).toEqual(start);
  });
});

describe("generation history across a seam", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("counts approved, not-yet-aired items before the horizon as history", async () => {
    const { loadGenerationInputs } = await import("../src/lib/generation");
    const station = await seedStation();
    const scheduled = await seedSong(station.id, 2001);
    const draftOnly = await seedSong(station.id, 2002);
    const now = Date.now();
    const horizonStart = hourCeil(now) + HOUR_MS;
    const approved = await seedLog(station.id, { status: "approved", startsAt: new Date(hourFloor(now)), endsAt: new Date(horizonStart) });
    await seedLogItem(approved.id, { songId: scheduled.id, rdjSongId: scheduled.rdjSongId, projectedAirAt: new Date(horizonStart - 10 * MIN) });
    const draft = await seedLog(station.id, { status: "draft", startsAt: new Date(horizonStart - 3 * HOUR_MS), endsAt: new Date(horizonStart - 2 * HOUR_MS) });
    await seedLogItem(draft.id, { songId: draftOnly.id, rdjSongId: draftOnly.rdjSongId, projectedAirAt: new Date(now + 5 * MIN) });

    const { input } = await loadGenerationInputs(station.id, new Date(horizonStart), new Date(horizonStart + HOUR_MS));

    expect(input.history.map((h) => h.rdjSongId)).toEqual([scheduled.rdjSongId]);
  });
});
