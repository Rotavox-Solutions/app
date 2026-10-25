import { eq } from "drizzle-orm";
import { listAppliedChangesets, stations } from "@rotavox/schema";
import { db } from "@/lib/db";
import { getDraftReview, statusDirection, type ImpactRow } from "@/lib/music-edits";
import { BalanceStatusBadge } from "@/components/music/BalanceStatusBadge";
import { DraftEditor } from "@/components/music/DraftEditor";
import { ProjectionBadge } from "@/components/music/ProjectionBadge";
import { RevertButton } from "@/components/music/RevertButton";
import { AutoRefresh } from "@/components/station/AutoRefresh";
import { RunnerButton } from "@/components/station/RunnerButton";
import { fmtTurnover, fmtWhenShort } from "@/components/music/format";
import { allowed, requireStation } from "@/lib/auth";

// Live view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

function Delta({ before, after }: { before: number; after: number }) {
  if (before === after) return <span className="text-neutral-500">{after}</span>;
  return (
    <span>
      <span className="text-neutral-500">{before} → </span>
      <span className="text-neutral-100">{after}</span>
    </span>
  );
}

function ImpactTable({ rows }: { rows: ImpactRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-neutral-400">
            <th className="py-2 font-medium">Category</th>
            <th className="py-2 text-right font-medium">Schedulable</th>
            <th className="py-2 text-right font-medium">Resting</th>
            <th className="py-2 pl-6 text-right font-medium">Turnover</th>
            <th className="py-2 pl-6 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const dir = statusDirection(r.before.status, r.after.status);
            return (
              <tr key={r.id} className="border-b border-neutral-900">
                <td className="py-1.5">
                  <a href={`/music/categories/${r.id}`} className="hover:underline">
                    {r.name}
                  </a>
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  <Delta before={r.before.enabledDepth} after={r.after.enabledDepth} />
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  <Delta before={r.before.restingDepth} after={r.after.restingDepth} />
                </td>
                <td className="py-1.5 pl-6 text-right tabular-nums">
                  {fmtTurnover(r.before.projectedTurnoverHours) === fmtTurnover(r.after.projectedTurnoverHours) ? (
                    <span className="text-neutral-500">{fmtTurnover(r.after.projectedTurnoverHours)}</span>
                  ) : (
                    <span>
                      <span className="text-neutral-500">{fmtTurnover(r.before.projectedTurnoverHours)} → </span>
                      {fmtTurnover(r.after.projectedTurnoverHours)}
                    </span>
                  )}
                  {r.targetTurnoverHours != null && (
                    <span className="block text-xs text-neutral-500">target {fmtTurnover(r.targetTurnoverHours)}</span>
                  )}
                </td>
                <td className="py-1.5 pl-6">
                  <span className="inline-flex items-center gap-2">
                    {r.before.status !== r.after.status && (
                      <>
                        <BalanceStatusBadge status={r.before.status} />
                        <span className="text-neutral-500">→</span>
                      </>
                    )}
                    <BalanceStatusBadge status={r.after.status} />
                    {dir === "worse" && <span className="text-xs text-amber-300">worse</span>}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function ChangesPage() {
  const ctx = await requireStation();
  const { stationId } = ctx;
  const canEdit = allowed(ctx, "edit_music");
  const [{ draft, impact, categoryNames }, history, [station]] = await Promise.all([
    getDraftReview(stationId),
    listAppliedChangesets(db, stationId),
    db.select({ timezone: stations.timezone }).from(stations).where(eq(stations.id, stationId)),
  ]);
  const tz = station?.timezone ?? "UTC";
  const reverted = draft?.revertsChangesetId ? history.find((h) => h.id === draft.revertsChangesetId) : undefined;

  return (
    <div className="space-y-8">
      <AutoRefresh active={history.some((h) => h.projection === "pending")} />
      <div>
        <h1 className="text-xl font-semibold">Changes</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          Every pool and lifecycle edit is staged here first. Review what it does to the balance, say why, then apply
          it. Applied changes can be undone.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Draft{draft && draft.items.length > 0 ? ` (${draft.items.length})` : ""}
        </h2>
        {!draft || draft.items.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Nothing staged. Place songs from the{" "}
            <a href="/music/inbox" className="text-neutral-300 hover:underline">
              Inbox
            </a>
            .
          </p>
        ) : (
          <>
            {impact.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-sm text-neutral-300">What it does to the balance</h3>
                <ImpactTable rows={impact} />
              </div>
            ) : (
              <p className="text-sm text-neutral-500">No scheduled category&apos;s depth or status changes.</p>
            )}
            {canEdit ? (
              <DraftEditor
                key={draft.id}
                items={draft.items}
                intent={draft.intent}
                categoryNames={Object.fromEntries(categoryNames)}
                revertsLabel={
                  draft.revertsChangesetId
                    ? `the change applied ${reverted?.appliedAt ? fmtWhenShort(reverted.appliedAt, tz) : "earlier"}`
                    : null
                }
              />
            ) : (
              <p className="text-sm text-neutral-400">
                {draft.items.length} song{draft.items.length === 1 ? "" : "s"} staged. A Programmer or Station admin
                reviews and applies them.
              </p>
            )}
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Applied</h2>
        {history.length === 0 ? (
          <p className="text-sm text-neutral-500">No changes applied from Rotavox yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-neutral-400">
                  <th className="py-2 font-medium">Applied</th>
                  <th className="py-2 font-medium">Why</th>
                  <th className="py-2 text-right font-medium">Songs</th>
                  <th className="py-2 pl-6 font-medium">RadioDJ</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-neutral-900">
                    <td className="whitespace-nowrap py-1.5 text-neutral-400">
                      <a href={`/music/changes/${h.id}`} className="hover:underline">
                        {h.appliedAt ? fmtWhenShort(h.appliedAt, tz) : "—"}
                      </a>
                    </td>
                    <td className="py-1.5">
                      {h.intent}
                      {h.appliedByName && <span className="ml-2 text-xs text-neutral-500">by {h.appliedByName}</span>}
                      {h.revertedById && (
                        <span className="ml-2 text-xs uppercase tracking-wide text-neutral-500">undone</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{h.itemCount}</td>
                    <td className="py-1.5 pl-6">
                      <ProjectionBadge projection={h.projection} error={h.projectionError} />
                      {canEdit && h.projection === "failed" && (
                        <div className="mt-1">
                          <RunnerButton
                            url={`/api/changes/${h.id}/retry`}
                            label="Sync and retry"
                            pendingLabel="Queuing…"
                          />
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 pl-3 text-right">
                      {canEdit && !h.revertedById && !h.revertsChangesetId && <RevertButton changesetId={h.id} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
