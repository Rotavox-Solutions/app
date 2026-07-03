import { and, asc, eq, gt, isNotNull, isNull, lte, ne } from "drizzle-orm";
import { clockPositions, logItems, logs } from "@rotavox/schema";
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
): Promise<LogItemRow | null> {
  const rows = await schedulerDb
    .select()
    .from(logItems)
    .where(and(eq(logItems.logId, logId), eq(logItems.elementType, "music")))
    .orderBy(asc(logItems.sortOrder)); // sort_order asc ≈ oldest-aired first
  const pushed = rows.filter((r) => r.pushedAt != null && r.rdjSongId != null);
  return (
    pushed.find((r) => !excludeIds.has(r.rdjSongId!)) ??
    pushed.find((r) => r.rdjSongId !== currentlyPlaying) ??
    pushed[0] ??
    null
  );
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
