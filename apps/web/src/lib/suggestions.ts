// Loads what the standing lifecycle rules read (each pool's settings, each song's state,
// time in pool and last airplay) and runs @rotavox/schema's suggestMoves. Suggestions
// only: the PD stages the ones they want (ADR-0002 §3).
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import {
  categories,
  getDraft,
  lifecycleSuggestionDismissals,
  playHistory,
  songCategories,
  songs,
  stations,
  suggestMoves,
  utcTimestamp,
  type Placement,
  type RulePool,
  type SuggestionRule,
} from "@rotavox/schema";
import { db } from "./db";
import { poolEntryRows } from "./direction";

export interface SuggestionRow {
  songId: string;
  artist: string | null;
  title: string | null;
  rule: SuggestionRule;
  from: Placement;
  to: Placement;
  why: string;
  /** Already in the draft. */
  staged: boolean;
}

export interface SuggestionReport {
  imported: boolean;
  rows: SuggestionRow[];
  /** Hidden because the PD set them aside for now. */
  dismissed: number;
}

export async function getSuggestions(stationId: string, now: Date = new Date()): Promise<SuggestionReport> {
  const [station] = await db.select({ imported: stations.membershipImportedAt }).from(stations).where(eq(stations.id, stationId));
  if (!station?.imported) return { imported: false, rows: [], dismissed: 0 };

  const [pools, songRows] = await Promise.all([
    db
      .select({
        id: categories.id,
        name: categories.name,
        ladderRank: categories.ladderRank,
        fallingAfterDays: categories.fallingAfterDays,
        restReviewDays: categories.restReviewDays,
        restExitCategoryId: categories.restExitCategoryId,
        promoteAfterDays: categories.promoteAfterDays,
        promoteToCategoryId: categories.promoteToCategoryId,
        benchAfterUnairedDays: categories.benchAfterUnairedDays,
      })
      .from(categories)
      .where(eq(categories.stationId, stationId)) as Promise<RulePool[]>,
    db
      .select({
        id: songs.id,
        artist: songs.artist,
        title: songs.title,
        state: songs.lifecycleState,
        since: songs.lifecycleSince,
        poolId: songCategories.categoryId,
      })
      .from(songs)
      .innerJoin(songCategories, and(eq(songCategories.songId, songs.id), eq(songCategories.role, "primary")))
      .where(and(eq(songs.stationId, stationId), sql`${songs.rdjSongId} > 0`, inArray(songs.lifecycleState, ["active", "resting"]))),
  ]);
  const poolById = new Map(pools.map((p) => [p.id, p]));
  // Only songs in a pool with a rule set can be suggested; skip the queries otherwise.
  const ruled = songRows.filter((s) => {
    const p = poolById.get(s.poolId);
    if (!p) return false;
    return s.state === "resting"
      ? p.restReviewDays != null
      : p.benchAfterUnairedDays != null || p.fallingAfterDays != null || (p.promoteAfterDays != null && !!p.promoteToCategoryId);
  });
  if (ruled.length === 0) return { imported: true, rows: [], dismissed: 0 };

  const ids = ruled.map((s) => s.id);
  const [entries, aired, dismissals, draft] = await Promise.all([
    poolEntryRows(stationId, ruled.filter((s) => s.state === "active").map((s) => s.id)),
    db
      .select({ songId: playHistory.songId, last: sql<string>`max(${playHistory.airedAt})` })
      .from(playHistory)
      .where(and(eq(playHistory.stationId, stationId), inArray(playHistory.songId, ids)))
      .groupBy(playHistory.songId),
    db
      .select({ songId: lifecycleSuggestionDismissals.songId, rule: lifecycleSuggestionDismissals.rule })
      .from(lifecycleSuggestionDismissals)
      .where(and(eq(lifecycleSuggestionDismissals.stationId, stationId), gt(lifecycleSuggestionDismissals.until, now))),
    getDraft(db, stationId),
  ]);
  // Raw aggregates bypass drizzle's column mapping and come back naive — UTC by convention.
  const lastAired = new Map(aired.map((a) => [a.songId, a.last ? utcTimestamp(a.last) : null]));
  const dismissedKeys = new Set(dismissals.map((d) => `${d.songId}|${d.rule}`));
  const staged = new Set((draft?.items ?? []).map((i) => i.songId));

  const suggestions = suggestMoves(
    ruled.map((s) => {
      const e = entries.get(s.id);
      return {
        id: s.id,
        state: s.state,
        since: s.since,
        poolId: s.poolId,
        entry: e ? { at: e.at, from: e.fromCategoryId ? poolById.get(e.fromCategoryId) ?? null : null, known: e.source !== "import" } : null,
        lastAiredAt: lastAired.get(s.id) ?? null,
      };
    }),
    pools,
    now
  );
  const songById = new Map(ruled.map((s) => [s.id, s]));
  const visible = suggestions.filter((s) => !dismissedKeys.has(`${s.songId}|${s.rule}`));
  return {
    imported: true,
    dismissed: suggestions.length - visible.length,
    rows: visible
      .map((s) => {
        const song = songById.get(s.songId)!;
        return {
          songId: s.songId,
          artist: song.artist,
          title: song.title,
          rule: s.rule,
          from: { state: song.state as Placement["state"], categoryId: song.poolId },
          to: s.to,
          why: s.why,
          staged: staged.has(s.songId),
        };
      })
      .sort((a, b) => a.rule.localeCompare(b.rule) || (a.artist ?? "").localeCompare(b.artist ?? "")),
  };
}

export const DISMISS_DAYS = 30;

/** Sets a suggestion aside for a while; it comes back if the rule still applies then. */
export async function dismissSuggestion(
  stationId: string,
  songId: string,
  rule: SuggestionRule,
  userId: string | null,
  now: Date = new Date()
): Promise<void> {
  const [song] = await db.select({ id: songs.id }).from(songs).where(and(eq(songs.stationId, stationId), eq(songs.id, songId)));
  if (!song) throw new Error("not_found");
  const until = new Date(now.getTime() + DISMISS_DAYS * 86_400_000);
  await db
    .insert(lifecycleSuggestionDismissals)
    .values({ stationId, songId, rule, until, dismissedBy: userId, dismissedAt: now })
    .onConflictDoUpdate({
      target: [lifecycleSuggestionDismissals.songId, lifecycleSuggestionDismissals.rule],
      set: { until, dismissedBy: userId, dismissedAt: now },
    });
}
