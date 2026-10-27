// The immutability boundary + edit/re-approval state machine (M4a plan, Decision
// 2). Every mutating API route funnels through here so the boundary is enforced
// in exactly one place.
import { and, eq, gte, lt } from "drizzle-orm";
import { logItems, logs, playHistory, songs } from "@rotavox/schema";
import { db } from "./db";
import { recordAssumedAirplay } from "./log-export";
import { generateSpan, type GenerateNextHoursResult } from "./generation";
import { HOUR_MS, SAFETY_HORIZON_MINUTES } from "./constants";

export type LogRow = typeof logs.$inferSelect;
export type LogItemRow = typeof logItems.$inferSelect;

export type EditRejectReason =
  | "not_found"
  | "fixed_event"
  | "already_pushed"
  | "within_safety_horizon"
  | "locked"
  | "song_not_found"
  | "nothing_remaining"
  | "changed";

export class EditRejectedError extends Error {
  reason: EditRejectReason;
  constructor(reason: EditRejectReason) {
    super(`Edit rejected: ${reason}`);
    this.name = "EditRejectedError";
    this.reason = reason;
  }
}

/** status='approved' AND now falls inside [starts_at, ends_at) — matches cursor.ts's selectCurrentLog predicate exactly. */
export function isLogAiring(log: LogRow, now: Date = new Date()): boolean {
  return log.status === "approved" && log.startsAt <= now && now < log.endsAt;
}

export type DisplayStatus = "draft" | "approved" | "airing" | "aired";

/** Display-only derived status — logs.status itself stays 'draft' | 'approved' in the DB. */
export function deriveDisplayStatus(log: LogRow, now: Date = new Date()): DisplayStatus {
  if (log.status !== "approved") return "draft";
  if (now < log.startsAt) return "approved";
  if (now < log.endsAt) return "airing";
  return "aired";
}

/**
 * Boundary shared by every edit type, including lock/unlock: never touch a
 * fixed_event (hard external constraint, M5 territory), an already-pushed item,
 * or anything inside the safety horizon (see constants.ts for why pushed_at alone
 * is racy).
 */
export function canEditItem(item: LogItemRow, now: Date = new Date()): { ok: true } | { ok: false; reason: EditRejectReason } {
  if (item.elementType === "fixed_event") return { ok: false, reason: "fixed_event" };
  if (item.pushedAt !== null) return { ok: false, reason: "already_pushed" };
  if (!item.projectedAirAt || item.projectedAirAt.getTime() < now.getTime() + SAFETY_HORIZON_MINUTES * 60_000) {
    return { ok: false, reason: "within_safety_horizon" };
  }
  return { ok: true };
}

/** Replace/Swap additionally refuse a locked item (must be explicitly unlocked first). */
export function canMutateItem(item: LogItemRow, now: Date = new Date()): { ok: true } | { ok: false; reason: EditRejectReason } {
  const base = canEditItem(item, now);
  if (!base.ok) return base;
  if (item.locked) return { ok: false, reason: "locked" };
  return { ok: true };
}

// Extracts Drizzle's transaction-callback parameter type without hand-writing
// PgTransaction's generic signature.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Every lookup is scoped to the caller's station: a log id from another station is not_found.
async function fetchLogAndItem(tx: Tx, stationId: string, logId: string, itemId: string) {
  const [log] = await tx.select().from(logs).where(and(eq(logs.id, logId), eq(logs.stationId, stationId)));
  if (!log) throw new EditRejectedError("not_found");
  const [item] = await tx.select().from(logItems).where(and(eq(logItems.id, itemId), eq(logItems.logId, logId)));
  if (!item) throw new EditRejectedError("not_found");
  return { log, item };
}

/** Not-yet-airing approved log → draft on any content edit; airing/draft logs are untouched. Lock/unlock never calls this. */
async function maybeReturnToDraft(tx: Tx, log: LogRow, now: Date): Promise<LogRow> {
  if (log.status === "approved" && !isLogAiring(log, now)) {
    const [updated] = await tx.update(logs).set({ status: "draft" }).where(eq(logs.id, log.id)).returning();
    return updated;
  }
  return log;
}

export async function applyReplace(
  stationId: string,
  logId: string,
  itemId: string,
  songId: string
): Promise<{ item: LogItemRow; log: LogRow }> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const { log, item } = await fetchLogAndItem(tx, stationId, logId, itemId);
    const check = canMutateItem(item, now);
    if (!check.ok) throw new EditRejectedError(check.reason);

    const [song] = await tx.select().from(songs).where(and(eq(songs.id, songId), eq(songs.stationId, log.stationId)));
    if (!song) throw new EditRejectedError("song_not_found");

    const [updatedItem] = await tx
      .update(logItems)
      .set({ songId: song.id, rdjSongId: song.rdjSongId })
      .where(eq(logItems.id, itemId))
      .returning();

    const updatedLog = await maybeReturnToDraft(tx, log, now);
    return { item: updatedItem, log: updatedLog };
  });
}

export async function applySwap(
  stationId: string,
  logId: string,
  itemIdA: string,
  itemIdB: string
): Promise<{ items: [LogItemRow, LogItemRow]; log: LogRow }> {
  if (itemIdA === itemIdB) throw new EditRejectedError("not_found");
  const now = new Date();
  return db.transaction(async (tx) => {
    const [log] = await tx.select().from(logs).where(and(eq(logs.id, logId), eq(logs.stationId, stationId)));
    if (!log) throw new EditRejectedError("not_found");

    const [itemA] = await tx.select().from(logItems).where(and(eq(logItems.id, itemIdA), eq(logItems.logId, logId)));
    const [itemB] = await tx.select().from(logItems).where(and(eq(logItems.id, itemIdB), eq(logItems.logId, logId)));
    if (!itemA || !itemB) throw new EditRejectedError("not_found");

    const checkA = canMutateItem(itemA, now);
    if (!checkA.ok) throw new EditRejectedError(checkA.reason);
    const checkB = canMutateItem(itemB, now);
    if (!checkB.ok) throw new EditRejectedError(checkB.reason);

    const [updatedA] = await tx
      .update(logItems)
      .set({ songId: itemB.songId, rdjSongId: itemB.rdjSongId })
      .where(eq(logItems.id, itemA.id))
      .returning();
    const [updatedB] = await tx
      .update(logItems)
      .set({ songId: itemA.songId, rdjSongId: itemA.rdjSongId })
      .where(eq(logItems.id, itemB.id))
      .returning();

    const updatedLog = await maybeReturnToDraft(tx, log, now);
    return { items: [updatedA, updatedB], log: updatedLog };
  });
}

export async function setLocked(stationId: string, logId: string, itemId: string, locked: boolean): Promise<{ item: LogItemRow }> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const { item } = await fetchLogAndItem(tx, stationId, logId, itemId);
    // Lock is exempt from the re-approval flip (locking touches no field that
    // affects playback) but still gated by the same boundary — locking an
    // already-pushed or fixed_event item is meaningless and racy for the same
    // reason content edits are.
    const check = canEditItem(item, now);
    if (!check.ok) throw new EditRejectedError(check.reason);

    const [updatedItem] = await tx.update(logItems).set({ locked }).where(eq(logItems.id, itemId)).returning();
    return { item: updatedItem };
  });
}

export async function approveLog(stationId: string, logId: string): Promise<{ log: LogRow }> {
  const [log] = await db.select().from(logs).where(and(eq(logs.id, logId), eq(logs.stationId, stationId)));
  if (!log) throw new EditRejectedError("not_found");
  if (log.status === "approved") return { log };
  const [updated] = await db.update(logs).set({ status: "approved" }).where(eq(logs.id, logId)).returning();
  // Tier 0/1: no as-played feed, so the approved log becomes the separation memory.
  // No-op where the station has real reconciliation. Guarded because losing an approval
  // to a history-write failure would be worse than losing the history.
  try {
    await recordAssumedAirplay(logId);
  } catch (err) {
    console.error(`assumed-airplay write failed for log ${logId}:`, err);
  }
  return { log: updated };
}

// ── Delete and regenerate ─────────────────────────────────────────────────────────────
// Both act on the log's removable span: the whole log, or for an approved log already
// reaching the Runner, only the hours the Runner can't have acted on yet. Hours are the
// unit because generation and clocks are hour-aligned, so a replacement always starts
// on a top of the hour.

const hourCeil = (t: number) => new Date(Math.ceil(t / HOUR_MS) * HOUR_MS);

/**
 * Where the removable span of `log` starts, or null when nothing can go.
 *
 * - A draft never reaches the Runner (logWindow serves approved logs only), so all of
 *   it can go.
 * - An approved log keeps every hour up to the first top of the hour that is past the
 *   safety horizon and past every item already pushed to RadioDJ. A not-yet-airing log
 *   comfortably clear of both goes whole.
 */
export function removableFrom(log: LogRow, items: LogItemRow[], now: Date = new Date()): Date | null {
  if (log.status !== "approved") return log.startsAt;
  let from = Math.max(log.startsAt.getTime(), hourCeil(now.getTime() + SAFETY_HORIZON_MINUTES * 60_000).getTime());
  for (const i of items) {
    if (i.pushedAt != null && i.projectedAirAt) from = Math.max(from, hourCeil(i.projectedAirAt.getTime() + 1).getTime());
  }
  return from < log.endsAt.getTime() ? new Date(from) : null;
}

export interface Removal {
  /** The log removed outright, or truncated to end at `from`. */
  logId: string;
  whole: boolean;
  from: Date;
  to: Date;
  removedItems: number;
  /** Locked items among them: a PD's pick that a regenerate will not carry over. */
  lockedRemoved: number;
}

/** Removes the span in `tx`. `expectFrom` guards a regenerate against the log changing under it. */
async function removeSpan(tx: Tx, stationId: string, logId: string, now: Date, expectFrom?: Date): Promise<Removal> {
  const [log] = await tx
    .select()
    .from(logs)
    .where(and(eq(logs.id, logId), eq(logs.stationId, stationId)))
    .for("update");
  if (!log) throw new EditRejectedError("not_found");
  const items = await tx.select().from(logItems).where(eq(logItems.logId, logId));
  const from = removableFrom(log, items, now);
  if (!from) throw new EditRejectedError("nothing_remaining");
  if (expectFrom && from.getTime() !== expectFrom.getTime()) throw new EditRejectedError("changed");

  const whole = from.getTime() === log.startsAt.getTime();
  const removed = items.filter((i) => whole || (i.projectedAirAt != null && i.projectedAirAt >= from));
  if (whole) {
    await tx.delete(logItems).where(eq(logItems.logId, logId));
    await tx.delete(logs).where(eq(logs.id, logId));
  } else {
    await tx.delete(logItems).where(and(eq(logItems.logId, logId), gte(logItems.projectedAirAt, from)));
    await tx.update(logs).set({ endsAt: from }).where(eq(logs.id, logId));
  }
  // An approved log on an assume-aired station wrote its items into play_history as they
  // were approved. The removed hours will never air, so their rows go too, or they would
  // hold separation against songs that never played. Logs don't overlap, so every
  // assumed row in the span is this log's.
  if (log.status === "approved") {
    await tx
      .delete(playHistory)
      .where(
        and(
          eq(playHistory.stationId, stationId),
          eq(playHistory.source, "assumed"),
          gte(playHistory.airedAt, from),
          lt(playHistory.airedAt, log.endsAt),
        ),
      );
  }
  return {
    logId,
    whole,
    from,
    to: log.endsAt,
    removedItems: removed.length,
    lockedRemoved: removed.filter((i) => i.locked).length,
  };
}

/** Deletes a log, or the remaining hours of an approved one already reaching the Runner. */
export async function deleteLogHours(stationId: string, logId: string, now: Date = new Date()): Promise<Removal> {
  return db.transaction((tx) => removeSpan(tx, stationId, logId, now));
}

/**
 * Replaces a log's removable span with a freshly generated one, in one transaction. The
 * new log is approved when it replaces hours of an airing log, so the station stays on
 * a log across the seam; otherwise it is a draft, as any edit leaves a future log.
 */
export async function regenerateLogHours(
  stationId: string,
  logId: string,
  now: Date = new Date(),
): Promise<{ removal: Removal; generated: GenerateNextHoursResult }> {
  const [log] = await db.select().from(logs).where(and(eq(logs.id, logId), eq(logs.stationId, stationId)));
  if (!log) throw new EditRejectedError("not_found");
  const items = await db.select().from(logItems).where(eq(logItems.logId, logId));
  let from = removableFrom(log, items, now);
  // A draft's past hours are removed with it, but there is no point generating them.
  if (from && log.status !== "approved") {
    const firstFuture = hourCeil(now.getTime());
    if (firstFuture > from) from = firstFuture;
    if (from >= log.endsAt) from = null;
  }
  if (!from) throw new EditRejectedError("nothing_remaining");

  const airing = isLogAiring(log, now);
  const status = airing ? "approved" : "draft";
  let removal: Removal | undefined;
  const generated = await generateSpan(stationId, from, log.endsAt, {
    status,
    clear: async (tx) => {
      removal = await removeSpan(tx, stationId, logId, now, log.status === "approved" ? from! : undefined);
    },
  });
  if (status === "approved") {
    // As approveLog does: guarded, since losing the log to a history-write failure would
    // be worse than losing the history.
    try {
      await recordAssumedAirplay(generated.logId);
    } catch (err) {
      console.error(`assumed-airplay write failed for log ${generated.logId}:`, err);
    }
  }
  return { removal: removal!, generated };
}
