import { and, asc, desc, eq, gt, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { clockPositions, logItems, logs, songs } from "@rotavox/schema";
import { drainInstant } from "./boundary.js";
import { schedulerDb, stationId } from "./scheduler-db.js";
import { pool } from "./db.js";
import { loadSchemaMap, guessHistoryColumns } from "./schema-map.js";
import { getQueue, extractQueueSongIds } from "./rest.js";

export type LogRow = typeof logs.$inferSelect;
export type LogItemRow = typeof logItems.$inferSelect;

/** The current log: approved, and `now` falls inside [starts_at, ends_at). */
export async function selectCurrentLog(): Promise<LogRow | null> {
  const now = new Date();
  const rows = await schedulerDb
    .select()
    .from(logs)
    .where(
      and(
        eq(logs.stationId, stationId),
        eq(logs.status, "approved"),
        lte(logs.startsAt, now),
        gt(logs.endsAt, now)
      )
    )
    .orderBy(logs.generatedAt);
  if (rows.length === 0) return null;
  return rows[rows.length - 1]; // most recent generatedAt
}

/** Next log_item to push: earliest sort_order, unpushed, not a fixed_event (§6 — RadioDJ-owned). */
export async function nextUnpushedItem(logId: string): Promise<LogItemRow | null> {
  const [row] = await schedulerDb
    .select()
    .from(logItems)
    .where(and(eq(logItems.logId, logId), isNull(logItems.pushedAt), ne(logItems.elementType, "fixed_event")))
    .orderBy(asc(logItems.sortOrder))
    .limit(1);
  return row ?? null;
}

/** target_offset_seconds = 0 marks the TOH-locked position (see plan §5). */
export async function isTohLocked(item: LogItemRow): Promise<boolean> {
  if (!item.clockPositionId) return false;
  const [pos] = await schedulerDb
    .select({ offset: clockPositions.targetOffsetSeconds })
    .from(clockPositions)
    .where(eq(clockPositions.id, item.clockPositionId));
  return pos?.offset === 0;
}

export const TOH_LOOKAHEAD_SECONDS = 10;

/** §5: TOH-locked items wait for real time to approach their projected air instant; everything else paces on depth alone. */
export function shouldPushNow(item: LogItemRow, tohLocked: boolean, now: Date): boolean {
  if (!tohLocked) return true;
  if (!item.projectedAirAt) return true;
  return now.getTime() >= item.projectedAirAt.getTime() - TOH_LOOKAHEAD_SECONDS * 1000;
}

/**
 * Segue-aware duration for timing arithmetic.
 *
 * The next track starts at RadioDJ's `xta` cue, not at end-of-file, so
 * effective_duration_ms is what the queue actually consumes; duration_ms is the
 * fallback where the sync could not read cue points (schema.ts notes that using file
 * duration throughout costs roughly 24s of drift per hour).
 */
const TIMING_DURATION_MS = sql<number>`coalesce(${songs.effectiveDurationMs}, ${songs.durationMs}, 0)`;

/**
 * How much audio RadioDJ is already holding, expressed as the instant it runs out.
 *
 * Composed from our own DB rather than RadioDJ's queue XML deliberately: /RDJp is not
 * documented to carry per-track duration on this plugin version, and inventing a field
 * name would violate invariant #1. We already know exactly what we pushed, and the
 * now-playing watcher tells us what has started.
 *
 * `extraPendingMs` covers audio we pushed that this query cannot see — a bridged
 * repeat is an already-aired log_item, so it keeps its original aired_at and looks
 * like history rather than like something still queued.
 */
export async function projectedQueueDrainAt(
  logId: string,
  now: Date,
  extraPendingMs = 0
): Promise<Date> {
  const [pending] = await schedulerDb
    .select({ ms: sql<number>`coalesce(sum(${TIMING_DURATION_MS}), 0)` })
    .from(logItems)
    .leftJoin(songs, eq(logItems.songId, songs.id))
    .where(and(eq(logItems.logId, logId), isNotNull(logItems.pushedAt), isNull(logItems.airedAt)));

  // The item on air is the most recently stamped one; the queue cannot drain before it
  // finishes, and everything pushed behind it is the `pending` sum above.
  const [playing] = await schedulerDb
    .select({ airedAt: logItems.airedAt, durationMs: TIMING_DURATION_MS })
    .from(logItems)
    .leftJoin(songs, eq(logItems.songId, songs.id))
    .where(and(eq(logItems.logId, logId), isNotNull(logItems.airedAt)))
    .orderBy(desc(logItems.airedAt))
    .limit(1);

  const playingEndsAt = playing?.airedAt
    ? playing.airedAt.getTime() + Number(playing.durationMs ?? 0)
    : null;

  return drainInstant(now, playingEndsAt, Number(pending?.ms ?? 0) + extraPendingMs);
}

/**
 * Filler source (§5), never a new log_items row. Picks an already-pushed MUSIC item
 * to repeat, maximizing separation: the OLDEST-pushed item whose rdj_song_id is not
 * in `excludeIds`. Pass the currently-playing song plus a rolling window of recently
 * AIRED songs. Oldest-first + recent-aired exclusion means a long underrun rotates
 * through the hour's catalogue rather than hammering the last one or two songs
 * back-to-back — a live incident (2026-07-03) showed the old "most-recent, exclude
 * only currently-playing" rule looping 2 songs for ~15 min ("every song playing
 * twice"). Fallbacks when everything is excluded (tiny catalogue): oldest not-
 * currently-playing item, then the oldest pushed item, then null.
 */
export async function pickFillerItem(
  logId: string,
  excludeIds: Set<number>,
  currentlyPlaying: number | null
): Promise<{ item: LogItemRow; durationMs: number } | null> {
  const rows = await schedulerDb
    .select({ item: logItems, durationMs: TIMING_DURATION_MS })
    .from(logItems)
    .leftJoin(songs, eq(logItems.songId, songs.id))
    .where(and(eq(logItems.logId, logId), eq(logItems.elementType, "music")))
    .orderBy(asc(logItems.sortOrder)); // sort_order asc ≈ oldest-aired first
  const pushed = rows.filter((r) => r.item.pushedAt != null && r.item.rdjSongId != null);
  const chosen =
    pushed.find((r) => !excludeIds.has(r.item.rdjSongId!)) ??
    pushed.find((r) => r.item.rdjSongId !== currentlyPlaying) ??
    pushed[0] ??
    null;
  // Selection rule unchanged on purpose — longest-that-fits is proposed but NOT
  // adopted (PERFECT-HOUR.md §5a). With the trigger fixed this path should be
  // effectively unreachable, so changing both at once would be untestable in anger.
  return chosen ? { item: chosen.item, durationMs: Number(chosen.durationMs ?? 0) } : null;
}

interface RebuildResult {
  backfilled: number;
  /** Logged for visibility only — never blocks pushing. Silence is worse than a logged discrepancy. */
  anomaly: { sortOrder: number; expectedRdjSongId: number | null } | null;
  /**
   * True when nothing in this log has ever been pushed — i.e. the Runner is adopting
   * the log cold, taking over from whatever was on air (AutoDJ). The caller uses this
   * to clear AutoDJ's leftover queue exactly once, at takeover. NEVER true on a
   * crash-resume (something was already pushed), so our own in-flight queue is safe.
   */
  freshTakeover: boolean;
}

const REBUILD_LOOKAHEAD = 10;

/**
 * §3, corrected after a live incident (see git history / postmortem): the original
 * design strictly aligned the ENTIRE remaining log against history+queue since
 * log.starts_at and hard-halted on any mismatch. That broke the very first time
 * foreign content (a leftover AutoDJ queue draining past the log's start) touched
 * history in that window — a single, ordinary, expected-in-production event caused
 * the pacer to stop pushing indefinitely while nothing else defended the queue,
 * and the station went silent within minutes. Two corrections:
 *
 * 1. Reconciliation is scoped to the crash-recovery gap it exists for. If nothing
 *    in this log has pushed_at set yet, there is nothing of OURS to reconcile —
 *    our own DB is already ground truth for "not pushed," and this returns
 *    immediately with no queue/history read at all (so foreign content occurring
 *    before we've ever pushed anything can never trigger a false anomaly).
 * 2. When there IS a prior push to resume from, only a small bounded lookahead
 *    just past it is checked (crash window is at most one push), matched by
 *    membership (not strict full-sequence position) against recent history +
 *    live queue, and a mismatch is reported for visibility but never stops
 *    pushing — the pacer always keeps the queue defended.
 */
export async function rebuildCursor(log: LogRow): Promise<RebuildResult> {
  // Fresh log — nothing of ours pushed yet. Our own DB is already ground truth
  // for "not pushed"; nothing to reconcile, and no queue/history read at all —
  // this is what prevents foreign content from ever causing a false anomaly here.
  const [anyPushed] = await schedulerDb
    .select({ id: logItems.id })
    .from(logItems)
    .where(and(eq(logItems.logId, log.id), ne(logItems.elementType, "fixed_event"), isNotNull(logItems.pushedAt)))
    .limit(1);
  if (!anyPushed) {
    return { backfilled: 0, anomaly: null, freshTakeover: true };
  }

  const map = loadSchemaMap();
  const historyTable = map.tables.history;
  if (!historyTable) throw new Error("schema-map.json is missing the history table.");
  const { fk: trackIdCol, ts: datePlayedCol } = guessHistoryColumns(map);

  // Recent-only: this is closing a single crash window, not validating the whole run.
  const lookbackStart = new Date(Date.now() - 15 * 60_000);
  const [historyRows] = await pool.query<any[]>(
    `SELECT \`${trackIdCol}\` AS rdjSongId FROM \`${historyTable}\` WHERE \`${datePlayedCol}\` >= ?`,
    [lookbackStart]
  );
  const queueIds = extractQueueSongIds(await getQueue());
  const realizedIds = new Set<number>([...historyRows.map((r) => Number(r.rdjSongId)), ...queueIds]);

  const candidates = await schedulerDb
    .select()
    .from(logItems)
    .where(and(eq(logItems.logId, log.id), isNull(logItems.pushedAt), ne(logItems.elementType, "fixed_event")))
    .orderBy(asc(logItems.sortOrder))
    .limit(REBUILD_LOOKAHEAD);

  let backfilled = 0;
  let anomaly: RebuildResult["anomaly"] = null;
  const now = new Date();
  for (const item of candidates) {
    if (item.rdjSongId != null && realizedIds.has(item.rdjSongId)) {
      await schedulerDb.update(logItems).set({ pushedAt: now }).where(eq(logItems.id, item.id));
      backfilled++;
    } else if (backfilled === 0) {
      // The very next item isn't visibly realized — the normal case (no crash gap).
      break;
    } else {
      // Something was backfilled, but the lookahead ran out mid-way — logged for
      // visibility only; the pacer proceeds with backfilled items marked pushed
      // and simply pushes this one normally next tick.
      anomaly = { sortOrder: item.sortOrder, expectedRdjSongId: item.rdjSongId };
      break;
    }
  }
  return { backfilled, anomaly, freshTakeover: false };
}

/**
 * After RadioDJ's queue was cleared to evict foreign (AutoDJ) content mid-log: put our
 * own cleared items back to "unpushed", then skip forward past items whose slot has
 * already gone by, so the log resumes on its timetable instead of running as late as
 * the AutoDJ interlude lasted.
 *
 * Why this exists (live 2026-10-16): AutoDJ was switched on at the console for under a
 * minute. The pacer turned it back off within its 60s check, but AutoDJ had already
 * topped the queue up to its ~15-track fill, which kept depth >= MIN_DEPTH for ~25 min —
 * the pacer, heartbeating and healthy, never pushed. A watchdog failover leaves the
 * same 15 tracks behind for the pacer when it comes back.
 *
 * - Un-push: pushed_at set, aired_at null, and later than the last aired item — those
 *   were sitting in the queue that was just cleared. Earlier pushed-but-unaired items
 *   are genuine skips and stay as they are.
 * - Skip: an unpushed item whose NEXT item was projected to start at or before `now`
 *   has had its whole slot pass. It is marked pushed with aired_at null, the same
 *   "pushed but never aired" state a skip already has. The item whose slot contains
 *   `now` is kept, so the log re-enters at most one song late, which the TOH boundary
 *   logic absorbs.
 */
export async function resetAfterQueueClear(logId: string, now: Date): Promise<{ unpushed: number; skipped: number }> {
  return schedulerDb.transaction(async (tx) => {
    const [lastAired] = await tx
      .select({ sortOrder: logItems.sortOrder })
      .from(logItems)
      .where(and(eq(logItems.logId, logId), isNotNull(logItems.airedAt)))
      .orderBy(desc(logItems.sortOrder))
      .limit(1);
    const floor = lastAired?.sortOrder ?? -1;

    const unpushedRows = await tx
      .update(logItems)
      .set({ pushedAt: null })
      .where(
        and(
          eq(logItems.logId, logId),
          isNotNull(logItems.pushedAt),
          isNull(logItems.airedAt),
          gt(logItems.sortOrder, floor),
          ne(logItems.elementType, "fixed_event")
        )
      )
      .returning({ id: logItems.id });

    const pending = await tx
      .select({ id: logItems.id, projectedAirAt: logItems.projectedAirAt })
      .from(logItems)
      .where(and(eq(logItems.logId, logId), isNull(logItems.pushedAt), ne(logItems.elementType, "fixed_event")))
      .orderBy(asc(logItems.sortOrder));

    const skipIds: string[] = [];
    for (let i = 0; i + 1 < pending.length; i++) {
      const nextStart = pending[i + 1].projectedAirAt;
      if (!nextStart || nextStart.getTime() > now.getTime()) break;
      skipIds.push(pending[i].id);
    }
    for (const id of skipIds) {
      await tx.update(logItems).set({ pushedAt: now }).where(eq(logItems.id, id));
    }
    return { unpushed: unpushedRows.length, skipped: skipIds.length };
  });
}
