// Turning a saved revision back into an editor draft, and saying how it differs from the
// clock as it stands. Pure and client-safe: it only imports types from @rotavox/schema.
import type { ClockDraft, ClockPositionDraft, ClockSnapshot } from "@rotavox/schema";

let nextKey = 0;

/**
 * A revision as an unsaved draft. Position n reuses the current clock's position n id, so
 * approved logs stay linked by position number (as the seeds always matched them); extra
 * positions are new, and current ones past the end are removed when it's saved.
 */
export function draftFromSnapshot(snapshot: ClockSnapshot, current: ClockDraft): ClockDraft {
  const keys = snapshot.positions.map((_, i) => current.positions[i]?.id ?? `restored-${Date.now()}-${nextKey++}`);
  return {
    name: snapshot.name,
    lengthMinutes: snapshot.lengthMinutes,
    notes: snapshot.notes,
    positions: snapshot.positions.map(
      (p, i): ClockPositionDraft => ({
        id: current.positions[i]?.id ?? null,
        key: keys[i],
        kind: p.kind,
        categoryId: p.categoryId,
        fallbackCategoryId: p.fallbackCategoryId,
        targetOffsetSeconds: p.targetOffsetSeconds,
        fillerPriority: p.fillerPriority,
        trimPriority: p.trimPriority,
        anchorKey: p.anchorPosition != null ? keys[p.anchorPosition - 1] ?? null : null,
        fixedDurationSeconds: p.fixedDurationSeconds,
        fixedRef: p.fixedRef,
        extra: p.extra ?? {},
      })
    ),
  };
}

/** What a position does, ignoring identity, for comparing two versions position by position. */
function shape(p: ClockPositionDraft, positions: ClockPositionDraft[]) {
  const anchor = p.anchorKey ? positions.findIndex((q) => q.key === p.anchorKey) + 1 : null;
  return JSON.stringify([
    p.kind,
    p.categoryId,
    p.fallbackCategoryId,
    p.targetOffsetSeconds,
    p.fillerPriority,
    p.trimPriority,
    anchor,
    p.fixedDurationSeconds,
    p.fixedRef,
    p.extra ?? {},
  ]);
}

/** Positions that differ, by number, plus a renamed clock or a changed length. */
export function describeDifference(a: ClockDraft, b: ClockDraft): string {
  if (!a.positions || !b.positions) return "";
  const parts: string[] = [];
  if (a.name !== b.name) parts.push(`named ${a.name}`);
  if (a.lengthMinutes !== b.lengthMinutes) parts.push(`${a.lengthMinutes} min long`);
  const n = Math.max(a.positions.length, b.positions.length);
  let changed = 0;
  for (let i = 0; i < n; i++) {
    const pa = a.positions[i];
    const pb = b.positions[i];
    if (!pa || !pb || shape(pa, a.positions) !== shape(pb, b.positions)) changed++;
  }
  if (a.positions.length !== b.positions.length) parts.push(`${a.positions.length} positions, not ${b.positions.length}`);
  if (changed) parts.push(`${changed} ${changed === 1 ? "position differs" : "positions differ"}`);
  return parts.length ? parts.join(" · ") : "same as now";
}
