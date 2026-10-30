import { asc, eq } from "drizzle-orm";
import { weekInCycle } from "@rotavox/engine";
import { clocks, getGridForEdit, listGridRevisions } from "@rotavox/schema";
import { db } from "@/lib/db";
import { allowed, requireStation } from "@/lib/auth";
import { GridEditor } from "@/components/format/GridEditor";

// Live view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function GridPage() {
  const ctx = await requireStation();
  const { stationId } = ctx;
  const tz = ctx.station.timezone;
  const [grid, clockRows, revisions] = await Promise.all([
    getGridForEdit(db, stationId),
    db.select({ id: clocks.id, name: clocks.name }).from(clocks).where(eq(clocks.stationId, stationId)).orderBy(asc(clocks.name)),
    listGridRevisions(db, stationId),
  ]);
  if (!grid) return null;
  // The same resolution the engine uses, so "airing" matches what generation will read.
  const current = grid.cycleEpoch ? weekInCycle(new Date(), grid.cycleEpoch, grid.cycleWeeks, tz) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Week grid</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          Which clock each hour plays, in station time ({tz}).
          {grid.cycleWeeks > 1
            ? ` The grid repeats every ${grid.cycleWeeks} weeks; week ${current + 1} is airing now.`
            : ""}{" "}
          Changing the grid only changes logs generated afterwards.
        </p>
      </div>
      {clockRows.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Make a clock under{" "}
          <a href="/format/clocks" className="underline hover:text-neutral-300">
            Clocks
          </a>{" "}
          first.
        </p>
      ) : (
        <GridEditor
          initial={grid.cells}
          updatedAt={grid.updatedAt.toISOString()}
          cycleWeeks={grid.cycleWeeks}
          currentWeek={current}
          clocks={clockRows}
          revisions={revisions.map((r) => ({ ...r, savedAt: r.savedAt.toISOString() }))}
          timezone={tz}
          readOnly={!allowed(ctx, "edit_format")}
        />
      )}
    </div>
  );
}
