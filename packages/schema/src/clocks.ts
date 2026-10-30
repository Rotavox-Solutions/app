// Editing clocks from the UI (ADR-0002: the UI owns format data). A clock is saved whole:
// the editor sends every position in order, and the save validates it, updates positions
// in place by id, inserts new ones and removes the rest, in one transaction. Positions
// keep their ids across edits so approved logs keep their clock_position_id (and with it
// TOH timing in the as-run report). Every save is snapshotted to clock_revisions.
//
// A save only changes logs generated after it. Logs already generated keep their songs.
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { categories, clockPositions, clockRevisions, clocks, formatGrid, logItems } from "./schema.js";
import { ChangesetError } from "./changesets.js";

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const POSITION_KINDS = ["category", "sweeper", "voicetrack", "fixed_event"] as const;
export type PositionKind = (typeof POSITION_KINDS)[number];

/** Constraint keys the editor owns. Any other key a position carries is kept as it is. */
const EDITED_KEYS = ["fallbackCategoryId", "fillerPriority", "trimPriority", "anchorSortOrder", "fixedDurationSeconds"];

export interface ClockPositionDraft {
  /** The position's id, or null for one added in the editor. */
  id: string | null;
  /** Stable within one draft (the id, or a client-made key for a new position); anchors point at it. */
  key: string;
  kind: PositionKind;
  categoryId: string | null;
  fallbackCategoryId: string | null;
  /** Seconds into the hour this position is locked to; 0 is top of hour. Null = floats. */
  targetOffsetSeconds: number | null;
  /** Conditional filler: activated, lowest first, only when the hour runs short. */
  fillerPriority: number | null;
  /** Given up, lowest first, when the hour runs long. */
  trimPriority: number | null;
  /** For imaging about a neighbouring record: that record's key. */
  anchorKey: string | null;
  fixedDurationSeconds: number | null;
  fixedRef: string | null;
  /** Constraint keys the editor doesn't edit (mood, sound codes), carried through untouched. */
  extra: Record<string, unknown>;
}

export interface ClockDraft {
  name: string;
  lengthMinutes: number;
  notes: string | null;
  positions: ClockPositionDraft[];
}

export interface ClockForEdit extends ClockDraft {
  id: string;
  updatedAt: Date;
}

export const CLOCK_LIMITS = { name: 40, positions: 80, minLength: 1, maxLength: 180, priority: 99 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function draftFromRows(
  clock: typeof clocks.$inferSelect,
  rows: (typeof clockPositions.$inferSelect)[]
): ClockForEdit {
  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  const keyBySortOrder = new Map(sorted.map((p) => [p.sortOrder, p.id]));
  return {
    id: clock.id,
    name: clock.name,
    lengthMinutes: clock.lengthMinutes ?? 60,
    notes: clock.notes,
    updatedAt: clock.updatedAt,
    positions: sorted.map((p) => {
      const c = (p.constraints ?? {}) as Record<string, unknown>;
      const num = (k: string) => (typeof c[k] === "number" ? (c[k] as number) : null);
      const extra = Object.fromEntries(Object.entries(c).filter(([k]) => !EDITED_KEYS.includes(k)));
      const anchor = num("anchorSortOrder");
      return {
        id: p.id,
        key: p.id,
        kind: p.positionType as PositionKind,
        categoryId: p.categoryId,
        fallbackCategoryId: typeof c.fallbackCategoryId === "string" ? c.fallbackCategoryId : null,
        targetOffsetSeconds: p.targetOffsetSeconds,
        fillerPriority: num("fillerPriority"),
        trimPriority: num("trimPriority"),
        anchorKey: anchor != null ? keyBySortOrder.get(anchor) ?? null : null,
        fixedDurationSeconds: num("fixedDurationSeconds"),
        fixedRef: p.fixedRef,
        extra,
      };
    }),
  };
}

export async function getClockForEdit(db: Db | Tx, stationId: string, clockId: string): Promise<ClockForEdit | null> {
  if (!UUID.test(clockId)) return null;
  const [clock] = await db
    .select()
    .from(clocks)
    .where(and(eq(clocks.stationId, stationId), eq(clocks.id, clockId)));
  if (!clock) return null;
  const rows = await db.select().from(clockPositions).where(eq(clockPositions.clockId, clockId));
  return draftFromRows(clock, rows);
}

export interface ClockSummary {
  id: string;
  name: string;
  lengthMinutes: number;
  notes: string | null;
  updatedAt: Date;
  positions: number;
  music: number;
  imaging: number;
  fillers: number;
  /** Grid cells across the whole rotation cycle that play this clock. */
  gridCells: number;
}

export async function listClocks(db: Db, stationId: string): Promise<ClockSummary[]> {
  const rows = await db
    .select({
      id: clocks.id,
      name: clocks.name,
      lengthMinutes: clocks.lengthMinutes,
      notes: clocks.notes,
      updatedAt: clocks.updatedAt,
      positions: sql<number>`(SELECT count(*)::int FROM clock_positions p WHERE p.clock_id = clocks.id)`,
      music: sql<number>`(SELECT count(*)::int FROM clock_positions p WHERE p.clock_id = clocks.id
        AND p.position_type = 'category' AND p.constraints->>'fillerPriority' IS NULL)`,
      imaging: sql<number>`(SELECT count(*)::int FROM clock_positions p WHERE p.clock_id = clocks.id
        AND p.position_type = 'sweeper')`,
      fillers: sql<number>`(SELECT count(*)::int FROM clock_positions p WHERE p.clock_id = clocks.id
        AND p.constraints->>'fillerPriority' IS NOT NULL)`,
      gridCells: sql<number>`(SELECT count(*)::int FROM format_grid g WHERE g.clock_id = clocks.id)`,
    })
    .from(clocks)
    .where(eq(clocks.stationId, stationId))
    .orderBy(asc(clocks.name));
  return rows.map((r) => ({ ...r, lengthMinutes: r.lengthMinutes ?? 60 }));
}

const invalid = (message: string) => new ChangesetError("invalid", message);
const isWhole = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/**
 * Checks a draft against the station's categories, returning the problems a PD must fix,
 * each tied to a position number where there is one. Empty means it can be saved.
 */
export async function validateClockDraft(
  db: Db | Tx,
  stationId: string,
  draft: ClockDraft,
  clockId: string | null
): Promise<string[]> {
  const problems: string[] = [];
  const name = draft.name?.trim() ?? "";
  if (!name) problems.push("Give the clock a name.");
  else if (name.length > CLOCK_LIMITS.name) problems.push(`Keep the name to ${CLOCK_LIMITS.name} characters.`);
  else {
    const [clash] = await db
      .select({ id: clocks.id })
      .from(clocks)
      .where(
        and(
          eq(clocks.stationId, stationId),
          sql`lower(${clocks.name}) = lower(${name})`,
          clockId ? ne(clocks.id, clockId) : sql`true`
        )
      );
    if (clash) problems.push(`Another clock is already called ${name}.`);
  }
  if (!isWhole(draft.lengthMinutes, CLOCK_LIMITS.minLength, CLOCK_LIMITS.maxLength)) {
    problems.push(`The clock's length is a whole number of minutes, ${CLOCK_LIMITS.minLength} to ${CLOCK_LIMITS.maxLength}.`);
  }
  const positions = Array.isArray(draft.positions) ? draft.positions : [];
  if (positions.length === 0) problems.push("A clock needs at least one position.");
  if (positions.length > CLOCK_LIMITS.positions) problems.push(`A clock holds at most ${CLOCK_LIMITS.positions} positions.`);

  const cats = await db
    .select({ id: categories.id, kind: categories.kind })
    .from(categories)
    .where(eq(categories.stationId, stationId));
  const kindOf = new Map(cats.map((c) => [c.id, c.kind]));
  const keys = new Map<string, ClockPositionDraft>();
  for (const p of positions) {
    if (typeof p.key !== "string" || !p.key || keys.has(p.key)) {
      problems.push("Two positions share a key; reload the editor.");
      break;
    }
    keys.set(p.key, p);
  }
  const lengthSeconds = (isWhole(draft.lengthMinutes, 1, CLOCK_LIMITS.maxLength) ? draft.lengthMinutes : 60) * 60;

  positions.forEach((p, i) => {
    const at = `Position ${i + 1}`;
    if (!POSITION_KINDS.includes(p.kind)) {
      problems.push(`${at}: unknown kind "${p.kind}".`);
      return;
    }
    if (p.kind === "fixed_event") {
      if (p.categoryId) problems.push(`${at}: a fixed event plays no category.`);
      if (!isWhole(p.fixedDurationSeconds, 0, lengthSeconds)) problems.push(`${at}: give the fixed event a length in seconds.`);
    } else if (!p.categoryId) {
      problems.push(`${at}: choose what it plays.`);
    } else if (!kindOf.has(p.categoryId)) {
      problems.push(`${at}: that category isn't at this station.`);
    }
    if (p.fallbackCategoryId) {
      if (!kindOf.has(p.fallbackCategoryId)) problems.push(`${at}: the fallback category isn't at this station.`);
      else if (p.fallbackCategoryId === p.categoryId) problems.push(`${at}: it can't fall back to itself.`);
    }
    if (p.targetOffsetSeconds != null && !isWhole(p.targetOffsetSeconds, 0, lengthSeconds - 1)) {
      problems.push(`${at}: its locked time has to fall inside the clock.`);
    }
    if (p.fillerPriority != null && !isWhole(p.fillerPriority, 1, CLOCK_LIMITS.priority)) {
      problems.push(`${at}: filler priority is a whole number, 1 to ${CLOCK_LIMITS.priority}.`);
    }
    if (p.trimPriority != null && !isWhole(p.trimPriority, 1, CLOCK_LIMITS.priority)) {
      problems.push(`${at}: trim priority is a whole number, 1 to ${CLOCK_LIMITS.priority}.`);
    }
    if (p.anchorKey) {
      const anchor = keys.get(p.anchorKey);
      if (!anchor || anchor === p) problems.push(`${at}: the record its copy is about isn't in this clock.`);
      else if (anchor.kind !== "category") problems.push(`${at}: its copy can only be about a music position.`);
      if (!p.fallbackCategoryId) {
        problems.push(`${at}: imaging tied to a record needs a fallback, for when that record is given up.`);
      }
    }
    if (p.fixedRef != null && (typeof p.fixedRef !== "string" || p.fixedRef.length > 200)) {
      problems.push(`${at}: the fixed reference is too long.`);
    }
  });
  return problems;
}

function constraintsFor(p: ClockPositionDraft, sortOrderByKey: Map<string, number>): Record<string, unknown> | null {
  const c: Record<string, unknown> = { ...(p.extra ?? {}) };
  if (p.fallbackCategoryId) c.fallbackCategoryId = p.fallbackCategoryId;
  if (p.fillerPriority != null) c.fillerPriority = p.fillerPriority;
  if (p.trimPriority != null) c.trimPriority = p.trimPriority;
  if (p.anchorKey) c.anchorSortOrder = sortOrderByKey.get(p.anchorKey);
  if (p.kind === "fixed_event" && p.fixedDurationSeconds != null) c.fixedDurationSeconds = p.fixedDurationSeconds;
  return Object.keys(c).length ? c : null;
}

/**
 * A draft's positions as they would be stored: numbered in order, anchors resolved to
 * their record's number. What a save writes, and what a preview hands the engine (new
 * positions take their draft key as id).
 */
export function positionsFromDraft(draft: ClockDraft) {
  const sortOrderByKey = new Map(draft.positions.map((p, i) => [p.key, i + 1]));
  return draft.positions.map((p, i) => ({
    id: p.id ?? p.key,
    sortOrder: i + 1,
    positionType: p.kind,
    categoryId: p.kind === "fixed_event" ? null : p.categoryId,
    targetOffsetSeconds: p.targetOffsetSeconds,
    constraints: constraintsFor(p, sortOrderByKey),
    fixedRef: p.fixedRef?.trim() || null,
  }));
}

/** The draft as stored in a revision: positions in order, anchors by position number. */
function snapshotOf(draft: ClockDraft | ClockForEdit) {
  const index = new Map(draft.positions.map((p, i) => [p.key, i + 1]));
  return {
    name: draft.name,
    lengthMinutes: draft.lengthMinutes,
    notes: draft.notes,
    positions: draft.positions.map((p) => ({
      kind: p.kind,
      categoryId: p.categoryId,
      fallbackCategoryId: p.fallbackCategoryId,
      targetOffsetSeconds: p.targetOffsetSeconds,
      fillerPriority: p.fillerPriority,
      trimPriority: p.trimPriority,
      anchorPosition: p.anchorKey ? index.get(p.anchorKey) ?? null : null,
      fixedDurationSeconds: p.fixedDurationSeconds,
      fixedRef: p.fixedRef,
      extra: p.extra,
    })),
  };
}

export interface SaveClockOptions {
  /** The updatedAt the editor loaded; a newer one in the database means someone else saved. */
  expectedUpdatedAt: Date;
  userId: string | null;
  note?: string | null;
  now?: Date;
}

export class ClockSaveError extends ChangesetError {
  constructor(message: string, public problems: string[] = []) {
    super("invalid", message);
  }
}

export async function saveClock(
  db: Db,
  stationId: string,
  clockId: string,
  draft: ClockDraft,
  opts: SaveClockOptions
): Promise<{ updatedAt: Date; removed: number; added: number }> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    if (!UUID.test(clockId)) throw new ChangesetError("not_found", "No such clock at this station.");
    const [clock] = await tx
      .select()
      .from(clocks)
      .where(and(eq(clocks.stationId, stationId), eq(clocks.id, clockId)))
      .for("update");
    if (!clock) throw new ChangesetError("not_found", "No such clock at this station.");
    if (clock.updatedAt.getTime() !== new Date(opts.expectedUpdatedAt).getTime()) {
      throw new ChangesetError(
        "conflict",
        "This clock was saved by someone else since you opened it. Reload to see their version, then make your change again."
      );
    }

    const problems = await validateClockDraft(tx, stationId, draft, clockId);
    const existing = await tx.select().from(clockPositions).where(eq(clockPositions.clockId, clockId));
    const existingIds = new Set(existing.map((p) => p.id));
    for (const p of draft.positions ?? []) {
      if (p.id && !existingIds.has(p.id)) problems.push("A position belongs to another clock; reload the editor.");
    }
    if (problems.length) throw new ClockSaveError(problems[0], [...new Set(problems)]);

    // The first save from the editor keeps the clock as it stood before, so the seeded
    // original can always be restored.
    const [{ n: revisions }] = await tx
      .select({ n: count() })
      .from(clockRevisions)
      .where(eq(clockRevisions.clockId, clockId));
    if (revisions === 0) {
      await tx.insert(clockRevisions).values({
        stationId,
        clockId,
        snapshot: snapshotOf(draftFromRows(clock, existing)),
        note: "As it stood before the first edit in Rotavox",
        savedAt: clock.updatedAt,
      });
    }

    const stored = positionsFromDraft(draft);
    const keptIds = new Set(draft.positions.map((p) => p.id).filter((id): id is string => !!id));
    const removedIds = existing.map((p) => p.id).filter((id) => !keptIds.has(id));
    if (removedIds.length) {
      // Logs already generated keep their songs; they just lose the link to a position
      // that no longer exists (as the seeds have always done).
      await tx.update(logItems).set({ clockPositionId: null }).where(inArray(logItems.clockPositionId, removedIds));
      await tx.delete(clockPositions).where(inArray(clockPositions.id, removedIds));
    }
    let added = 0;
    for (const [i, p] of draft.positions.entries()) {
      const { id: _id, ...values } = stored[i];
      if (p.id) {
        await tx.update(clockPositions).set(values).where(eq(clockPositions.id, p.id));
      } else {
        await tx.insert(clockPositions).values({ clockId, ...values });
        added++;
      }
    }
    await tx
      .update(clocks)
      .set({ name: draft.name.trim(), lengthMinutes: draft.lengthMinutes, notes: draft.notes?.trim() || null, updatedAt: now })
      .where(eq(clocks.id, clockId));
    await tx.insert(clockRevisions).values({
      stationId,
      clockId,
      snapshot: snapshotOf({ ...draft, name: draft.name.trim() }),
      note: opts.note?.trim() || null,
      savedBy: opts.userId,
      savedAt: now,
    });
    return { updatedAt: now, removed: removedIds.length, added };
  });
}

/** A new clock: empty but for one music position, or a copy of another clock's positions. */
export async function createClock(
  db: Db,
  stationId: string,
  input: { name: string; copyFromClockId?: string | null }
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const name = input.name?.trim() ?? "";
    if (!name) throw invalid("Give the clock a name.");
    if (name.length > CLOCK_LIMITS.name) throw invalid(`Keep the name to ${CLOCK_LIMITS.name} characters.`);
    const [clash] = await tx
      .select({ id: clocks.id })
      .from(clocks)
      .where(and(eq(clocks.stationId, stationId), sql`lower(${clocks.name}) = lower(${name})`));
    if (clash) throw invalid(`Another clock is already called ${name}.`);

    let source: ClockForEdit | null = null;
    if (input.copyFromClockId) {
      source = await getClockForEdit(tx, stationId, input.copyFromClockId);
      if (!source) throw new ChangesetError("not_found", "The clock to copy isn't at this station.");
    }
    const [clock] = await tx
      .insert(clocks)
      .values({
        stationId,
        name,
        lengthMinutes: source?.lengthMinutes ?? 60,
        notes: source ? `Copied from ${source.name}` : null,
      })
      .returning({ id: clocks.id });
    if (source) {
      const rows = await tx.select().from(clockPositions).where(eq(clockPositions.clockId, source.id));
      if (rows.length) {
        await tx.insert(clockPositions).values(
          // sort_order is copied, so anchors (which point at a sort_order) still hold.
          rows.map(({ id: _id, clockId: _clock, ...rest }) => ({ ...rest, clockId: clock.id }))
        );
      }
    }
    return clock;
  });
}

/** Deletes a clock no grid cell plays. Logs made with it keep their songs. */
export async function deleteClock(db: Db, stationId: string, clockId: string): Promise<void> {
  await db.transaction(async (tx) => {
    if (!UUID.test(clockId)) throw new ChangesetError("not_found", "No such clock at this station.");
    const [clock] = await tx
      .select({ id: clocks.id })
      .from(clocks)
      .where(and(eq(clocks.stationId, stationId), eq(clocks.id, clockId)))
      .for("update");
    if (!clock) throw new ChangesetError("not_found", "No such clock at this station.");
    const [{ n }] = await tx.select({ n: count() }).from(formatGrid).where(eq(formatGrid.clockId, clockId));
    if (n > 0) {
      throw invalid(`The week grid plays this clock in ${n} ${n === 1 ? "hour" : "hours"}. Take it out of the grid first.`);
    }
    const ids = (await tx.select({ id: clockPositions.id }).from(clockPositions).where(eq(clockPositions.clockId, clockId))).map(
      (r) => r.id
    );
    if (ids.length) {
      await tx.update(logItems).set({ clockPositionId: null }).where(inArray(logItems.clockPositionId, ids));
      await tx.delete(clockPositions).where(eq(clockPositions.clockId, clockId));
    }
    await tx.delete(clocks).where(eq(clocks.id, clockId));
  });
}
