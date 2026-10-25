// Turns a changeset applied in Rotavox into a v1 file changeset for RadioDJ — pure, so the
// translation is testable without either database. The RadioDJ write itself goes through
// apply-changeset's validated path, preconditions and inverse included.
import {
  subcatForPlacement,
  type LifecycleSubcatMap,
  type PendingProjection,
  type ProjectedCategory,
} from "@rotavox/schema";
import type { Changeset, Move } from "./changeset.js";

export interface ProjectionPlan {
  /** Null when every song is already in a subcategory that means its new placement. */
  changeset: Changeset | null;
  /** Songs that can't be written: no subcategory last seen in the mirror, or no subcategory for the target. */
  errors: string[];
}

export function fileIdFor(p: { id: string; appliedAt: Date | null }): string {
  const day = (p.appliedAt ?? new Date()).toISOString().slice(0, 10);
  return `${day}-rotavox-${p.id.slice(0, 8)}`;
}

export function planProjection(
  p: PendingProjection,
  stationId: string,
  cats: ProjectedCategory[],
  lifecycle: LifecycleSubcatMap | null
): ProjectionPlan {
  const errors: string[] = [];
  const moves: Move[] = [];
  for (const item of p.items) {
    const label = `${item.artist ?? "?"} — ${item.title ?? "?"} (rdj ${item.rdjSongId})`;
    // The precondition is what the mirror last saw in RadioDJ. If RadioDJ has moved on,
    // apply-changeset's live check catches it: someone edited RadioDJ directly, and that
    // needs a person, not an overwrite.
    const from = p.mirrorSubcat.get(item.songId) ?? null;
    if (from == null) {
      errors.push(`${label}: the mirror has no RadioDJ subcategory for this song — run sync-library`);
      continue;
    }
    let to: number;
    try {
      to = item.toRdjSubcat ?? subcatForPlacement(item.to, from, cats, lifecycle);
    } catch (err) {
      errors.push(`${label}: ${(err as Error).message}`);
      continue;
    }
    if (to === from) continue;
    moves.push({
      rdj_song_id: item.rdjSongId,
      artist: item.artist ?? "",
      title: item.title ?? "",
      from_subcat: from,
      to_subcat: to,
      reason: item.reason ?? p.intent ?? "applied in Rotavox",
    });
  }
  if (moves.length === 0) return { changeset: null, errors };
  return {
    changeset: {
      changeset_version: 1,
      id: fileIdFor(p),
      station_id: stationId,
      authored_at: (p.appliedAt ?? new Date()).toISOString().slice(0, 10),
      intent: p.intent ?? "applied in Rotavox",
      basis: { sheet_id: `rotavox:${p.id}`, sheet_captured_at: p.appliedAt?.toISOString() },
      moves,
    },
    errors,
  };
}
