import { api } from "./scheduler.js";
import type { ReconciledRow } from "./reconcile-history.js";

/**
 * Matches one rdj_song_id to the earliest pushed-but-unaired log_item in `logId`
 * and stamps aired_at. Used by both the real-time now-playing watch (pace.ts) and
 * the history-reconciliation backstop below — whichever fires first for a given
 * item wins, since both check `aired_at IS NULL` first; neither can double-write.
 */
export async function matchAndStampAiredAt(logId: string, rdjSongId: number, airedAt: Date): Promise<boolean> {
  return api("stampAired", { logId, rdjSongId, airedAt });
}

/**
 * §7 backstop: for each newly-reconciled history row (chronological), match it via
 * the same stamp. Sequential (not batched) so repeated songs in one batch match
 * distinct log_items in order — correct because RadioDJ plays its queue FIFO and the
 * Runner is the only writer, so chronological history order matches push order. This
 * is now secondary to the real-time now-playing watch (which also catches
 * sweepers/imaging that RadioDJ's `history` table doesn't log at all) — kept for when
 * the pace loop was down and reconciliation is catching up. One call per batch; the
 * server matches the rows in order.
 */
export async function backfillAiredAt(logId: string, reconciled: ReconciledRow[]): Promise<number> {
  if (reconciled.length === 0) return 0;
  const { updated } = await api("backfillAired", { logId, rows: reconciled });
  return updated;
}
