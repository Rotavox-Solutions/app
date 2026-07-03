import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { logItems } from "@rotavox/schema";
import { schedulerDb } from "./scheduler-db.js";
import type { ReconciledRow } from "./reconcile-history.js";

/**
 * Matches one rdj_song_id to the earliest pushed-but-unaired log_item in `logId`
 * and stamps aired_at. Used by both the real-time now-playing watch (pace.ts) and
 * the history-reconciliation backstop below — whichever fires first for a given
 * item wins, since both check `aired_at IS NULL` first; neither can double-write.
 */
export async function matchAndStampAiredAt(logId: string, rdjSongId: number, airedAt: Date): Promise<boolean> {
  const [candidate] = await schedulerDb
    .select({ id: logItems.id })
    .from(logItems)
    .where(
      and(
        eq(logItems.logId, logId),
        eq(logItems.rdjSongId, rdjSongId),
        isNotNull(logItems.pushedAt),
        isNull(logItems.airedAt)
      )
    )
    .orderBy(asc(logItems.sortOrder))
    .limit(1);
  if (!candidate) return false; // no planned counterpart (e.g. a filler repeat) — expected, not an error
  await schedulerDb.update(logItems).set({ airedAt }).where(eq(logItems.id, candidate.id));
  return true;
}

/**
 * §7 backstop: for each newly-reconciled history row (chronological), match it via
 * matchAndStampAiredAt. Sequential (not batched) so repeated songs in one batch
 * match distinct log_items in order — correct because RadioDJ plays its queue FIFO
 * and the Runner is the only writer, so chronological history order matches push
 * order. This is now secondary to the real-time now-playing watch (which also
 * catches sweepers/imaging that RadioDJ's `history` table doesn't log at all) —
 * kept for when the pace loop was down and reconciliation is catching up.
 */
export async function backfillAiredAt(logId: string, reconciled: ReconciledRow[]): Promise<number> {
  let updated = 0;
  for (const row of reconciled) {
    if (await matchAndStampAiredAt(logId, row.rdjSongId, row.airedAt)) updated++;
  }
  return updated;
}
