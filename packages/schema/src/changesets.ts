// UI-authored changesets (ADR-0002 §2.3) — the one write path for pool membership and
// lifecycle state once a station is imported. Every edit stages into the station's single
// draft; applying it re-checks each item's precondition and writes the placements in one
// transaction. Undo is a new changeset, never a rewrite of history.
//
// Shared by the web app (authoring) and the Runner (projection to RadioDJ).
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { categories, changesetItems, changesets, songCategories, songs, stations } from "./schema.js";
import {
  applyPlacements,
  LIFECYCLE_STATES,
  placementForSubcat,
  type LifecycleState,
  type LifecycleSubcatMap,
  type Placement,
  type PlacementChange,
  type ProjectedCategory,
} from "./membership.js";

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type ChangesetErrorCode =
  | "not_imported" // membership is still derived from RadioDJ; an edit would be overwritten
  | "invalid"
  | "not_found"
  | "no_draft"
  | "empty"
  | "intent_required"
  | "conflict" // a song changed since it was staged
  | "draft_exists" // undo needs the draft slot
  | "not_applied"
  | "already_reverted";

export class ChangesetError extends Error {
  constructor(
    public code: ChangesetErrorCode,
    message: string,
    public conflicts: ChangesetConflict[] = []
  ) {
    super(message);
  }
}

export interface ChangesetConflict {
  songId: string;
  artist: string | null;
  title: string | null;
  expected: Placement;
  actual: Placement;
}

export interface StageRequest {
  songId: string;
  to: Placement;
  /** Optional per song; the changeset's intent stands in for an item without one. */
  reason?: string | null;
}

export interface ChangesetItemRow {
  id: string;
  songId: string;
  rdjSongId: number;
  artist: string | null;
  title: string | null;
  from: Placement;
  to: Placement;
  reason: string | null;
  fromRdjSubcat: number | null;
  /** Set on an undo: the RadioDJ subcategory to restore exactly. */
  toRdjSubcat: number | null;
}

export interface ChangesetRow {
  id: string;
  status: string;
  intent: string | null;
  revertsChangesetId: string | null;
  createdAt: Date;
  appliedAt: Date | null;
  projection: string | null;
  projectedAt: Date | null;
  projectionError: string | null;
}

export interface ChangesetWithItems extends ChangesetRow {
  items: ChangesetItemRow[];
}

const samePlacement = (a: Placement, b: Placement) => a.state === b.state && a.categoryId === b.categoryId;

/** Benched and retired songs are out of the format, so they never carry a pool. */
function normalizeTarget(to: Placement): Placement {
  return to.state === "benched" || to.state === "retired" ? { state: to.state, categoryId: null } : to;
}

async function requireImported(tx: Tx, stationId: string) {
  const [station] = await tx.select().from(stations).where(eq(stations.id, stationId));
  if (!station) throw new ChangesetError("not_found", `station ${stationId} not found`);
  if (!station.membershipImportedAt) {
    throw new ChangesetError(
      "not_imported",
      "Pools for this station still come from RadioDJ. Import them on the Station page before editing them here."
    );
  }
  return station;
}

/** Current placement of each song: its lifecycle state and primary pool. */
async function currentPlacements(tx: Tx, stationId: string, songIds: string[]) {
  type Current = Placement & { artist: string | null; title: string | null; rdjSubcat: number | null };
  if (songIds.length === 0) return new Map<string, Current>();
  const rows = await tx
    .select({
      id: songs.id,
      state: songs.lifecycleState,
      artist: songs.artist,
      title: songs.title,
      rdjSubcat: songs.rdjSubcategoryId,
      categoryId: songCategories.categoryId,
    })
    .from(songs)
    .leftJoin(songCategories, and(eq(songCategories.songId, songs.id), eq(songCategories.role, "primary")))
    .where(and(eq(songs.stationId, stationId), inArray(songs.id, songIds)));
  return new Map(
    rows.map((r) => [
      r.id,
      {
        state: r.state as LifecycleState,
        categoryId: r.categoryId ?? null,
        artist: r.artist,
        title: r.title,
        rdjSubcat: r.rdjSubcat,
      } as Current,
    ])
  );
}

async function loadItems(tx: Tx | Db, changesetId: string): Promise<ChangesetItemRow[]> {
  const rows = await tx
    .select({
      id: changesetItems.id,
      songId: changesetItems.songId,
      rdjSongId: songs.rdjSongId,
      artist: songs.artist,
      title: songs.title,
      fromState: changesetItems.fromState,
      fromCategoryId: changesetItems.fromCategoryId,
      toState: changesetItems.toState,
      toCategoryId: changesetItems.toCategoryId,
      reason: changesetItems.reason,
      fromRdjSubcat: changesetItems.fromRdjSubcat,
      toRdjSubcat: changesetItems.toRdjSubcat,
    })
    .from(changesetItems)
    .innerJoin(songs, eq(songs.id, changesetItems.songId))
    .where(eq(changesetItems.changesetId, changesetId))
    .orderBy(asc(songs.artist), asc(songs.title));
  return rows.map((r) => ({
    id: r.id,
    songId: r.songId,
    rdjSongId: r.rdjSongId,
    artist: r.artist,
    title: r.title,
    from: { state: r.fromState as LifecycleState, categoryId: r.fromCategoryId },
    to: { state: r.toState as LifecycleState, categoryId: r.toCategoryId },
    reason: r.reason,
    fromRdjSubcat: r.fromRdjSubcat,
    toRdjSubcat: r.toRdjSubcat,
  }));
}

async function findDraft(tx: Tx | Db, stationId: string) {
  const [draft] = await tx
    .select()
    .from(changesets)
    .where(and(eq(changesets.stationId, stationId), eq(changesets.status, "draft")));
  return draft ?? null;
}

async function draftForUpdate(tx: Tx, stationId: string) {
  // FOR UPDATE: two tabs applying at once must not both pass the precondition check.
  const [draft] = await tx
    .select()
    .from(changesets)
    .where(and(eq(changesets.stationId, stationId), eq(changesets.status, "draft")))
    .for("update");
  return draft ?? null;
}

export async function getDraft(db: Db, stationId: string): Promise<ChangesetWithItems | null> {
  const draft = await findDraft(db, stationId);
  return draft ? { ...draft, items: await loadItems(db, draft.id) } : null;
}

export async function getChangeset(db: Db, stationId: string, id: string): Promise<ChangesetWithItems | null> {
  const [cs] = await db
    .select()
    .from(changesets)
    .where(and(eq(changesets.stationId, stationId), eq(changesets.id, id)));
  return cs ? { ...cs, items: await loadItems(db, cs.id) } : null;
}

export interface ChangesetSummary extends ChangesetRow {
  itemCount: number;
  /** The changeset that undid this one, if any. */
  revertedById: string | null;
  appliedByName: string | null;
}

export async function listAppliedChangesets(db: Db, stationId: string, limit = 50): Promise<ChangesetSummary[]> {
  // Outer columns spelled out: in a one-table select drizzle renders ${changesets.id} as a
  // bare "id", which inside these subqueries would bind to the inner table instead.
  const undo = sql<string | null>`(
    SELECT u.id FROM changesets u WHERE u.reverts_changeset_id = changesets.id AND u.status = 'applied' LIMIT 1
  )`;
  const rows = await db
    .select({
      id: changesets.id,
      status: changesets.status,
      intent: changesets.intent,
      revertsChangesetId: changesets.revertsChangesetId,
      createdAt: changesets.createdAt,
      appliedAt: changesets.appliedAt,
      projection: changesets.projection,
      projectedAt: changesets.projectedAt,
      projectionError: changesets.projectionError,
      itemCount: sql<number>`(SELECT count(*) FROM changeset_items i WHERE i.changeset_id = changesets.id)`,
      revertedById: undo,
      appliedByName: sql<string | null>`(SELECT u.name FROM users u WHERE u.id = changesets.applied_by)`,
    })
    .from(changesets)
    .where(and(eq(changesets.stationId, stationId), eq(changesets.status, "applied")))
    .orderBy(desc(changesets.appliedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, itemCount: Number(r.itemCount) }));
}

/**
 * Stages placement changes into the station's draft, creating it if needed. Restaging a
 * song replaces its target but keeps the precondition captured the first time; staging a
 * song back to where it already is removes it from the draft.
 */
export async function stageChanges(db: Db, stationId: string, requests: StageRequest[]): Promise<ChangesetWithItems> {
  return db.transaction(async (tx) => {
    await requireImported(tx, stationId);
    if (requests.length === 0) throw new ChangesetError("invalid", "nothing to stage");
    if (new Set(requests.map((r) => r.songId)).size !== requests.length) {
      throw new ChangesetError("invalid", "a song appears twice in one request");
    }

    const catIds = [...new Set(requests.map((r) => r.to.categoryId).filter((c): c is string => !!c))];
    const knownCats = catIds.length
      ? new Set(
          (
            await tx
              .select({ id: categories.id })
              .from(categories)
              .where(and(eq(categories.stationId, stationId), inArray(categories.id, catIds)))
          ).map((c) => c.id)
        )
      : new Set<string>();
    for (const r of requests) {
      if (!LIFECYCLE_STATES.includes(r.to.state)) throw new ChangesetError("invalid", `unknown state "${r.to.state}"`);
      if (r.to.state === "active" && !r.to.categoryId) {
        throw new ChangesetError("invalid", "an active song needs a pool");
      }
      if (r.to.categoryId && !knownCats.has(r.to.categoryId)) {
        throw new ChangesetError("invalid", `category ${r.to.categoryId} is not in this station`);
      }
    }

    const current = await currentPlacements(tx, stationId, requests.map((r) => r.songId));
    for (const r of requests) {
      if (!current.has(r.songId)) throw new ChangesetError("invalid", `song ${r.songId} is not in this station`);
    }

    let draft = await draftForUpdate(tx, stationId);
    if (!draft) {
      [draft] = await tx.insert(changesets).values({ stationId }).returning();
    }
    const existing = new Map(
      (
        await tx
          .select()
          .from(changesetItems)
          .where(and(eq(changesetItems.changesetId, draft.id), inArray(changesetItems.songId, requests.map((r) => r.songId))))
      ).map((i) => [i.songId, i])
    );

    for (const r of requests) {
      const to = normalizeTarget(r.to);
      const prior = existing.get(r.songId);
      const from: Placement = prior
        ? { state: prior.fromState as LifecycleState, categoryId: prior.fromCategoryId }
        : { state: current.get(r.songId)!.state, categoryId: current.get(r.songId)!.categoryId };
      const reason = r.reason?.trim() || null;
      if (samePlacement(from, to)) {
        if (prior) await tx.delete(changesetItems).where(eq(changesetItems.id, prior.id));
        continue;
      }
      if (prior) {
        await tx
          .update(changesetItems)
          .set({ toState: to.state, toCategoryId: to.categoryId, reason: r.reason === undefined ? prior.reason : reason })
          .where(eq(changesetItems.id, prior.id));
      } else {
        await tx.insert(changesetItems).values({
          stationId,
          changesetId: draft.id,
          songId: r.songId,
          fromState: from.state,
          fromCategoryId: from.categoryId,
          toState: to.state,
          toCategoryId: to.categoryId,
          reason,
          fromRdjSubcat: current.get(r.songId)!.rdjSubcat,
        });
      }
    }
    return { ...draft, items: await loadItems(tx, draft.id) };
  });
}

export async function unstage(db: Db, stationId: string, songIds: string[]): Promise<void> {
  const draft = await findDraft(db, stationId);
  if (!draft || songIds.length === 0) return;
  await db
    .delete(changesetItems)
    .where(and(eq(changesetItems.changesetId, draft.id), inArray(changesetItems.songId, songIds)));
}

export async function setDraftIntent(db: Db, stationId: string, intent: string): Promise<void> {
  const draft = await findDraft(db, stationId);
  if (!draft) throw new ChangesetError("no_draft", "there is no draft");
  await db.update(changesets).set({ intent: intent.trim() || null }).where(eq(changesets.id, draft.id));
}

export async function discardDraft(db: Db, stationId: string): Promise<void> {
  await db
    .update(changesets)
    .set({ status: "discarded" })
    .where(and(eq(changesets.stationId, stationId), eq(changesets.status, "draft")));
}

/** Whether applied changesets for this station have a playout library to reach. */
async function projects(tx: Tx, stationId: string): Promise<boolean> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)` })
    .from(categories)
    .where(and(eq(categories.stationId, stationId), sql`cardinality(${categories.rdjSubcategoryIds}) > 0`));
  return Number(row.n) > 0;
}

/**
 * Applies the draft. Every item's precondition is re-checked first; any mismatch aborts
 * the whole changeset, because the review it got was against a library that no longer
 * exists (CHANGESET-CONTRACT §5).
 */
export async function applyDraft(
  db: Db,
  stationId: string,
  opts: { intent?: string; at?: Date; appliedBy?: string | null } = {}
): Promise<{ changesetId: string; changed: number }> {
  const at = opts.at ?? new Date();
  return db.transaction(async (tx) => {
    await requireImported(tx, stationId);
    const draft = await draftForUpdate(tx, stationId);
    if (!draft) throw new ChangesetError("no_draft", "there is no draft to apply");
    const intent = (opts.intent ?? draft.intent ?? "").trim();
    if (!intent) throw new ChangesetError("intent_required", "say why: a changeset needs an intent to apply");
    const items = await loadItems(tx, draft.id);
    if (items.length === 0) throw new ChangesetError("empty", "the draft has no changes");

    const current = await currentPlacements(tx, stationId, items.map((i) => i.songId));
    const conflicts: ChangesetConflict[] = [];
    for (const i of items) {
      const now = current.get(i.songId)!;
      const actual = { state: now.state, categoryId: now.categoryId };
      if (!samePlacement(actual, i.from)) {
        conflicts.push({ songId: i.songId, artist: i.artist, title: i.title, expected: i.from, actual });
      }
    }
    if (conflicts.length) {
      throw new ChangesetError(
        "conflict",
        `${conflicts.length} song(s) changed since they were staged. Restage them, then apply.`,
        conflicts
      );
    }

    const changes: PlacementChange[] = items.map((i) => ({
      songId: i.songId,
      placement: i.to,
      reason: i.reason ?? intent,
      source: "changeset",
      sourceRef: draft.id,
    }));
    const changed = await applyPlacements(tx, stationId, changes, at);
    await tx
      .update(changesets)
      .set({ status: "applied", intent, appliedAt: at, appliedBy: opts.appliedBy ?? null, projection: (await projects(tx, stationId)) ? "pending" : null })
      .where(eq(changesets.id, draft.id));
    return { changesetId: draft.id, changed };
  });
}

/**
 * Drafts the undo of an applied changeset: every song back to where it was. It is a
 * draft, not an immediate write, so the undo gets the same review and precondition check
 * as anything else — a song moved again since cannot be silently yanked back.
 */
export async function draftRevert(db: Db, stationId: string, changesetId: string): Promise<ChangesetWithItems> {
  return db.transaction(async (tx) => {
    await requireImported(tx, stationId);
    const [target] = await tx
      .select()
      .from(changesets)
      .where(and(eq(changesets.stationId, stationId), eq(changesets.id, changesetId)));
    if (!target) throw new ChangesetError("not_found", "changeset not found");
    if (target.status !== "applied") throw new ChangesetError("not_applied", "only an applied changeset can be undone");
    const [undo] = await tx
      .select({ id: changesets.id })
      .from(changesets)
      .where(and(eq(changesets.revertsChangesetId, changesetId), ne(changesets.status, "discarded")));
    if (undo) throw new ChangesetError("already_reverted", "this changeset already has an undo");

    const draft = await draftForUpdate(tx, stationId);
    if (draft) {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(changesetItems)
        .where(eq(changesetItems.changesetId, draft.id));
      if (Number(n) > 0) {
        throw new ChangesetError("draft_exists", "apply or discard the current draft before undoing a changeset");
      }
      await tx.delete(changesets).where(eq(changesets.id, draft.id));
    }

    const items = await loadItems(tx, changesetId);
    const mirror = await currentPlacements(tx, stationId, items.map((i) => i.songId));
    const when = target.appliedAt ? target.appliedAt.toISOString().slice(0, 10) : "";
    const [created] = await tx
      .insert(changesets)
      .values({ stationId, revertsChangesetId: changesetId, intent: `Undo ${when}: ${target.intent ?? ""}`.trim() })
      .returning();
    if (items.length) {
      // The precondition is the state the original left each song in. If a song moved
      // again since, applying the undo reports it rather than overwriting the later move.
      await tx.insert(changesetItems).values(
        items.map((i) => ({
          stationId,
          changesetId: created.id,
          songId: i.songId,
          fromState: i.to.state,
          fromCategoryId: i.to.categoryId,
          toState: i.from.state,
          toCategoryId: i.from.categoryId,
          reason: `Undo: ${i.reason ?? target.intent ?? ""}`.trim(),
          fromRdjSubcat: mirror.get(i.songId)?.rdjSubcat ?? null,
          // Restore RadioDJ to exactly where it was. "Active with no pool" has no
          // subcategory of its own, and a bench could have been W or Y.
          toRdjSubcat: i.fromRdjSubcat,
        }))
      );
    }
    return { ...created, items: await loadItems(tx, created.id) };
  });
}

// --------------------------------------------------------------------- projection

/**
 * The RadioDJ subcategory that expresses a placement — the inverse of
 * `placementForSubcat`. A song whose current subcategory already means the target
 * placement stays put, which keeps multi-subcategory pools and equivalent bench
 * subcategories (W, Y) from churning.
 */
export function subcatForPlacement(
  target: Placement,
  currentSubcat: number | null,
  cats: ProjectedCategory[],
  lifecycle: LifecycleSubcatMap | null
): number {
  if (currentSubcat != null && samePlacement(placementForSubcat(currentSubcat, cats, lifecycle, target.categoryId), target)) {
    // A generic rest subcategory reads back as "resting from the current pool", which the
    // check above passes for any pool; only accept it when no pool-specific one exists.
    const rule = lifecycle?.[String(currentSubcat)];
    const specific = target.state === "resting" && !rule?.origin && restingRuleFor(target, cats, lifecycle, true) != null;
    if (!specific) return currentSubcat;
  }
  const category = target.categoryId ? cats.find((c) => c.id === target.categoryId) : undefined;
  if (target.state === "active") {
    if (!category) throw new Error("an active song with no pool has no RadioDJ subcategory");
    const id = category.rdjSubcategoryIds?.[0];
    if (id == null) throw new Error(`category ${category.name} has no RadioDJ subcategory to project to`);
    return id;
  }
  if (target.state === "resting") {
    const id = restingRuleFor(target, cats, lifecycle, false);
    if (id == null) throw new Error(`no RadioDJ subcategory encodes resting${category ? ` from ${category.name}` : ""}`);
    return id;
  }
  const candidates = Object.entries(lifecycle ?? {}).filter(([, r]) => r.state === target.state);
  const chosen = candidates.length > 1 ? candidates.filter(([, r]) => r.default) : candidates;
  if (chosen.length !== 1) {
    throw new Error(
      candidates.length === 0
        ? `no RadioDJ subcategory encodes ${target.state}`
        : `several RadioDJ subcategories encode ${target.state}; mark exactly one "default": true in rdj_lifecycle_subcats`
    );
  }
  return Number(chosen[0][0]);
}

function restingRuleFor(
  target: Placement,
  cats: ProjectedCategory[],
  lifecycle: LifecycleSubcatMap | null,
  specificOnly: boolean
): number | null {
  const name = target.categoryId ? cats.find((c) => c.id === target.categoryId)?.name : undefined;
  const rules = Object.entries(lifecycle ?? {}).filter(([, r]) => r.state === "resting");
  const specific = name ? rules.find(([, r]) => r.origin === name) : undefined;
  if (specific) return Number(specific[0]);
  if (specificOnly) return null;
  const generic = rules.filter(([, r]) => !r.origin);
  return generic.length === 1 ? Number(generic[0][0]) : null;
}

export interface PendingProjection extends ChangesetWithItems {
  /** The mirror's RadioDJ subcategory for each song, as of the last library sync. */
  mirrorSubcat: Map<string, number | null>;
}

/** Applied changesets not yet written to RadioDJ, oldest first — the order they must land in. */
export async function listPendingProjections(db: Db, stationId: string): Promise<PendingProjection[]> {
  const rows = await db
    .select()
    .from(changesets)
    .where(
      and(
        eq(changesets.stationId, stationId),
        eq(changesets.status, "applied"),
        inArray(changesets.projection, ["pending", "failed"])
      )
    )
    .orderBy(asc(changesets.appliedAt));
  const out: PendingProjection[] = [];
  for (const cs of rows) {
    const items = await loadItems(db, cs.id);
    const subcats = items.length
      ? await db
          .select({ id: songs.id, subcat: songs.rdjSubcategoryId })
          .from(songs)
          .where(inArray(songs.id, items.map((i) => i.songId)))
      : [];
    out.push({ ...cs, items, mirrorSubcat: new Map(subcats.map((s) => [s.id, s.subcat])) });
  }
  return out;
}

export async function markProjection(
  db: Db,
  changesetId: string,
  result: { ok: true; at?: Date } | { ok: false; error: string }
): Promise<void> {
  await db
    .update(changesets)
    .set(
      result.ok
        ? { projection: "projected", projectedAt: result.at ?? new Date(), projectionError: null }
        : { projection: "failed", projectionError: result.error }
    )
    .where(eq(changesets.id, changesetId));
}

/** Puts a failed projection back in line, for the Runner to try again. */
export async function retryProjection(db: Db, stationId: string, changesetId: string): Promise<void> {
  const rows = await db
    .update(changesets)
    .set({ projection: "pending", projectionError: null })
    .where(and(eq(changesets.stationId, stationId), eq(changesets.id, changesetId), eq(changesets.projection, "failed")))
    .returning({ id: changesets.id });
  if (rows.length === 0) throw new ChangesetError("not_found", "no failed projection to retry for that changeset");
}

/**
 * The projection state of the oldest applied changeset not yet in RadioDJ. 'failed' at
 * the head blocks the queue until someone retries it; later changes may build on it.
 */
export async function nextProjectionStatus(db: Db, stationId: string): Promise<"pending" | "failed" | null> {
  const [row] = await db
    .select({ projection: changesets.projection })
    .from(changesets)
    .where(
      and(
        eq(changesets.stationId, stationId),
        eq(changesets.status, "applied"),
        inArray(changesets.projection, ["pending", "failed"])
      )
    )
    .orderBy(asc(changesets.appliedAt))
    .limit(1);
  return (row?.projection as "pending" | "failed" | undefined) ?? null;
}

// ------------------------------------------------------------------------ drift

export interface DriftRow {
  songId: string;
  rdjSongId: number;
  artist: string | null;
  title: string | null;
  /** Where Rotavox has it. */
  rotavox: Placement;
  /** RadioDJ's subcategory as of the last library sync, and what that means in Rotavox terms. */
  rdjSubcat: number;
  /** Its name in RadioDJ, as last synced. */
  rdjSubcatName: string | null;
  radiodj: Placement;
  /** RadioDJ's filing can be adopted as a change. Not when it means "active with no pool". */
  canAccept: boolean;
  /** Rotavox's placement has a RadioDJ subcategory to be written back to. */
  canReproject: boolean;
  /** In the current draft already. */
  staged: boolean;
}

export interface DriftReport {
  imported: boolean;
  projects: boolean;
  rows: DriftRow[];
  /** Songs left out because a write to RadioDJ is still on its way, so they would read as drift. */
  awaitingProjection: number;
}

/**
 * Songs whose RadioDJ subcategory, as of the last library sync, disagrees with where
 * Rotavox has them: someone changed RadioDJ directly (ADR-0002 §4.4). Compared as
 * placements, not subcategory numbers, so a pool spread over several subcategories, or
 * equivalent bench subcategories, never reads as drift. Left out: songs with a write to
 * RadioDJ still pending (RadioDJ hasn't caught up yet, which isn't drift), songs never
 * synced, and placements RadioDJ has no subcategory for, where there's nothing to compare.
 */
export async function findDrift(db: Db, stationId: string): Promise<DriftReport> {
  const [station] = await db.select().from(stations).where(eq(stations.id, stationId));
  if (!station?.membershipImportedAt) return { imported: false, projects: false, rows: [], awaitingProjection: 0 };
  const cats = (
    await db
      .select({ id: categories.id, name: categories.name, rdjSubcategoryIds: categories.rdjSubcategoryIds })
      .from(categories)
      .where(eq(categories.stationId, stationId))
  ) as ProjectedCategory[];
  const lifecycle = (station.rdjLifecycleSubcats ?? null) as LifecycleSubcatMap | null;
  if (!cats.some((c) => c.rdjSubcategoryIds?.length)) return { imported: true, projects: false, rows: [], awaitingProjection: 0 };

  const awaiting = new Set(
    (
      await db
        .select({ songId: changesetItems.songId })
        .from(changesetItems)
        .innerJoin(changesets, eq(changesets.id, changesetItems.changesetId))
        .where(
          and(
            eq(changesets.stationId, stationId),
            eq(changesets.status, "applied"),
            inArray(changesets.projection, ["pending", "failed"])
          )
        )
    ).map((r) => r.songId)
  );
  const draft = await findDraft(db, stationId);
  const staged = new Set(
    draft
      ? (await db.select({ songId: changesetItems.songId }).from(changesetItems).where(eq(changesetItems.changesetId, draft.id))).map(
          (r) => r.songId
        )
      : []
  );

  const rows = await db
    .select({
      id: songs.id,
      rdjSongId: songs.rdjSongId,
      artist: songs.artist,
      title: songs.title,
      state: songs.lifecycleState,
      subcat: songs.rdjSubcategoryId,
      categoryId: songCategories.categoryId,
    })
    .from(songs)
    .leftJoin(songCategories, and(eq(songCategories.songId, songs.id), eq(songCategories.role, "primary")))
    .where(and(eq(songs.stationId, stationId), sql`${songs.rdjSongId} > 0`, sql`${songs.rdjSubcategoryId} IS NOT NULL`))
    .orderBy(asc(songs.artist), asc(songs.title));

  const subcatNames = new Map(
    (
      await db
        .select({ id: schema.rdjSubcategories.rdjSubcategoryId, name: schema.rdjSubcategories.name })
        .from(schema.rdjSubcategories)
        .where(eq(schema.rdjSubcategories.stationId, stationId))
    ).map((r) => [r.id, r.name])
  );
  const out: DriftRow[] = [];
  let awaitingProjection = 0;
  for (const r of rows) {
    const rotavox: Placement = { state: r.state as LifecycleState, categoryId: r.categoryId ?? null };
    // Active with no pool is the Inbox's business, not drift.
    if (rotavox.state === "active" && !rotavox.categoryId) continue;
    const radiodj = placementForSubcat(r.subcat, cats, lifecycle, rotavox.categoryId);
    if (samePlacement(radiodj, rotavox)) continue;
    let canReproject = true;
    try {
      subcatForPlacement(rotavox, r.subcat, cats, lifecycle);
    } catch {
      canReproject = false;
    }
    // A pool RadioDJ can't express can't be compared with it: nothing drifted.
    if (!canReproject && rotavox.state === "active") continue;
    if (awaiting.has(r.id)) {
      awaitingProjection++;
      continue;
    }
    out.push({
      songId: r.id,
      rdjSongId: r.rdjSongId,
      artist: r.artist,
      title: r.title,
      rotavox,
      rdjSubcat: r.subcat!,
      rdjSubcatName: subcatNames.get(r.subcat!) ?? null,
      radiodj,
      canAccept: !(radiodj.state === "active" && !radiodj.categoryId),
      canReproject,
      staged: staged.has(r.id),
    });
  }
  return { imported: true, projects: true, rows: out, awaitingProjection };
}

/**
 * Writes Rotavox's placement back to RadioDJ for drifted songs: an applied changeset
 * whose items keep each song where Rotavox has it, queued for projection. Rotavox changes
 * nothing; the Runner's projection moves the RadioDJ subcategory back through its usual
 * validated path (live precondition, inverse first). Songs that no longer drift, or can't
 * be written back, are skipped.
 */
export async function reprojectDrift(
  db: Db,
  stationId: string,
  songIds: string[],
  opts: { appliedBy?: string | null; at?: Date } = {}
): Promise<{ changesetId: string | null; songs: number }> {
  const report = await findDrift(db, stationId);
  const wanted = new Set(songIds);
  const chosen = report.rows.filter((r) => wanted.has(r.songId) && r.canReproject);
  if (chosen.length === 0) return { changesetId: null, songs: 0 };
  const at = opts.at ?? new Date();
  return db.transaction(async (tx) => {
    const [cs] = await tx
      .insert(changesets)
      .values({
        stationId,
        status: "applied",
        intent: "Put RadioDJ back in line with Rotavox (changed in RadioDJ directly)",
        appliedAt: at,
        appliedBy: opts.appliedBy ?? null,
        projection: "pending",
      })
      .returning({ id: changesets.id });
    await tx.insert(changesetItems).values(
      chosen.map((r) => ({
        stationId,
        changesetId: cs.id,
        songId: r.songId,
        fromState: r.rotavox.state,
        fromCategoryId: r.rotavox.categoryId,
        toState: r.rotavox.state,
        toCategoryId: r.rotavox.categoryId,
        reason: `RadioDJ had it in subcategory ${r.rdjSubcat}`,
        fromRdjSubcat: r.rdjSubcat,
      }))
    );
    return { changesetId: cs.id, songs: chosen.length };
  });
}
