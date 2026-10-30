import { listClocks } from "@rotavox/schema";
import { db } from "@/lib/db";
import { allowed, requireStation } from "@/lib/auth";
import { NewClock } from "@/components/format/ClockActions";

// Live view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function ClocksPage() {
  const ctx = await requireStation();
  const clocks = await listClocks(db, ctx.stationId);
  const canEdit = allowed(ctx, "edit_format");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Clocks</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          The shape of an hour: what plays in each position, in order. The week grid decides which clock each hour
          plays. Changing a clock only changes logs generated afterwards.
        </p>
      </div>

      {canEdit && <NewClock clocks={clocks.map((c) => ({ id: c.id, name: c.name }))} />}

      {clocks.length === 0 ? (
        <p className="text-sm text-neutral-500">No clocks yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-neutral-400">
                <th className="py-2 font-medium">Clock</th>
                <th className="py-2 text-right font-medium">Positions</th>
                <th className="py-2 text-right font-medium">Music</th>
                <th className="py-2 text-right font-medium">Imaging</th>
                <th className="py-2 text-right font-medium">Filler</th>
                <th className="py-2 text-right font-medium">Grid hours</th>
                <th className="py-2 pl-6 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {clocks.map((c) => (
                <tr key={c.id} className="border-b border-neutral-900">
                  <td className="py-1.5">
                    <a href={`/format/clocks/${c.id}`} className="hover:underline">
                      {c.name}
                    </a>
                    {c.lengthMinutes !== 60 && <span className="ml-2 text-xs text-neutral-500">{c.lengthMinutes} min</span>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{c.positions}</td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-400">{c.music}</td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-400">{c.imaging}</td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-400">{c.fillers || "—"}</td>
                  <td className={`py-1.5 text-right tabular-nums ${c.gridCells ? "text-neutral-400" : "text-neutral-600"}`}>
                    {c.gridCells || "unused"}
                  </td>
                  <td className="max-w-xs truncate py-1.5 pl-6 text-neutral-500" title={c.notes ?? undefined}>
                    {c.notes ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
