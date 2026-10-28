// The Runner job queue — how a button in the UI gets work done on the broadcast box
// without the web app ever touching RadioDJ (invariant #4). The web app enqueues; the
// Runner claims, runs and records. Postgres is the only channel between them.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { runnerJobs } from "./schema.js";

type Db = PostgresJsDatabase<typeof schema>;

export type JobKind = "sync_library" | "project_changesets" | "project_autodj_events" | "update_runner";
/** What a station's people may ask for. update_runner isn't one: only Rotavox staff update a Runner. */
export const JOB_KINDS: readonly JobKind[] = ["sync_library", "project_changesets", "project_autodj_events"];
export type JobRequester = "ui" | "schedule" | "changeset";
export type RunnerJob = typeof runnerJobs.$inferSelect;

/**
 * Queues a job, or returns the one already waiting or running for that kind — asking
 * twice is the same request, so a double-click or a scheduled run that lands mid-job
 * doesn't stack duplicates.
 */
export async function enqueueJob(
  db: Db,
  stationId: string,
  kind: JobKind,
  requestedBy: JobRequester,
  requestedByUser: string | null = null
): Promise<RunnerJob> {
  const [created] = await db
    .insert(runnerJobs)
    .values({ stationId, kind, requestedBy, requestedByUser })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [open] = await db
    .select()
    .from(runnerJobs)
    .where(and(eq(runnerJobs.stationId, stationId), eq(runnerJobs.kind, kind), inArray(runnerJobs.status, ["queued", "running"])));
  return open;
}

/** Claims the oldest queued job. SKIP LOCKED, so a second Runner could never take the same one. */
export async function claimNextJob(db: Db, stationId: string, at: Date = new Date()): Promise<RunnerJob | null> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE runner_jobs SET status = 'running', started_at = ${at.toISOString()}
    WHERE id = (
      SELECT id FROM runner_jobs
      WHERE station_id = ${stationId} AND status = 'queued'
      ORDER BY requested_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  const id = rows[0]?.id;
  if (!id) return null;
  const [job] = await db.select().from(runnerJobs).where(eq(runnerJobs.id, id));
  return job ?? null;
}

export async function finishJob(
  db: Db,
  jobId: string,
  result: { ok: boolean; summary: string; output: string },
  at: Date = new Date()
): Promise<void> {
  await db
    .update(runnerJobs)
    .set({ status: result.ok ? "succeeded" : "failed", summary: result.summary, output: result.output, finishedAt: at })
    .where(eq(runnerJobs.id, jobId));
}

/**
 * Jobs left 'running' by a Runner that stopped mid-job. Called at Runner startup, when by
 * definition nothing is running. Each one either finished its RadioDJ transaction or
 * rolled it back; the job that replaces it re-checks against live state either way.
 */
export async function failInterruptedJobs(db: Db, stationId: string, at: Date = new Date()): Promise<number> {
  const rows = await db
    .update(runnerJobs)
    .set({ status: "failed", summary: "Interrupted: the Runner restarted while this was running.", finishedAt: at })
    .where(and(eq(runnerJobs.stationId, stationId), eq(runnerJobs.status, "running")))
    .returning({ id: runnerJobs.id });
  return rows.length;
}

export async function listRecentJobs(db: Db, stationId: string, limit = 20): Promise<RunnerJob[]> {
  return db
    .select()
    .from(runnerJobs)
    .where(eq(runnerJobs.stationId, stationId))
    .orderBy(desc(runnerJobs.requestedAt))
    .limit(limit);
}

/** The most recent job of each kind, for status lines ("Library synced 4 min ago"). */
export async function latestJobs(db: Db, stationId: string): Promise<Partial<Record<JobKind, RunnerJob>>> {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT DISTINCT ON (kind) id FROM runner_jobs
    WHERE station_id = ${stationId}
    ORDER BY kind, requested_at DESC
  `);
  if (rows.length === 0) return {};
  const jobs = await db
    .select()
    .from(runnerJobs)
    .where(inArray(runnerJobs.id, rows.map((r) => r.id)));
  return Object.fromEntries(jobs.map((j) => [j.kind, j]));
}

/** The last time a job of this kind succeeded. */
export async function lastSucceeded(db: Db, stationId: string, kind: JobKind): Promise<Date | null> {
  const [row] = await db
    .select({ at: runnerJobs.finishedAt })
    .from(runnerJobs)
    .where(and(eq(runnerJobs.stationId, stationId), eq(runnerJobs.kind, kind), eq(runnerJobs.status, "succeeded")))
    .orderBy(desc(runnerJobs.finishedAt))
    .limit(1);
  return row?.at ?? null;
}

/** When a job of this kind was last asked for, by anyone. */
export async function lastRequested(db: Db, stationId: string, kind: JobKind): Promise<Date | null> {
  const [row] = await db
    .select({ at: runnerJobs.requestedAt })
    .from(runnerJobs)
    .where(and(eq(runnerJobs.stationId, stationId), eq(runnerJobs.kind, kind)))
    .orderBy(desc(runnerJobs.requestedAt))
    .limit(1);
  return row?.at ?? null;
}

/**
 * Drops routine history: scheduled runs that succeeded, older than `days`. Anything a
 * person asked for, and every failure, is kept.
 */
export async function pruneJobs(db: Db, stationId: string, days: number, now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  await db.execute(sql`
    DELETE FROM runner_jobs
    WHERE station_id = ${stationId} AND requested_by = 'schedule' AND status = 'succeeded'
      AND requested_at < ${cutoff}
  `);
}
