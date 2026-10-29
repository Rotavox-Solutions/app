// The Runner API (ADR-0004): everything the Runner on a broadcast box reads from or writes
// to Rotavox, as named operations on one station. The web app serves them at
// POST /api/runner/v1/<op>; a Runner still in direct mode calls the same functions on its
// own Postgres connection. Either way, the station is the one the Runner's key names.
// Nothing here trusts an id it is handed: every log, item, job and changeset is checked
// against that station first.
//
// Queries moved here from the Runner unchanged in meaning; the comments that explain
// them moved with them (sync-library.ts, reconcile-history.ts, prune-library.ts,
// jobs.ts). Pacing decisions are not here: the Runner makes them from its own copy of
// the logs (logWindow), so an outage can't stop playout.
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, lt, notInArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { changesets, clockPositions, logItems, logs, playHistory, songs, stations, syncState } from "./schema.js";
import { listPendingProjections, nextProjectionStatus } from "./changesets.js";
import { claimNextJob, enqueueJob, failInterruptedJobs, finishJob, lastRequested, pruneJobs } from "./jobs.js";
import { loadProjection, mirrorChangesetMoves, type MirrorMove } from "./membership.js";
import { AUTODJ_EVENTS_SYNC_KEY, utcOffsetMinutes } from "./autodj-events.js";
import { serverRevision } from "./revisions.js";

type Db = PostgresJsDatabase<typeof schema>;

export const RUNNER_API_VERSION = 1;

export class RunnerOpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RunnerOpError";
  }
}

export type LogRow = typeof logs.$inferSelect;
export type LogItemRow = typeof logItems.$inferSelect;

/** A log item as the Runner paces it: with its timing duration and TOH lock resolved. */
export interface PacingItem extends LogItemRow {
  timingMs: number;
  tohLocked: boolean;
}

export interface WindowLog {
  log: LogRow;
  digest: string;
  /** Null when the Runner's copy is already current. */
  items: PacingItem[] | null;
}

// ── Wire format ─────────────────────────────────────────────────────────────────────
// JSON has no dates. Every Date is sent as an ISO-8601 UTC string and comes back a Date
// on the other side. Both modes go through this, so direct mode can't hide a value that
// wouldn't survive the API.

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export const encodeWire = (value: unknown): string => JSON.stringify(value ?? null);
export const decodeWire = <T>(text: string): T =>
  JSON.parse(text, (_key, v) => (typeof v === "string" && ISO_UTC.test(v) ? new Date(v) : v)) as T;

// ── Station checks ──────────────────────────────────────────────────────────────────

const stationLogIds = (stationId: string) => sql`(SELECT id FROM logs WHERE station_id = ${stationId})`;

/**
 * Segue-aware duration for timing arithmetic.
 *
 * The next track starts at RadioDJ's `xta` cue, not at end-of-file, so
 * effective_duration_ms is what the queue actually consumes; duration_ms is the
 * fallback where the sync could not read cue points (schema.ts notes that using file
 * duration throughout costs roughly 24s of drift per hour).
 */
const TIMING_DURATION_MS = sql<number>`coalesce(${songs.effectiveDurationMs}, ${songs.durationMs}, 0)`;

/** Fields sync-library owns on a song. Extended metadata is Rotavox's and never sent. */
export interface SyncedSong {
  rdjSongId: number;
  artist: string | null;
  title: string | null;
  album: string | null;
  durationMs: number | null;
  effectiveDurationMs: number | null;
  path: string | null;
  rdjSubcategoryId: number | null;
  rdjCategoryId: number | null;
  rdjGenreId: number | null;
  enabled: boolean;
  songType: number | null;
}

export interface HistoryRow {
  rdjHistoryId: number;
  rdjSongId: number;
  artist: string | null;
  airedAt: Date;
}

/** A pending projection as it crosses the wire: the mirror map as a plain object. */
export type WirePendingProjection = Omit<Awaited<ReturnType<typeof listPendingProjections>>[number], "mirrorSubcat"> & {
  mirrorSubcat: Record<string, number | null>;
};

/** How often the library is synced unprompted, so songs added in RadioDJ reach the Inbox. */
export const SCHEDULED_SYNC_MINUTES = 15;

/**
 * True when the AutoDJ fail-safe's events were written at a UTC offset the station no
 * longer has. Only a station whose Runner has written them once (a person ran the job
 * from the Station page) is kept in step: no record means the station hasn't opted in,
 * and "none" means its box has no fail-safe plan. A failed run waits for a person, like
 * any failed RadioDJ write.
 */
async function autodjEventsStale(db: Db, stationId: string, now: Date): Promise<boolean> {
  const [row] = await db
    .select({ watermark: syncState.watermark, timezone: stations.timezone })
    .from(syncState)
    .innerJoin(stations, eq(stations.id, syncState.stationId))
    .where(and(eq(syncState.stationId, stationId), eq(syncState.syncKey, AUTODJ_EVENTS_SYNC_KEY)));
  if (!row?.watermark || !/^-?\d+$/.test(row.watermark)) return false;
  if (Number(row.watermark) === utcOffsetMinutes(now, row.timezone)) return false;
  const [last] = await db
    .select({ status: schema.runnerJobs.status })
    .from(schema.runnerJobs)
    .where(and(eq(schema.runnerJobs.stationId, stationId), eq(schema.runnerJobs.kind, "project_autodj_events")))
    .orderBy(desc(schema.runnerJobs.requestedAt))
    .limit(1);
  return last?.status !== "failed";
}
const KEEP_SCHEDULED_DAYS = 7;
const LIBRARY_SYNC_KEY = "library_sync";
const LIBRARY_SYNC_RUN_KEY = "library_sync_run";
const HISTORY_SYNC_KEY = "history_reconcile";

// ── The operations ──────────────────────────────────────────────────────────────────

export const runnerOps = {
  /** Who this key belongs to. The Runner calls it at startup. */
  async whoami(db: Db, stationId: string) {
    const [station] = await db
      .select({ id: stations.id, name: stations.name, timezone: stations.timezone })
      .from(stations)
      .where(eq(stations.id, stationId));
    if (!station) throw new RunnerOpError(404, "this key's station no longer exists");
    // revision: the commit the cloud runs, which a Runner updates itself to (update_runner).
    return { station, apiVersion: RUNNER_API_VERSION, revision: serverRevision() };
  },

  // ── The Runner's copy of the logs (ADR-0004 §6) ──

  /**
   * The station's approved logs overlapping [from, to), for the copy the Runner paces
   * from. Each item carries what pacing decides with, so the Runner never has to ask
   * mid-hour: its timing duration and whether its clock position is TOH-locked.
   *
   * `have` maps the logs the Runner already holds to their digest. A log whose digest
   * still matches comes back without its items, so the routine refresh costs a row per
   * log. The digest covers what Rotavox owns (the log, and each item's content), never
   * pushed_at or aired_at, which are the Runner's.
   */
  async logWindow(
    db: Db,
    stationId: string,
    a: { from: Date; to: Date; have?: Record<string, string> },
  ): Promise<{ logs: WindowLog[] }> {
    const rows = await db
      .select()
      .from(logs)
      .where(
        and(
          eq(logs.stationId, stationId),
          eq(logs.status, "approved"),
          lt(logs.startsAt, a.to),
          gt(logs.endsAt, a.from),
        ),
      )
      .orderBy(logs.startsAt);
    if (rows.length === 0) return { logs: [] };
    const itemRows = await db
      .select({ item: logItems, timingMs: TIMING_DURATION_MS, offset: clockPositions.targetOffsetSeconds })
      .from(logItems)
      .leftJoin(songs, eq(logItems.songId, songs.id))
      .leftJoin(clockPositions, eq(logItems.clockPositionId, clockPositions.id))
      .where(
        inArray(
          logItems.logId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(logItems.sortOrder));
    const byLog = new Map<string, PacingItem[]>();
    for (const r of itemRows) {
      const list = byLog.get(r.item.logId) ?? [];
      list.push({ ...r.item, timingMs: Number(r.timingMs ?? 0), tohLocked: r.offset === 0 });
      byLog.set(r.item.logId, list);
    }
    return {
      logs: rows.map((log) => {
        const items = byLog.get(log.id) ?? [];
        const digest = logDigest(log, items);
        return { log, digest, items: a.have?.[log.id] === digest ? null : items };
      }),
    };
  },

  /**
   * The Runner's record of when items were pushed and aired, as absolute values: the
   * Runner is the only writer of both, so the latest report wins. Reports queued while
   * Rotavox was unreachable arrive this way too. An item from another station is ignored.
   */
  async recordItemTimes(
    db: Db,
    stationId: string,
    a: { items: { id: string; pushedAt: Date | null; airedAt: Date | null }[] },
  ): Promise<{ updated: number }> {
    if (a.items.length === 0) return { updated: 0 };
    return db.transaction(async (tx) => {
      let updated = 0;
      for (const item of a.items) {
        const rows = await tx
          .update(logItems)
          .set({ pushedAt: item.pushedAt, airedAt: item.airedAt })
          .where(and(eq(logItems.id, item.id), sql`${logItems.logId} IN ${stationLogIds(stationId)}`))
          .returning({ id: logItems.id });
        updated += rows.length;
      }
      return { updated };
    });
  },

  // ── Library ──

  /** The incremental sync's watermark: the max date_modified seen, never the local clock. */
  async libraryWatermark(db: Db, stationId: string): Promise<{ watermark: Date | null }> {
    const [row] = await db
      .select()
      .from(syncState)
      .where(and(eq(syncState.stationId, stationId), eq(syncState.syncKey, LIBRARY_SYNC_KEY)));
    return { watermark: row?.watermark ? new Date(row.watermark) : null };
  },

  /** What the mirror holds for the drift check: pool, enabled, tags and type for every song. */
  async libraryMirror(db: Db, stationId: string) {
    return db
      .select({
        id: songs.rdjSongId,
        subcat: songs.rdjSubcategoryId,
        enabled: songs.enabled,
        artist: songs.artist,
        title: songs.title,
        songType: songs.songType,
      })
      .from(songs)
      .where(eq(songs.stationId, stationId));
  },

  /** Upserts synced songs, and moves the watermark if one is given — in one transaction. */
  async upsertSongs(db: Db, stationId: string, a: { songs: SyncedSong[]; watermark?: Date | null }) {
    await db.transaction(async (tx) => {
      for (const { rdjSongId, ...coreFields } of a.songs) {
        // Core fields only — extended metadata is Rotavox-owned and absent from both
        // values and the update set, so a re-sync can never clobber it.
        await tx
          .insert(songs)
          .values({ stationId, rdjSongId, ...coreFields })
          .onConflictDoUpdate({ target: [songs.stationId, songs.rdjSongId], set: coreFields });
      }
      if (a.watermark) {
        const watermark = a.watermark.toISOString();
        await tx
          .insert(syncState)
          .values({ stationId, syncKey: LIBRARY_SYNC_KEY, watermark })
          .onConflictDoUpdate({
            target: [syncState.stationId, syncState.syncKey],
            set: { watermark, updatedAt: new Date() },
          });
      }
    });
    return { upserted: a.songs.length };
  },

  /**
   * Records that a sync completed. Not the watermark row's updated_at: that only moves
   * when a row's date_modified does, and pool moves and set_tags never touch it.
   */
  async markLibrarySynced(db: Db, stationId: string): Promise<void> {
    await db
      .insert(syncState)
      .values({ stationId, syncKey: LIBRARY_SYNC_RUN_KEY, watermark: null })
      .onConflictDoUpdate({ target: [syncState.stationId, syncState.syncKey], set: { updatedAt: new Date() } });
  },

  /**
   * Deletion reconciliation: disables mirror songs RadioDJ no longer has. Disabled,
   * never deleted, since log_items and play_history reference them. Refuses an empty
   * live set, which is a broken read far more often than an empty library.
   */
  async disableOrphans(db: Db, stationId: string, a: { liveIds: number[]; apply: boolean }) {
    if (a.liveIds.length === 0) throw new RunnerOpError(400, "refusing to prune against an empty RadioDJ library");
    const orphans = await db
      .select({ id: songs.id, rdjSongId: songs.rdjSongId, artist: songs.artist, title: songs.title })
      .from(songs)
      .where(and(eq(songs.stationId, stationId), eq(songs.enabled, true), notInArray(songs.rdjSongId, a.liveIds)));
    if (a.apply && orphans.length) {
      await db
        .update(songs)
        .set({ enabled: false })
        .where(
          and(
            eq(songs.stationId, stationId),
            inArray(
              songs.id,
              orphans.map((o) => o.id),
            ),
          ),
        );
    }
    return { orphans: orphans.map(({ id: _id, ...o }) => o) };
  },

  // ── As-played history ──

  async historyWatermark(db: Db, stationId: string): Promise<{ watermark: number }> {
    const [row] = await db
      .select()
      .from(syncState)
      .where(and(eq(syncState.stationId, stationId), eq(syncState.syncKey, HISTORY_SYNC_KEY)));
    return { watermark: row?.watermark ? Number(row.watermark) : 0 };
  },

  /**
   * Writes a batch of RadioDJ history to play_history and moves the watermark, in one
   * transaction, so a crash between the two can't double-insert. Rows already recorded
   * (same rdj_history_id) are skipped.
   */
  async recordHistory(db: Db, stationId: string, a: { rows: HistoryRow[]; watermark: number }) {
    if (a.rows.length === 0) return { recorded: 0 };
    const rdjSongIds = [...new Set(a.rows.map((r) => r.rdjSongId))];
    const mirrorRows = await db
      .select({ id: songs.id, rdjSongId: songs.rdjSongId })
      .from(songs)
      .where(and(eq(songs.stationId, stationId), inArray(songs.rdjSongId, rdjSongIds)));
    const songIdByRdjId = new Map(mirrorRows.map((r) => [r.rdjSongId, r.id]));
    await db.transaction(async (tx) => {
      await tx
        .insert(playHistory)
        .values(
          a.rows.map((row) => ({
            stationId,
            songId: songIdByRdjId.get(row.rdjSongId) ?? null,
            rdjSongId: row.rdjSongId,
            artist: row.artist ?? null,
            airedAt: row.airedAt,
            source: "reconciled" as const,
            rdjHistoryId: row.rdjHistoryId,
          })),
        )
        .onConflictDoNothing({ target: [playHistory.stationId, playHistory.rdjHistoryId] });
      await tx
        .insert(syncState)
        .values({ stationId, syncKey: HISTORY_SYNC_KEY, watermark: String(a.watermark) })
        .onConflictDoUpdate({
          target: [syncState.stationId, syncState.syncKey],
          set: { watermark: String(a.watermark), updatedAt: new Date() },
        });
    });
    return { recorded: a.rows.length };
  },

  // ── Jobs ──

  /** Called once at Runner startup, when by definition nothing of this station's is running. */
  async failInterruptedJobs(db: Db, stationId: string): Promise<{ failed: number }> {
    return { failed: await failInterruptedJobs(db, stationId) };
  },

  /**
   * Queues the routine work nobody has to ask for, then claims the oldest queued job:
   * a library sync every SCHEDULED_SYNC_MINUTES, writing applied changes to RadioDJ, and
   * rewriting the AutoDJ fail-safe's events when the station's UTC offset has moved (DST).
   * A failed write at the head of the line waits for a person to retry it from the UI.
   */
  async nextJob(db: Db, stationId: string, a: { now: Date }) {
    const lastSync = await lastRequested(db, stationId, "sync_library");
    if (!lastSync || a.now.getTime() - lastSync.getTime() > SCHEDULED_SYNC_MINUTES * 60_000) {
      await enqueueJob(db, stationId, "sync_library", "schedule");
    }
    if ((await nextProjectionStatus(db, stationId)) === "pending") {
      await enqueueJob(db, stationId, "project_changesets", "changeset");
    }
    if (await autodjEventsStale(db, stationId, a.now)) {
      await enqueueJob(db, stationId, "project_autodj_events", "schedule");
    }
    return claimNextJob(db, stationId, a.now);
  },

  /**
   * `watermark` is what a job hands Rotavox to remember. Only project_autodj_events sends
   * one: the UTC offset RadioDJ's events are now set for, or "none" for a box without a plan.
   */
  async finishJob(
    db: Db,
    stationId: string,
    a: { jobId: string; ok: boolean; summary: string; output: string; watermark?: string | null },
  ) {
    const [job] = await db
      .select({ id: schema.runnerJobs.id, kind: schema.runnerJobs.kind })
      .from(schema.runnerJobs)
      .where(and(eq(schema.runnerJobs.id, a.jobId), eq(schema.runnerJobs.stationId, stationId)));
    if (!job) throw new RunnerOpError(404, `no job ${a.jobId} at this station`);
    await finishJob(db, a.jobId, { ok: a.ok, summary: a.summary, output: a.output });
    if (a.ok && job.kind === "project_autodj_events" && a.watermark) {
      await db
        .insert(syncState)
        .values({ stationId, syncKey: AUTODJ_EVENTS_SYNC_KEY, watermark: a.watermark })
        .onConflictDoUpdate({
          target: [syncState.stationId, syncState.syncKey],
          set: { watermark: a.watermark, updatedAt: new Date() },
        });
    }
  },

  async pruneJobs(db: Db, stationId: string, a: { now: Date }): Promise<void> {
    await pruneJobs(db, stationId, KEEP_SCHEDULED_DAYS, a.now);
  },

  // ── Writing changes to RadioDJ ──

  /** Applied changesets not yet in RadioDJ, oldest first, with the projection map to translate them. */
  async pendingProjections(db: Db, stationId: string) {
    const pending = await listPendingProjections(db, stationId);
    if (pending.length === 0) return { pending: [] as WirePendingProjection[], cats: [], lifecycle: null };
    const { cats, lifecycle } = await loadProjection(db, stationId);
    return {
      pending: pending.map((p) => ({
        ...p,
        mirrorSubcat: Object.fromEntries(p.mirrorSubcat),
      })) as WirePendingProjection[],
      cats,
      lifecycle,
    };
  },

  /**
   * Records how writing one changeset went. On success, the mirror's subcategories take
   * the values just written, so the next changeset's precondition is right without
   * waiting for a sync.
   */
  async finishProjection(
    db: Db,
    stationId: string,
    a: { changesetId: string; ok: boolean; error?: string; moves?: { rdjSongId: number; toSubcat: number }[] },
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const [cs] = await tx
        .select({ id: changesets.id })
        .from(changesets)
        .where(and(eq(changesets.id, a.changesetId), eq(changesets.stationId, stationId)));
      if (!cs) throw new RunnerOpError(404, `no changeset ${a.changesetId} at this station`);
      for (const m of a.moves ?? []) {
        await tx
          .update(songs)
          .set({ rdjSubcategoryId: m.toSubcat })
          .where(and(eq(songs.stationId, stationId), eq(songs.rdjSongId, m.rdjSongId)));
      }
      await tx
        .update(changesets)
        .set(
          a.ok
            ? { projection: "projected", projectedAt: new Date(), projectionError: null }
            : { projection: "failed", projectionError: a.error ?? "failed" },
        )
        .where(eq(changesets.id, a.changesetId));
    });
  },

  /** Mirrors a hand-applied changeset file's moves into Rotavox membership (apply-changeset). */
  async mirrorChangeset(db: Db, stationId: string, a: { changesetId: string; moves: MirrorMove[] }) {
    return mirrorChangesetMoves(db, stationId, a.changesetId, a.moves);
  },
};

/** What a log's copy depends on, besides the Runner's own pushed_at and aired_at. */
function logDigest(log: LogRow, items: PacingItem[]): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify([log.id, log.status, log.startsAt, log.endsAt, log.generatedAt]));
  for (const i of items) {
    hash.update(
      JSON.stringify([
        i.id,
        i.sortOrder,
        i.projectedAirAt,
        i.elementType,
        i.songId,
        i.rdjSongId,
        i.clockPositionId,
        i.locked,
        i.timingMs,
        i.tohLocked,
      ]),
    );
  }
  return hash.digest("base64url");
}

export type RunnerOps = typeof runnerOps;
export type RunnerOpName = keyof RunnerOps;
/** The argument an operation takes, or `undefined` for one that takes none. */
export type RunnerOpArgs<K extends RunnerOpName> =
  Parameters<RunnerOps[K]> extends [Db, string, infer A] ? A : undefined;
export type RunnerOpResult<K extends RunnerOpName> = Awaited<ReturnType<RunnerOps[K]>>;

export const isRunnerOp = (name: string): name is RunnerOpName => Object.prototype.hasOwnProperty.call(runnerOps, name);

/** Runs one operation from its wire form. Shared by the API route and the Runner's direct mode. */
export async function runRunnerOp(db: Db, stationId: string, op: RunnerOpName, body: string): Promise<string> {
  const args = decodeWire<unknown>(body || "null");
  const fn = runnerOps[op] as (db: Db, stationId: string, args: unknown) => Promise<unknown>;
  return encodeWire(await fn(db, stationId, args ?? {}));
}
