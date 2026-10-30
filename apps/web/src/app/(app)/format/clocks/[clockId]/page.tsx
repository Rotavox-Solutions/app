import { notFound } from "next/navigation";
import { count, eq } from "drizzle-orm";
import { formatGrid, getClockForEdit, listClockRevisions } from "@rotavox/schema";
import { db } from "@/lib/db";
import { getClockCategoryOptions } from "@/lib/format-edits";
import { allowed, requireStation } from "@/lib/auth";
import { ClockEditor } from "@/components/format/ClockEditor";
import { DeleteClock } from "@/components/format/ClockActions";

// Live view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function ClockPage({ params }: { params: Promise<{ clockId: string }> }) {
  const ctx = await requireStation();
  const { stationId } = ctx;
  const { clockId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clockId)) notFound();
  const [clock, options, [grid], revisions] = await Promise.all([
    getClockForEdit(db, stationId, clockId),
    getClockCategoryOptions(stationId),
    db.select({ n: count() }).from(formatGrid).where(eq(formatGrid.clockId, clockId)),
    listClockRevisions(db, stationId, clockId),
  ]);
  if (!clock) notFound();
  const canEdit = allowed(ctx, "edit_format");
  const { id, updatedAt, ...draft } = clock;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <a href="/format/clocks" className="text-sm text-neutral-500 hover:text-neutral-300">
            ← Clocks
          </a>
          <h1 className="mt-1 text-xl font-semibold">{clock.name}</h1>
        </div>
        {canEdit && grid.n === 0 && <DeleteClock clockId={id} name={clock.name} />}
      </div>
      <ClockEditor
        clockId={id}
        initial={draft}
        updatedAt={updatedAt.toISOString()}
        options={options}
        gridCells={grid.n}
        timezone={ctx.station.timezone}
        revisions={revisions.map((r) => ({ ...r, savedAt: r.savedAt.toISOString() }))}
        readOnly={!canEdit}
      />
    </div>
  );
}
