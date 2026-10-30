import { findDrift } from "@rotavox/schema";
import { db } from "@/lib/db";
import { getCategoryNames } from "@/lib/music-edits";
import { allowed, requireStation } from "@/lib/auth";
import { DriftTable } from "@/components/music/DriftTable";

// Live view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function DriftPage() {
  const ctx = await requireStation();
  const { stationId } = ctx;
  const [report, names] = await Promise.all([findDrift(db, stationId), getCategoryNames(stationId)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">RadioDJ drift</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          Songs whose RadioDJ subcategory no longer matches where Rotavox has them: someone changed them in RadioDJ
          directly. Rotavox schedules from its own pools, so until you decide, RadioDJ&apos;s AutoDJ fallback and
          Rotavox disagree. Keep RadioDJ&apos;s filing to adopt it as a change, or put RadioDJ back in line. As of the
          last library sync.
        </p>
      </div>
      {!report.imported ? (
        <p className="text-sm text-neutral-500">
          Pools for this station still come from RadioDJ, so there is nothing to drift from. Import them on the{" "}
          <a href="/station" className="underline hover:text-neutral-300">
            Station
          </a>{" "}
          page.
        </p>
      ) : !report.projects ? (
        <p className="text-sm text-neutral-500">No Rotavox pool is mapped to a RadioDJ subcategory, so there is nothing to compare.</p>
      ) : report.rows.length === 0 ? (
        <p className="text-sm text-neutral-500">
          RadioDJ matches Rotavox.
          {report.awaitingProjection
            ? ` ${report.awaitingProjection} ${report.awaitingProjection === 1 ? "song is" : "songs are"} still on the way to RadioDJ.`
            : ""}
        </p>
      ) : (
        <>
          {report.awaitingProjection > 0 && (
            <p className="text-xs text-neutral-500">
              {report.awaitingProjection} more {report.awaitingProjection === 1 ? "song differs" : "songs differ"} only because a
              change is still on its way to RadioDJ; {report.awaitingProjection === 1 ? "it isn't" : "they aren't"} listed.
            </p>
          )}
          <DriftTable rows={report.rows} categoryNames={Object.fromEntries(names)} readOnly={!allowed(ctx, "edit_music")} />
        </>
      )}
    </div>
  );
}
