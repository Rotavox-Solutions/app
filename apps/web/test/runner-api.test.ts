import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  changesets,
  createRunnerKey,
  decodeWire,
  encodeWire,
  enqueueJob,
  logItems,
  playHistory,
  resolveRunnerKey,
  revokeRunnerKey,
  runRunnerOp,
  runnerJobs,
  songs,
  type RunnerOpName,
} from "@rotavox/schema";
import { db } from "../src/lib/db";
import { POST } from "../src/app/api/runner/v1/[op]/route";
import { resetDb } from "./helpers/db";
import { seedLog, seedLogItem, seedSong, seedStation } from "./helpers/fixtures";

/** Calls an operation the way the Runner's direct mode does: through the wire format. */
async function op<T = any>(stationId: string, name: RunnerOpName, args: unknown = {}): Promise<T> {
  return decodeWire<T>(await runRunnerOp(db, stationId, name, encodeWire(args)));
}

/** Calls the real route handler, as the Runner's API mode does over HTTP. */
async function http(key: string | null, name: string, args: unknown = {}) {
  const res = await POST(
    new Request(`http://localhost/api/runner/v1/${name}`, {
      method: "POST",
      headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "x-rotavox-runner": "9.9.9" },
      body: encodeWire(args),
    }),
    { params: Promise.resolve({ op: name }) },
  );
  return { status: res.status, body: decodeWire<any>(await res.text()) };
}

async function airingLog(stationId: string) {
  const now = Date.now();
  return seedLog(stationId, {
    status: "approved",
    startsAt: new Date(now - 60_000),
    endsAt: new Date(now + 3_600_000),
  });
}

describe("wire format", () => {
  it("brings dates back as dates and leaves other strings alone", () => {
    const at = new Date("2026-10-25T19:00:00.123Z");
    const back = decodeWire<{ at: Date; title: string; n: number; none: null }>(
      encodeWire({ at, title: "2026 Hits", n: 3, none: null }),
    );
    expect(back.at).toBeInstanceOf(Date);
    expect(back.at.getTime()).toBe(at.getTime());
    expect(back).toMatchObject({ title: "2026 Hits", n: 3, none: null });
  });
});

describe("runner keys", () => {
  beforeEach(resetDb);

  it("resolves a key to its station until it is revoked, and records the Runner's version", async () => {
    const station = await seedStation();
    const { key, row } = await createRunnerKey(db, { stationId: station.id, label: "Box", createdBy: null });
    expect(key.startsWith("rvx_runner_")).toBe(true);
    expect(row.tokenHash).not.toContain(key);
    expect(await resolveRunnerKey(db, key, { version: "0.4.0" })).toEqual({ keyId: row.id, stationId: station.id });
    expect(await resolveRunnerKey(db, key + "x")).toBeNull();

    const ok = await http(key, "whoami");
    expect(ok).toMatchObject({ status: 200, body: { station: { id: station.id }, apiVersion: 1 } });

    expect(await revokeRunnerKey(db, station.id, row.id)).toBe(true);
    expect((await http(key, "whoami")).status).toBe(401);
    expect((await http(null, "whoami")).status).toBe(401);
  });

  it("refuses an unknown operation", async () => {
    const station = await seedStation();
    const { key } = await createRunnerKey(db, { stationId: station.id, label: "Box", createdBy: null });
    expect((await http(key, "dropAllTables")).status).toBe(404);
  });
});

describe("runner operations", () => {
  beforeEach(resetDb);

  it("paces through the API exactly as through the database", async () => {
    const station = await seedStation();
    const song = await seedSong(station.id, 101, { durationMs: 200_000, effectiveDurationMs: 180_000 });
    const log = await airingLog(station.id);
    const fixed = await seedLogItem(log.id, { sortOrder: 0, elementType: "fixed_event" });
    const first = await seedLogItem(log.id, { sortOrder: 1, songId: song.id, rdjSongId: 101 });
    const second = await seedLogItem(log.id, { sortOrder: 2, songId: song.id, rdjSongId: 101 });

    const { key } = await createRunnerKey(db, { stationId: station.id, label: "Box", createdBy: null });
    const current = await http(key, "currentLog", { at: new Date() });
    expect(current.body.id).toBe(log.id);
    expect(current.body.startsAt).toBeInstanceOf(Date);

    // fixed_event items are RadioDJ's, never pushed.
    expect((await op(station.id, "nextUnpushedItem", { logId: log.id })).id).toBe(first.id);
    expect(await op(station.id, "hasPushed", { logId: log.id })).toBe(false);

    const pushedAt = new Date();
    await op(station.id, "markPushed", { itemIds: [first.id], at: pushedAt });
    expect((await op(station.id, "nextUnpushedItem", { logId: log.id })).id).toBe(second.id);
    expect(await op(station.id, "queueDrainInputs", { logId: log.id })).toEqual({
      pendingMs: 180_000,
      playingEndsAtMs: null,
    });

    const airedAt = new Date();
    expect(await op(station.id, "stampAired", { logId: log.id, rdjSongId: 101, airedAt })).toBe(true);
    const [row] = await db.select().from(logItems).where(eq(logItems.id, first.id));
    expect(row.airedAt?.getTime()).toBe(airedAt.getTime());
    expect((await op(station.id, "queueDrainInputs", { logId: log.id })).playingEndsAtMs).toBe(
      airedAt.getTime() + 180_000,
    );
    expect(fixed.pushedAt).toBeNull();
  });

  it("can't see or touch another station's logs", async () => {
    const mine = await seedStation({ name: "Mine" });
    const theirs = await seedStation({ name: "Theirs" });
    const log = await airingLog(theirs.id);
    const item = await seedLogItem(log.id, { sortOrder: 1, rdjSongId: 5 });

    expect(await op(mine.id, "currentLog", { at: new Date() })).toBeNull();
    await expect(op(mine.id, "nextUnpushedItem", { logId: log.id })).rejects.toThrow(/no log/);
    await expect(op(mine.id, "resetAfterQueueClear", { logId: log.id, now: new Date() })).rejects.toThrow(/no log/);
    expect(await op(mine.id, "markPushed", { itemIds: [item.id], at: new Date() })).toEqual({ updated: 0 });
    const [row] = await db.select().from(logItems).where(eq(logItems.id, item.id));
    expect(row.pushedAt).toBeNull();

    const { key } = await createRunnerKey(db, { stationId: mine.id, label: "Box", createdBy: null });
    expect((await http(key, "nextUnpushedItem", { logId: log.id })).status).toBe(404);
  });

  it("syncs songs with the watermark, and records history once", async () => {
    const station = await seedStation();
    expect(await op(station.id, "libraryWatermark")).toEqual({ watermark: null });
    const watermark = new Date("2026-10-25T18:00:00Z");
    const song = {
      rdjSongId: 7,
      artist: "A",
      title: "T",
      album: null,
      durationMs: 1000,
      effectiveDurationMs: null,
      path: "x.mp3",
      rdjSubcategoryId: 5,
      rdjCategoryId: 1,
      rdjGenreId: null,
      enabled: true,
      songType: 0,
    };
    await op(station.id, "upsertSongs", { songs: [song], watermark });
    await op(station.id, "upsertSongs", { songs: [{ ...song, title: "T2" }] });
    expect((await op(station.id, "libraryWatermark")).watermark.getTime()).toBe(watermark.getTime());
    expect(await op(station.id, "libraryMirror")).toEqual([
      { id: 7, subcat: 5, enabled: true, artist: "A", title: "T2" },
    ]);

    const rows = [{ rdjHistoryId: 900, rdjSongId: 7, artist: "A", airedAt: new Date() }];
    await op(station.id, "recordHistory", { rows, watermark: 900 });
    await op(station.id, "recordHistory", { rows, watermark: 900 });
    const history = await db.select().from(playHistory).where(eq(playHistory.stationId, station.id));
    expect(history).toHaveLength(1);
    expect(history[0].songId).not.toBeNull();
    expect(await op(station.id, "historyWatermark")).toEqual({ watermark: 900 });

    const { orphans } = await op(station.id, "disableOrphans", { liveIds: [8], apply: true });
    expect(orphans.map((o: { rdjSongId: number }) => o.rdjSongId)).toEqual([7]);
    const [after] = await db.select().from(songs).where(eq(songs.stationId, station.id));
    expect(after.enabled).toBe(false);
    await expect(op(station.id, "disableOrphans", { liveIds: [], apply: true })).rejects.toThrow(/empty/);
  });

  it("hands out the scheduled sync, then a person's request, and only this station's jobs", async () => {
    const station = await seedStation();
    const other = await seedStation({ name: "Other" });
    await enqueueJob(db, other.id, "sync_library", "ui");

    const job = await op(station.id, "nextJob", { now: new Date() });
    expect(job).toMatchObject({
      kind: "sync_library",
      requestedBy: "schedule",
      status: "running",
      stationId: station.id,
    });
    // Asking again within the interval schedules nothing new.
    expect(await op(station.id, "nextJob", { now: new Date() })).toBeNull();

    await op(station.id, "finishJob", { jobId: job.id, ok: true, summary: "Already up to date", output: "" });
    const [done] = await db.select().from(runnerJobs).where(eq(runnerJobs.id, job.id));
    expect(done.status).toBe("succeeded");

    const [foreign] = await db.select().from(runnerJobs).where(eq(runnerJobs.stationId, other.id));
    await expect(op(station.id, "finishJob", { jobId: foreign.id, ok: true, summary: "", output: "" })).rejects.toThrow(
      /no job/,
    );
  });

  it("records a RadioDJ write and updates the mirror in the same step", async () => {
    const station = await seedStation();
    await seedSong(station.id, 11, { rdjSubcategoryId: 5 });
    const [cs] = await db
      .insert(changesets)
      .values({ stationId: station.id, status: "applied", intent: "x", appliedAt: new Date(), projection: "pending" })
      .returning();
    await op(station.id, "finishProjection", {
      changesetId: cs.id,
      ok: true,
      moves: [{ rdjSongId: 11, toSubcat: 26 }],
    });
    const [after] = await db.select().from(changesets).where(eq(changesets.id, cs.id));
    expect(after.projection).toBe("projected");
    const [song] = await db.select().from(songs).where(eq(songs.rdjSongId, 11));
    expect(song.rdjSubcategoryId).toBe(26);

    const other = await seedStation({ name: "Other" });
    await expect(op(other.id, "finishProjection", { changesetId: cs.id, ok: false, error: "x" })).rejects.toThrow(
      /no changeset/,
    );
  });
});
