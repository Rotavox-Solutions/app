import type { LogItemRow, LogRow } from "@rotavox/schema";
import { drainInstant } from "./boundary.js";
import { api } from "./scheduler.js";
import { pool } from "./db.js";
import { loadSchemaMap, guessHistoryColumns } from "./schema-map.js";
import { getQueue, extractQueueSongIds } from "./rest.js";

export type { LogItemRow, LogRow };

/** The current log: approved, and `now` falls inside [starts_at, ends_at). */
export async function selectCurrentLog(): Promise<LogRow | null> {
  return api("currentLog", { at: new Date() });
}

/** Next log_item to push: earliest sort_order, unpushed, not a fixed_event (§6 — RadioDJ-owned). */
export async function nextUnpushedItem(logId: string): Promise<LogItemRow | null> {
  return api("nextUnpushedItem", { logId });
}

/** target_offset_seconds = 0 marks the TOH-locked position (see plan §5). */
export async function isTohLocked(item: LogItemRow): Promise<boolean> {
  if (!item.clockPositionId) return false;
  return api("isTohLocked", { clockPositionId: item.clockPositionId });
}

export const TOH_LOOKAHEAD_SECONDS = 10;

/** §5: TOH-locked items wait for real time to approach their projected air instant; everything else paces on depth alone. */
export function shouldPushNow(item: LogItemRow, tohLocked: boolean, now: Date): boolean {
  if (!tohLocked) return true;
  if (!item.projectedAirAt) return true;
  return now.getTime() >= item.projectedAirAt.getTime() - TOH_LOOKAHEAD_SECONDS * 1000;
}

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
  // Durations are segue-aware (effective_duration_ms, falling back to file duration);
  // the item on air is the most recently stamped one, and the queue cannot drain before
  // it finishes.
  const { pendingMs, playingEndsAtMs } = await api("queueDrainInputs", { logId });
  return drainInstant(now, playingEndsAtMs, pendingMs + extraPendingMs);
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
  const rows = await api("fillerCandidates", { logId }); // sort_order asc ≈ oldest-aired first
  const pushed = rows.filter((r) => r.item.pushedAt != null && r.item.rdjSongId != null);
  const chosen =
    pushed.find((r) => !excludeIds.has(r.item.rdjSongId!)) ??
    pushed.find((r) => r.item.rdjSongId !== currentlyPlaying) ??
    pushed[0] ??
    null;
  // Selection rule unchanged on purpose — longest-that-fits is proposed but NOT
  // adopted (PERFECT-HOUR.md §5a). With the trigger fixed this path should be
  // effectively unreachable, so changing both at once would be untestable in anger.
  return chosen ? { item: chosen.item, durationMs: chosen.durationMs } : null;
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
  if (!(await api("hasPushed", { logId: log.id }))) {
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

  const candidates = await api("unpushedItems", { logId: log.id, limit: REBUILD_LOOKAHEAD });

  let backfilled = 0;
  let anomaly: RebuildResult["anomaly"] = null;
  const now = new Date();
  for (const item of candidates) {
    if (item.rdjSongId != null && realizedIds.has(item.rdjSongId)) {
      await api("markPushed", { itemIds: [item.id], at: now });
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
  return api("resetAfterQueueClear", { logId, now });
}
