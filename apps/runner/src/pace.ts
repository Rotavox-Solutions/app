import "dotenv/config";
import { eq } from "drizzle-orm";
import { logItems } from "@rotavox/schema";
import { restCall, getState, getNowPlaying, getQueue, extractNowPlayingId, extractQueueSongIds } from "./rest.js";
import { schedulerDb, pgClient } from "./scheduler-db.js";
import { pool } from "./db.js";
import {
  selectCurrentLog,
  nextUnpushedItem,
  isTohLocked,
  shouldPushNow,
  pickFillerItem,
  projectedQueueDrainAt,
  rebuildCursor,
  resetAfterQueueClear,
  type LogRow,
} from "./cursor.js";
import { decideBoundaryAction, EARLY_AIR_HARD_CAP_MS } from "./boundary.js";
import { reconcileHistory } from "./reconcile-history.js";
import { backfillAiredAt, matchAndStampAiredAt } from "./backfill-aired.js";
import { writeHeartbeat } from "./heartbeat.js";

/**
 * Every line the pacer emits carries a timestamp.
 *
 * Without one the log is unreadable during exactly the situation it exists for: an
 * incident. "current log ended" tells you nothing if you cannot tell whether it happened
 * two minutes or six hours ago. Local time with offset, so it reads against a station
 * clock without arithmetic.
 */
function ts(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)} ` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}${pad(Math.abs(off) % 60)}`
  );
}
function say(...a: unknown[]): void { console.log(ts(), ...a); }
function sayWarn(...a: unknown[]): void { console.warn(ts(), ...a); }
function sayError(...a: unknown[]): void { console.error(ts(), ...a); }

const POLL_INTERVAL_MS = 5_000;
const MIN_DEPTH = 3;
const RECONCILE_EVERY_N_TICKS = 6; // ~30s
const AUTODJ_CHECK_EVERY_N_TICKS = 12; // ~60s
// Deliberately tighter than POLL_INTERVAL_MS: this loop exists purely to observe
// aired_at precisely (accuracy is a core product requirement, not a nice-to-have),
// decoupled from pacing decisions. RadioDJ's own `history` table doesn't log short
// imaging/sweeper elements reliably (found 2026-07-02 live — one 3.8s sweeper never
// appeared in history at all). 1s + the queue-diff check below (not just direct
// /RDJnp observation) is still local/LAN-cheap and catches effectively everything;
// see queue-diff comment for the residual gap even this can't close.
const NOW_PLAYING_POLL_MS = 1_000;

let currentLogId: string | null = null;
let lastObservedNowPlayingId: number | null = null;
let previousQueueIds: number[] | null = null; // null until the first poll after a (re)start
// Rolling window of recently-aired song IDs, so the underrun filler can rotate through
// the catalogue instead of repeating what just played (see pickFillerItem).
const RECENT_AIRED_CAP = 8;
const recentlyAiredIds: number[] = [];
/**
 * Audio we bridged in since the last ID, ms.
 *
 * A bridge re-pushes an ALREADY-aired log_item, so it keeps its original aired_at and
 * projectedQueueDrainAt() cannot see it sitting in the queue. Unaccounted, the next
 * tick would measure the same hole and bridge again, stacking records. Reset once the
 * boundary is crossed.
 */
let bridgedMs = 0;

async function markPushed(itemId: string): Promise<void> {
  await schedulerDb.update(logItems).set({ pushedAt: new Date() }).where(eq(logItems.id, itemId));
}

/** Record a song as recently aired (rolling window), de-duping consecutive repeats. */
function recordAired(id: number): void {
  if (recentlyAiredIds[recentlyAiredIds.length - 1] === id) return;
  recentlyAiredIds.push(id);
  while (recentlyAiredIds.length > RECENT_AIRED_CAP) recentlyAiredIds.shift();
}

/**
 * Prime the queue to MIN_DEPTH immediately on a cold takeover, instead of letting the
 * 5s tick loop build the buffer one item at a time. A just-cleared queue is empty
 * behind the finishing track; if it drains before the buffer builds, RadioDJ starves
 * and skips upcoming items (live 2026-07-03: ~4 items skipped at the AutoDJ handoff,
 * which then caused a 15-min underrun and filler looping). Respects the TOH hold —
 * stops at a TOH item that isn't due yet rather than rushing it in early.
 */
async function primeQueue(log: LogRow): Promise<void> {
  const now = new Date();
  for (let i = 0; i < MIN_DEPTH; i++) {
    const depth = Number(await restCall("StatusQueue"));
    if (depth >= MIN_DEPTH) break;
    const next = await nextUnpushedItem(log.id);
    if (!next?.rdjSongId) break;
    const tohLocked = await isTohLocked(next);
    if (tohLocked && !shouldPushNow(next, tohLocked, now)) break;
    await restCall("LoadTrackToBottom", next.rdjSongId);
    await markPushed(next.id);
    say(`[pace] prime pushed rdj:${next.rdjSongId} (sort ${next.sortOrder}), depth was ${depth}`);
  }
}

/**
 * Evict foreign content and resume the log on its timetable. Used whenever AutoDJ is
 * found ON while a log is current — a console override, or the watchdog's fail-safe
 * after this process died. Either way AutoDJ has topped the queue up to its ~15-track
 * fill, and merely switching it off leaves those tracks to air first, holding depth
 * at or above MIN_DEPTH so nothing of ours is pushed for most of an hour (live
 * 2026-10-16). See resetAfterQueueClear for what happens to our own items.
 */
async function reclaimQueue(log: LogRow): Promise<void> {
  await restCall("EnableAutoDJ", 0);
  await restCall("ClearPlaylist");
  // Stamp what genuinely aired first (e.g. our queued items that played out while this
  // process was dead) so the reset below can't mistake them for cleared and re-air them.
  const reconciled = await reconcileHistory();
  if (reconciled.length > 0) await backfillAiredAt(log.id, reconciled);
  const { unpushed, skipped } = await resetAfterQueueClear(log.id, new Date());
  previousQueueIds = null; // the clear is not a run of skips for the queue-diff watcher
  bridgedMs = 0;
  sayWarn(
    `[pace] reclaimed queue from AutoDJ — cleared it (playing track preserved), ` +
      `${unpushed} of our item(s) re-queued, ${skipped} past-due item(s) skipped to rejoin the timetable.`
  );
  await primeQueue(log);
}

async function startupForLog(log: LogRow): Promise<void> {
  say(`[pace] current log ${log.id} (${log.startsAt.toISOString()} - ${log.endsAt.toISOString()}) — taking over queue, asserting EnableAutoDJ=0`);
  // Read before switching it off: AutoDJ ON when resuming a log we were already
  // pacing means the watchdog (or the console) handed playout to AutoDJ while we were
  // gone, and its fill is now sitting in the queue ahead of the log.
  const autoDjWasOn = extractAutoDj(await getState()) === true;
  // Runner owns the queue only while a log is actually current (invariant #4).
  // Asserting AutoDJ off is deferred to here (not paceLoop start) so the pacer can
  // run harmlessly before its window opens, leaving the station on AutoDJ until then.
  await restCall("EnableAutoDJ", 0);
  // Cross-checks against RadioDJ only when resuming a log we've already started
  // pushing into (see cursor.ts docstring — a hard-halt here once caused real dead
  // air). A detected anomaly is logged, never blocking: the queue stays defended.
  const rebuild = await rebuildCursor(log);
  if (rebuild.freshTakeover) {
    // Cold takeover from AutoDJ: drop whatever AutoDJ pre-queued below the currently
    // playing track. Without this the log airs behind ~15 leftover tracks (~50min),
    // and since TOH items are time-gated they never catch up — the whole log runs
    // late. ClearPlaylist preserves the playing track (verified live 2026-07-02:
    // depth->0, now-playing unchanged), so there is no gap. Gated to fresh takeover
    // only — never on crash-resume, which would wipe our own in-flight pushed queue.
    await restCall("ClearPlaylist");
    say("[pace] fresh takeover — cleared AutoDJ's leftover queue (playing track preserved).");
    await primeQueue(log);
  } else if (autoDjWasOn) {
    currentLogId = log.id;
    await reclaimQueue(log);
    return;
  }
  if (rebuild.backfilled > 0) {
    say(`[pace] cursor rebuilt: ${rebuild.backfilled} item(s) already realized, resuming from there.`);
  }
  if (rebuild.anomaly) {
    sayWarn(
      `[pace] anomaly at sort_order ${rebuild.anomaly.sortOrder}: expected rdj_song_id=${rebuild.anomaly.expectedRdjSongId} ` +
        `not visible in RadioDJ's recent history/queue. Logged for visibility; pushing proceeds normally.`
    );
  }
  currentLogId = log.id;
}

async function tick(): Promise<void> {
  const log = await selectCurrentLog();

  if (!log) {
    if (currentLogId !== null) {
      // Log window ended with nothing to follow it. Never hold the station in dead
      // air (live incident 2026-07-02: window expired, AutoDJ kept forced off, queue
      // drained to silence). Hand playout back to RadioDJ's AutoDJ so audio continues
      // until the next Rotavox log (if any) becomes current and takes over again.
      say("[pace] current log ended — no follow-up log; handing playout back to AutoDJ (EnableAutoDJ=1).");
      await restCall("EnableAutoDJ", 1);
    }
    currentLogId = null;
    return;
  }

  if (log.id !== currentLogId) {
    await startupForLog(log);
  }

  const depth = Number(await restCall("StatusQueue"));
  const next = await nextUnpushedItem(log.id);

  if (!next) {
    say(`[pace] no unpushed items remain in the current log (depth ${depth}).`);
    return;
  }

  const tohLocked = await isTohLocked(next);
  const now = new Date();

  // Plan §5: TOH-locked items are gated purely on time (never rushed in just
  // because depth is low); everything else paces purely on depth<MIN_DEPTH, same
  // as spec's simple loop. Both conditions must be checked explicitly — a bug here
  // once let ordinary items push unconditionally every tick regardless of depth,
  // queuing far more than "a few tracks deep" and undermining pre-air editability.
  const readyToPush = tohLocked ? shouldPushNow(next, tohLocked, now) : depth < MIN_DEPTH;

  if (readyToPush) {
    // Push before recording pushed_at, never the reverse — see plan §2. If the
    // process dies right after this call, rebuildCursor() picks it up on restart.
    await restCall("LoadTrackToBottom", next.rdjSongId!);
    await markPushed(next.id);
    if (tohLocked) bridgedMs = 0; // boundary crossed — the bridge is spent
    say(
      `[pace] pushed rdj:${next.rdjSongId} (sort ${next.sortOrder}${tohLocked ? ", TOH-locked" : ""}), depth was ${depth}`
    );
    return;
  }

  // TOH item held back and not yet due. What happens now is decided on TIME, not on
  // queue depth — see boundary.ts. Depth counts items, and one item is routinely a
  // three-minute song, which is how the old `depth <= 1` rule bridged holes that did
  // not exist and pushed the ID ten minutes late.
  if (!tohLocked) return;

  const drainAt = await projectedQueueDrainAt(log.id, now, bridgedMs);
  const gapMs = next.projectedAirAt ? next.projectedAirAt.getTime() - drainAt.getTime() : null;
  const decision = decideBoundaryAction(gapMs);

  if (decision.action === "wait") return;

  if (decision.action === "air-early") {
    // Airing the ID early beats injecting a record: it is a 2-5s element, the station
    // tolerance is <= one song either side of :00, and there is no inventory between
    // ~15s and ~169s to bridge with anyway (PERFECT-HOUR.md §5b).
    await restCall("LoadTrackToBottom", next.rdjSongId!);
    await markPushed(next.id);
    bridgedMs = 0;
    const early = Math.round(decision.earlyByMs / 1000);
    const line =
      `[pace] pushed rdj:${next.rdjSongId} (sort ${next.sortOrder}, TOH-locked) ${early}s EARLY — ` +
      `queue drains at ${drainAt.toISOString()}, ID due ${next.projectedAirAt?.toISOString()}`;
    if (decision.atCap) {
      sayWarn(`${line}. At the ${EARLY_AIR_HARD_CAP_MS / 1000}s backward limit — the hour ran short.`);
    } else {
      say(line);
    }
    return;
  }

  // Wider than the backward tolerance can absorb. Bridging here is the backstop of
  // last resort: per PERFECT-HOUR.md §4 an in-flight filler firing at all is a
  // generation miss, and measured over 48 consecutive hours there was never a genuine
  // underrun, so this firing means something upstream is wrong.
  const currentlyPlaying = extractNowPlayingId(await getNowPlaying());
  const exclude = new Set<number>(recentlyAiredIds);
  if (currentlyPlaying != null) exclude.add(currentlyPlaying);
  const filler = await pickFillerItem(log.id, exclude, currentlyPlaying);
  if (filler) {
    await restCall("LoadTrackToBottom", filler.item.rdjSongId!);
    bridgedMs += filler.durationMs;
    // Mark it recent immediately so a second bridge before this one airs rotates to a
    // different song rather than stacking the same one.
    recordAired(filler.item.rdjSongId!);
    sayWarn(
      `[filler] ${Math.round(decision.gapMs / 1000)}s hole before rdj:${next.rdjSongId} is due ` +
        `(${next.projectedAirAt?.toISOString()}) — repeated rdj:${filler.item.rdjSongId} ` +
        `(${Math.round(filler.durationMs / 1000)}s) to bridge it. THIS IS A GENERATION MISS: ` +
        `a properly scheduled hour never runs this short.`
    );
  } else {
    sayError(
      `[pace] ${Math.round(decision.gapMs / 1000)}s hole before the ID is due and no pushed ` +
        `music item is available to bridge it — dead air is imminent.`
    );
  }
}

function extractAutoDj(parsedState: unknown): boolean | null {
  const v = (parsedState as any)?.["PluginClass.IService.OptionState"]?.AutoDJ;
  if (v === undefined) return null;
  return String(v).toLowerCase() === "true";
}

/** Runner owns the queue (invariant #4) — defended continuously, not just at startup. */
async function assertAutoDjOff(log: LogRow): Promise<void> {
  const state = await getState();
  const autoDj = extractAutoDj(state);
  if (autoDj === true) {
    sayWarn("[pace] AutoDJ came back ON (console override?) — switching it off and reclaiming the queue");
    await reclaimQueue(log);
  } else if (autoDj === null) {
    sayWarn("[pace] could not read AutoDJ state from /RDJState response");
  }
}

/**
 * Primary source of aired_at precision (see NOW_PLAYING_POLL_MS comment above).
 * Runs independently of the pace tick loop — logging accuracy shouldn't be gated
 * by, or gate, pacing decisions. Two complementary signals, both matched via the
 * same matchAndStampAiredAt (idempotent — a row already aired is simply skipped):
 *
 * 1. Direct observation: a now-playing ID transition is matched and stamped with
 *    the observation instant — the closest thing to a true air time this
 *    REST-polling architecture can produce for anything that lives long enough
 *    to be caught by at least one poll.
 * 2. Queue-diff backstop: an item present in the queue on the previous poll but
 *    gone on this one, and not the current now-playing item either, must have
 *    started AND finished entirely within the poll gap — direct observation
 *    structurally cannot catch this (found live 2026-07-02: a 3.8s TOH sweeper
 *    slipped between two polls and was invisible to both /RDJnp and RadioDJ's own
 *    history). Stamped with this poll's timestamp, an approximation (the item
 *    could have aired anywhere in the gap) — logged distinctly as "inferred" to
 *    be honest about the reduced precision, unlike direct observation's near-exact
 *    timestamp. Residual gap even this can't close: two or more same-duration
 *    items vanishing in one gap are indistinguishable from each other by ID alone
 *    if the same rdj_song_id repeats — practically rare (filler repeats are the
 *    only source of same-song requeues, and matchAndStampAiredAt's "earliest
 *    unaired" rule already handles ordering correctly for those).
 */
async function watchNowPlaying(): Promise<void> {
  while (true) {
    try {
      if (currentLogId) {
        const [np, queueParsed] = await Promise.all([getNowPlaying(), getQueue()]);
        const id = extractNowPlayingId(np);
        const currentQueueIds = extractQueueSongIds(queueParsed);
        const observedAt = new Date();

        if (id != null && id !== lastObservedNowPlayingId) {
          recordAired(id);
          const matched = await matchAndStampAiredAt(currentLogId, id, observedAt);
          if (matched) {
            say(`[now-playing] rdj:${id} observed airing at ${observedAt.toISOString()}`);
          }
        }

        if (previousQueueIds) {
          const currentSet = new Set(currentQueueIds);
          const vanished = previousQueueIds.filter((q) => q !== id && !currentSet.has(q));
          // Playback advances through at most one item per ~1s poll, so inferring
          // "aired" from a queue vanish is only sound for a SINGLE vanished item.
          // Multiple tracks vanishing in one poll were REMOVED without airing —
          // observed live at the AutoDJ->log handoff (2026-07-03): 3 upcoming tracks
          // were dropped in one poll and never appeared in RadioDJ history. Stamping
          // them "aired" is a false log entry; leave aired_at null (the truthful
          // state: pushed but never aired) and just log the skip for visibility.
          if (vanished.length === 1) {
            const matched = await matchAndStampAiredAt(currentLogId, vanished[0], observedAt);
            if (matched) {
              say(`[queue-diff] rdj:${vanished[0]} inferred aired (vanished between polls) at ${observedAt.toISOString()}`);
            }
          } else if (vanished.length > 1) {
            sayWarn(
              `[queue-diff] ${vanished.length} tracks vanished in one poll (rdj:${vanished.join(",")}) — ` +
                `treating as skips (playback can't air >1/poll); not stamping aired_at.`
            );
          }
        }

        previousQueueIds = currentQueueIds;
        lastObservedNowPlayingId = id;
      }
    } catch (err) {
      sayError("[now-playing] watch error (continuing):", err);
    }
    await new Promise((r) => setTimeout(r, NOW_PLAYING_POLL_MS));
  }
}

async function paceLoop(): Promise<void> {
  say("[pace] starting — AutoDJ left as-is until a current log is adopted");

  let tickCount = 0;
  while (true) {
    tickCount++;
    try {
      await tick();

      if (tickCount % RECONCILE_EVERY_N_TICKS === 0 && currentLogId) {
        const reconciled = await reconcileHistory();
        if (reconciled.length > 0) {
          const updated = await backfillAiredAt(currentLogId, reconciled);
          say(`[reconcile] ${reconciled.length} history row(s), ${updated} log_item(s) backfilled with aired_at.`);
        }
      }

      if (tickCount % AUTODJ_CHECK_EVERY_N_TICKS === 0 && currentLogId) {
        const log = await selectCurrentLog();
        if (log?.id === currentLogId) await assertAutoDjOff(log);
      }
    } catch (err) {
      sayError("[pace] tick error (continuing):", err);
    }
    // Written every iteration regardless of tick outcome — this is a liveness signal
    // for the watchdog ("the loop is still running"), not a "tick succeeded" signal.
    // A transient DB hiccup that this loop is actively retrying is not the same thing
    // as a hung/dead process, and shouldn't trip the watchdog's AutoDJ fail-safe.
    try {
      await writeHeartbeat();
    } catch (err) {
      sayError("[pace] failed to write heartbeat:", err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

/**
 * Closes the one gap the in-loop hand-back (see tick()'s `!log` branch) can't cover:
 * `currentLogId` starts `null`, and that branch only fires on a *transition* away from
 * a log we were actively pacing. If a previous Runner instance died while AutoDJ was
 * off and that log's window has since expired, a freshly-started Runner finds no
 * current log, `currentLogId` is already null, and nothing would otherwise touch
 * AutoDJ — leaving it off with nobody pacing. Run once, before the main loop starts.
 */
async function reconcileAutoDjOnStartup(): Promise<void> {
  const log = await selectCurrentLog();
  if (log) return; // normal startupForLog() path on the first tick will take it from here

  const autoDj = extractAutoDj(await getState());
  if (autoDj === false) {
    say("[pace] startup reconciliation: no current log and AutoDJ is off — forcing EnableAutoDJ=1.");
    await restCall("EnableAutoDJ", 1);
  } else if (autoDj === null) {
    sayWarn("[pace] startup reconciliation: could not read AutoDJ state from /RDJState — leaving as-is.");
  }
}

async function main(): Promise<void> {
  // Non-fatal: a REST timeout here (seen on the 2026-10-15 rebuild) used to reject main()
  // before the loop started, leaving a live process that never wrote a heartbeat — so
  // the service manager saw it running and the watchdog saw "unknown", and nobody acted.
  try {
    await reconcileAutoDjOnStartup();
  } catch (err) {
    sayError("[pace] startup AutoDJ reconciliation failed (continuing into the loop):", err);
  }
  await Promise.all([paceLoop(), watchNowPlaying()]);
}

/**
 * Shared graceful-stop path for SIGINT (Ctrl+C) and SIGTERM (plain `kill`,
 * `systemctl stop`). Unconditionally hands playout back to AutoDJ before closing
 * connections — the previous SIGINT-only handler skipped this entirely. Covers
 * intentional stops; it cannot run for SIGKILL/a crash/an OOM kill/power loss, which
 * is exactly what the independent watchdog (watchdog.ts) exists for.
 */
async function shutdown(signal: string): Promise<void> {
  say(`\n[pace] ${signal} received — handing back to AutoDJ before shutdown...`);
  try {
    await restCall("EnableAutoDJ", 1);
  } catch (err) {
    sayError("[pace] failed to hand back to AutoDJ during shutdown (continuing shutdown):", err);
  }
  await pool.end();
  await pgClient.end();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Exit outright: the open MariaDB/Postgres pools would otherwise keep a dead pacer alive,
// invisible to both the service manager's restart and the watchdog.
main().catch((err) => {
  sayError(err);
  process.exit(1);
});
