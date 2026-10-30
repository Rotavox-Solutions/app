// Editing the week grid from the UI (ADR-0002: the UI owns format data): which clock
// each hour plays, for every week of the station's rotation cycle. The grid is saved
// whole, refused if someone else saved since it was loaded, and every save is
// snapshotted to grid_revisions. A save only changes logs generated after it.
//
// An hour with no clock gets no log (the engine skips it), so it is allowed but counted:
// a live show may own that hour on purpose.
import { count, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { clocks, formatGrid, gridRevisions, stations } from "./schema.js";
import { ChangesetError } from "./changesets.js";

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface GridCell {
  weekInCycle: number;
  /** 0 = Sunday, station-local. */
  dayOfWeek: number;
  hour: number;
  clockId: string;
}

export interface GridSnapshot {
  cycleWeeks: number;
  cells: GridCell[];
}

export interface GridForEdit extends GridSnapshot {
  updatedAt: Date;
  cycleEpoch: Date | null;
}

export const cellKey = (c: Pick<GridCell, "weekInCycle" | "dayOfWeek" | "hour">) => `${c.weekInCycle}|${c.dayOfWeek}|${c.hour}`;

export async function getGridForEdit(db: Db, stationId: string): Promise<GridForEdit | null> {
  const [station] = await db
    .select({ weeks: stations.formatCycleWeeks, epoch: stations.formatCycleEpoch, updatedAt: stations.gridUpdatedAt })
    .from(stations)
    .where(eq(stations.id, stationId));
  if (!station) return null;
  const rows = await db
    .select({
      weekInCycle: formatGrid.weekInCycle,
      dayOfWeek: formatGrid.dayOfWeek,
      hour: formatGrid.hour,
      clockId: formatGrid.clockId,
    })
    .from(formatGrid)
    .where(eq(formatGrid.stationId, stationId));
  return {
    cycleWeeks: Math.max(1, station.weeks),
    cycleEpoch: station.epoch,
    updatedAt: station.updatedAt,
    cells: rows.sort((a, b) => a.weekInCycle - b.weekInCycle || a.dayOfWeek - b.dayOfWeek || a.hour - b.hour),
  };
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const isWhole = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export class GridSaveError extends ChangesetError {
  constructor(message: string, public problems: string[] = []) {
    super("invalid", message);
  }
}

/** Problems with a grid's cells: out of range, doubled up, or a clock from elsewhere. */
export async function validateGridCells(db: Db | Tx, stationId: string, cycleWeeks: number, cells: GridCell[]): Promise<string[]> {
  if (!Array.isArray(cells)) return ["Send the grid's cells."];
  const problems: string[] = [];
  const own = new Set(
    (await db.select({ id: clocks.id }).from(clocks).where(eq(clocks.stationId, stationId))).map((c) => c.id)
  );
  const seen = new Set<string>();
  for (const c of cells) {
    if (!isWhole(c?.weekInCycle, 0, cycleWeeks - 1) || !isWhole(c?.dayOfWeek, 0, 6) || !isWhole(c?.hour, 0, 23)) {
      problems.push("A cell falls outside the week grid.");
      continue;
    }
    const key = cellKey(c);
    if (seen.has(key)) problems.push(`Week ${c.weekInCycle + 1}, ${DAY_NAMES[c.dayOfWeek]} ${c.hour}:00 is set twice.`);
    seen.add(key);
    if (!own.has(c.clockId)) problems.push("A cell plays a clock that isn't at this station.");
  }
  return [...new Set(problems)];
}

export async function saveGrid(
  db: Db,
  stationId: string,
  cells: GridCell[],
  opts: { expectedUpdatedAt: Date; userId: string | null; note?: string | null; now?: Date }
): Promise<{ updatedAt: Date; cells: number; empty: number }> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const [station] = await tx
      .select({ weeks: stations.formatCycleWeeks, updatedAt: stations.gridUpdatedAt })
      .from(stations)
      .where(eq(stations.id, stationId))
      .for("update");
    if (!station) throw new ChangesetError("not_found", "No such station.");
    if (station.updatedAt.getTime() !== new Date(opts.expectedUpdatedAt).getTime()) {
      throw new ChangesetError(
        "conflict",
        "The grid was saved by someone else since you opened it. Reload to see their version, then make your change again."
      );
    }
    const cycleWeeks = Math.max(1, station.weeks);
    const problems = await validateGridCells(tx, stationId, cycleWeeks, cells);
    if (problems.length) throw new GridSaveError(problems[0], problems);

    const before = await tx
      .select({
        weekInCycle: formatGrid.weekInCycle,
        dayOfWeek: formatGrid.dayOfWeek,
        hour: formatGrid.hour,
        clockId: formatGrid.clockId,
      })
      .from(formatGrid)
      .where(eq(formatGrid.stationId, stationId));
    const [{ n: revisions }] = await tx.select({ n: count() }).from(gridRevisions).where(eq(gridRevisions.stationId, stationId));
    if (revisions === 0) {
      await tx.insert(gridRevisions).values({
        stationId,
        snapshot: { cycleWeeks, cells: before } satisfies GridSnapshot,
        note: "As it stood before the first edit in Rotavox",
        savedAt: station.updatedAt,
      });
    }

    // Nothing references a grid row, so the grid is simply replaced.
    await tx.delete(formatGrid).where(eq(formatGrid.stationId, stationId));
    const clean = cells.map(({ weekInCycle, dayOfWeek, hour, clockId }) => ({ weekInCycle, dayOfWeek, hour, clockId }));
    if (clean.length) await tx.insert(formatGrid).values(clean.map((c) => ({ stationId, ...c })));
    await tx.update(stations).set({ gridUpdatedAt: now }).where(eq(stations.id, stationId));
    await tx.insert(gridRevisions).values({
      stationId,
      snapshot: { cycleWeeks, cells: clean } satisfies GridSnapshot,
      note: opts.note?.trim() || null,
      savedBy: opts.userId,
      savedAt: now,
    });
    return { updatedAt: now, cells: clean.length, empty: cycleWeeks * 7 * 24 - clean.length };
  });
}

export interface GridRevisionRow {
  id: string;
  savedAt: Date;
  note: string | null;
  savedByName: string | null;
  snapshot: GridSnapshot;
}

export const GRID_REVISIONS_SHOWN = 50;

export async function listGridRevisions(db: Db, stationId: string): Promise<GridRevisionRow[]> {
  const rows = await db
    .select({
      id: gridRevisions.id,
      savedAt: gridRevisions.savedAt,
      note: gridRevisions.note,
      savedByName: schema.users.name,
      snapshot: gridRevisions.snapshot,
    })
    .from(gridRevisions)
    .leftJoin(schema.users, eq(schema.users.id, gridRevisions.savedBy))
    .where(eq(gridRevisions.stationId, stationId))
    .orderBy(sql`${gridRevisions.savedAt} desc`)
    .limit(GRID_REVISIONS_SHOWN);
  return rows.map((r) => ({ ...r, snapshot: r.snapshot as GridSnapshot }));
}
