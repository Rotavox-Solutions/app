import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getChangeset, listAppliedChangesets, stations } from "@rotavox/schema";
import { db } from "@/lib/db";
import { getCategoryNames } from "@/lib/music-edits";
import { stationId } from "@/lib/station";
import { ProjectionBadge } from "@/components/music/ProjectionBadge";
import { RevertButton } from "@/components/music/RevertButton";
import { fmtPlacement, fmtWhenShort } from "@/components/music/format";

// Live view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ChangesetPage({ params }: { params: Promise<{ changesetId: string }> }) {
  const { changesetId } = await params;
  if (!UUID.test(changesetId)) notFound();
  const cs = await getChangeset(db, stationId, changesetId);
  if (!cs || cs.status === "draft") notFound();
  const [names, history, [station]] = await Promise.all([
    getCategoryNames(stationId),
    listAppliedChangesets(db, stationId, 500),
    db.select({ timezone: stations.timezone }).from(stations).where(eq(stations.id, stationId)),
  ]);
  const tz = station?.timezone ?? "UTC";
  const summary = history.find((h) => h.id === cs.id);

  return (
    <div className="space-y-6">
      <div>
        <a href="/music/changes" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Changes
        </a>
        <h1 className="mt-1 text-xl font-semibold">{cs.intent ?? "Changeset"}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {cs.status === "applied" && cs.appliedAt ? `Applied ${fmtWhenShort(cs.appliedAt, tz)}` : cs.status} ·{" "}
          {cs.items.length} {cs.items.length === 1 ? "song" : "songs"} · RadioDJ:{" "}
          <ProjectionBadge projection={cs.projection} error={cs.projectionError} />
        </p>
        {cs.revertsChangesetId && (
          <p className="mt-1 text-sm">
            <a href={`/music/changes/${cs.revertsChangesetId}`} className="text-sky-300 hover:underline">
              Undoes an earlier change →
            </a>
          </p>
        )}
        {summary?.revertedById && (
          <p className="mt-1 text-sm">
            <a href={`/music/changes/${summary.revertedById}`} className="text-sky-300 hover:underline">
              Undone since →
            </a>
          </p>
        )}
        {cs.status === "applied" && !summary?.revertedById && !cs.revertsChangesetId && (
          <div className="mt-3">
            <RevertButton changesetId={cs.id} />
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-neutral-400">
              <th className="py-2 font-medium">Song</th>
              <th className="py-2 font-medium">From</th>
              <th className="py-2 font-medium">To</th>
              <th className="py-2 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody>
            {cs.items.map((i) => (
              <tr key={i.id} className="border-b border-neutral-900">
                <td className="py-1.5">
                  {i.artist ?? "—"} <span className="text-neutral-500">·</span> {i.title ?? "—"}
                </td>
                <td className="py-1.5 text-neutral-400">{fmtPlacement(i.from, names)}</td>
                <td className="py-1.5">{fmtPlacement(i.to, names)}</td>
                <td className="py-1.5 text-neutral-400">{i.reason ?? <span className="text-neutral-600">(the intent)</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
