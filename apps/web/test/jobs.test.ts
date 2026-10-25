import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  applyDraft,
  claimNextJob,
  enqueueJob,
  failInterruptedJobs,
  finishJob,
  lastSucceeded,
  latestJobs,
  markProjection,
  nextProjectionStatus,
  pruneJobs,
  retryProjection,
  runnerJobs,
  songCategories,
  stageChanges,
} from "@rotavox/schema";
import { db } from "../src/lib/db";
import { getInbox } from "../src/lib/music-edits";
import { getRunnerStatus } from "../src/lib/runner-status";
import { resetDb } from "./helpers/db";
import { seedCategory, seedSong, seedStation } from "./helpers/fixtures";

describe("runner jobs", () => {
  beforeEach(resetDb);

  it("treats asking twice as one request until the job finishes", async () => {
    const station = await seedStation();
    const a = await enqueueJob(db, station.id, "sync_library", "ui");
    const b = await enqueueJob(db, station.id, "sync_library", "schedule");
    expect(b.id).toBe(a.id);

    const claimed = await claimNextJob(db, station.id);
    expect(claimed).toMatchObject({ id: a.id, status: "running" });
    // Still open while running.
    expect((await enqueueJob(db, station.id, "sync_library", "ui")).id).toBe(a.id);

    await finishJob(db, a.id, { ok: true, summary: "Already up to date", output: "" });
    const c = await enqueueJob(db, station.id, "sync_library", "ui");
    expect(c.id).not.toBe(a.id);
    expect(await lastSucceeded(db, station.id, "sync_library")).toBeInstanceOf(Date);
  });

  it("claims oldest first, one at a time, and nothing once the queue is empty", async () => {
    const station = await seedStation();
    const sync = await enqueueJob(db, station.id, "sync_library", "ui");
    const project = await enqueueJob(db, station.id, "project_changesets", "ui");
    const [first, second, none] = [
      await claimNextJob(db, station.id),
      await claimNextJob(db, station.id),
      await claimNextJob(db, station.id),
    ];
    expect([first?.id, second?.id, none]).toEqual([sync.id, project.id, null]);
  });

  it("fails jobs a restart interrupted, and reports the Runner silent when work sits unclaimed", async () => {
    const station = await seedStation();
    const job = await enqueueJob(db, station.id, "project_changesets", "changeset");
    await claimNextJob(db, station.id);
    expect(await failInterruptedJobs(db, station.id)).toBe(1);
    const [row] = await db.select().from(runnerJobs).where(eq(runnerJobs.id, job.id));
    expect(row.status).toBe("failed");

    await enqueueJob(db, station.id, "sync_library", "ui");
    expect((await getRunnerStatus(station.id)).runnerSilent).toBe(false);
    const later = new Date(Date.now() + 5 * 60_000);
    const status = await getRunnerStatus(station.id, later);
    expect(status).toMatchObject({ runnerSilent: true, busy: true });
    expect((await latestJobs(db, station.id)).project_changesets?.status).toBe("failed");
  });

  it("prunes only routine successes", async () => {
    const station = await seedStation();
    const old = new Date(Date.now() - 10 * 86_400_000);
    await db.insert(runnerJobs).values([
      { stationId: station.id, kind: "sync_library", requestedBy: "schedule", status: "succeeded", requestedAt: old },
      { stationId: station.id, kind: "sync_library", requestedBy: "schedule", status: "failed", requestedAt: old },
      { stationId: station.id, kind: "sync_library", requestedBy: "ui", status: "succeeded", requestedAt: old },
    ]);
    await pruneJobs(db, station.id, 7);
    const left = await db.select().from(runnerJobs);
    expect(left.map((j) => `${j.requestedBy}:${j.status}`).sort()).toEqual(["schedule:failed", "ui:succeeded"]);
  });
});

describe("projection queue and inbox suggestions", () => {
  beforeEach(resetDb);

  it("a failed write blocks the line until it is retried", async () => {
    const station = await seedStation({ membershipImportedAt: new Date() });
    const a1 = await seedCategory(station.id, { name: "A1", rdjSubcategoryIds: [5] });
    const song = await seedSong(station.id, 1, { rdjSubcategoryId: 39 });
    await stageChanges(db, station.id, [{ songId: song.id, to: { state: "active", categoryId: a1.id } }]);
    const { changesetId } = await applyDraft(db, station.id, { intent: "Place" });
    expect(await nextProjectionStatus(db, station.id)).toBe("pending");

    await markProjection(db, changesetId, { ok: false, error: "drift" });
    expect(await nextProjectionStatus(db, station.id)).toBe("failed");
    await retryProjection(db, station.id, changesetId);
    expect(await nextProjectionStatus(db, station.id)).toBe("pending");
    await markProjection(db, changesetId, { ok: true });
    expect(await nextProjectionStatus(db, station.id)).toBeNull();
  });

  it("suggests the pool or state a new song's RadioDJ subcategory already means", async () => {
    const station = await seedStation({
      membershipImportedAt: new Date(),
      rdjLifecycleSubcats: { 35: { state: "benched", default: true } },
    });
    const a1 = await seedCategory(station.id, { name: "A1", rdjSubcategoryIds: [5] });
    const filed = await seedSong(station.id, 1, { artist: "A", rdjSubcategoryId: 5 });
    const benched = await seedSong(station.id, 2, { artist: "B", rdjSubcategoryId: 35 });
    const unknown = await seedSong(station.id, 3, { artist: "C", rdjSubcategoryId: 39 });
    const placed = await seedSong(station.id, 4, { artist: "D", rdjSubcategoryId: 5 });
    await db.insert(songCategories).values({ songId: placed.id, categoryId: a1.id });

    const inbox = await getInbox(station.id);
    expect(inbox.songs.map((s) => [s.id, s.suggested])).toEqual([
      [filed.id, { state: "active", categoryId: a1.id }],
      [benched.id, { state: "benched", categoryId: null }],
      [unknown.id, null],
    ]);

    await stageChanges(db, station.id, [{ songId: benched.id, to: { state: "benched", categoryId: null } }]);
    const after = await getInbox(station.id);
    expect(after.songs.find((s) => s.id === benched.id)).toMatchObject({ isStaged: true, stagedCategoryId: null });
  });
});
