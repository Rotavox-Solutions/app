import { getCategoryBalance, getTodaySummary } from "@/lib/queries";
import { getChangesStatus } from "@/lib/music-edits";
import { getRunnerStatus } from "@/lib/runner-status";
import { getSuggestions } from "@/lib/suggestions";
import { needsAttention } from "@/lib/balance";
import { HOUR_MS } from "@/lib/constants";
import { fmtAgo, fmtTurnover } from "@/components/music/format";
import { requireStation } from "@/lib/auth";

// Live ops view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

/** Less approved air ahead than this and the PD should be generating the next log. */
const COVERAGE_WARN_HOURS = 24;
/** The Runner syncs every 15 minutes; three missed runs is worth a look. */
const SYNC_STALE_MINUTES = 45;
/** No as-played this long and the Runner is probably not reconciling. */
const RECONCILE_STALE_MINUTES = 30;

type Tone = "ok" | "warn" | "alert";

const TONE: Record<Tone, string> = {
  ok: "border-neutral-800",
  warn: "border-amber-900/70 bg-amber-950/20",
  alert: "border-red-900/70 bg-red-950/20",
};

function Card({ title, tone, children }: { title: string; tone: Tone; children: React.ReactNode }) {
  return (
    <section className={`rounded border p-4 ${TONE[tone]}`}>
      <h2 className="text-sm font-medium text-neutral-300">{title}</h2>
      <div className="mt-2 space-y-1 text-sm text-neutral-400">{children}</div>
    </section>
  );
}

function fmtWhen(at: Date, timezone: string): string {
  return at.toLocaleString("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function TodayPage() {
  const { stationId } = await requireStation();
  const [summary, balance, changes, runner, suggestions] = await Promise.all([
    getTodaySummary(stationId),
    getCategoryBalance(stationId),
    getChangesStatus(stationId),
    getRunnerStatus(stationId),
    getSuggestions(stationId),
  ]);
  if (!summary) {
    return <p className="text-sm text-neutral-500">This station no longer exists.</p>;
  }

  const now = new Date();
  const hoursAhead = summary.approvedThrough ? (summary.approvedThrough.getTime() - now.getTime()) / HOUR_MS : 0;
  const coverageTone: Tone = !summary.airing ? "alert" : hoursAhead < COVERAGE_WARN_HOURS ? "warn" : "ok";

  const attention = balance.filter(needsAttention);
  const covered = balance.filter((b) => b.status === "covered");
  const restDue = balance.filter((b) => b.restDue > 0);

  // A station with an as-played feed (assumeLogAired false) should be reconciling continuously.
  const feedExpected = !summary.assumeLogAired;
  const reconcileStale =
    feedExpected &&
    (!summary.lastReconciledAt || now.getTime() - summary.lastReconciledAt.getTime() > RECONCILE_STALE_MINUTES * 60_000);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Today</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {summary.stationName} · {fmtWhen(now, summary.timezone)} station time
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="On air" tone={coverageTone}>
          {summary.airing ? (
            <>
              <p>
                Approved through{" "}
                <span className="text-neutral-100">{fmtWhen(summary.approvedThrough!, summary.timezone)}</span> —{" "}
                {Math.floor(hoursAhead)}h ahead.
              </p>
              {hoursAhead < COVERAGE_WARN_HOURS && <p className="text-amber-300">Generate and approve the next log.</p>}
              <a href={`/logs/${summary.airing.id}`} className="inline-block text-neutral-300 hover:underline">
                Open the airing log →
              </a>
            </>
          ) : (
            <>
              <p className="text-red-300">No approved log covers right now.</p>
              <a href="/logs" className="inline-block text-neutral-300 hover:underline">
                Go to Logs →
              </a>
            </>
          )}
        </Card>

        <Card title="Waiting for approval" tone={summary.drafts.length ? "warn" : "ok"}>
          {summary.drafts.length === 0 ? (
            <p>No draft logs.</p>
          ) : (
            <ul className="space-y-1">
              {summary.drafts.map((d) => (
                <li key={d.id}>
                  <a href={`/logs/${d.id}`} className="text-neutral-200 hover:underline">
                    {fmtWhen(d.startsAt, summary.timezone)} – {fmtWhen(d.endsAt, summary.timezone)}
                  </a>
                  {d.violationCount > 0 && <span className="ml-2 text-amber-300">{d.violationCount} to review</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Music balance" tone={attention.some((b) => b.status === "empty") ? "alert" : attention.length ? "warn" : "ok"}>
          {attention.length === 0 ? (
            <p>No scheduled category is empty or repeating faster than its target.</p>
          ) : (
            <ul className="space-y-1">
              {attention.map((b) => (
                <li key={b.id}>
                  <a href={`/music/categories/${b.id}`} className="text-neutral-200 hover:underline">
                    {b.name}
                  </a>{" "}
                  {b.status === "empty"
                    ? "has no enabled songs"
                    : `cycles every ${fmtTurnover(b.projectedTurnoverHours)} (target ${fmtTurnover(b.targetTurnoverHours)})`}
                </li>
              ))}
            </ul>
          )}
          {covered.length > 0 && (
            <p className="text-neutral-500">
              {covered.length} empty {covered.length === 1 ? "category airs its" : "categories air their"} fallback
              instead.
            </p>
          )}
          <a href="/music/categories" className="inline-block pt-1 text-neutral-300 hover:underline">
            All categories →
          </a>
        </Card>

        {suggestions.rows.length > 0 && (
          <Card title="Suggested moves" tone="warn">
            <p>
              The lifecycle rules suggest {suggestions.rows.length} {suggestions.rows.length === 1 ? "move" : "moves"}. Nothing
              moves until you stage and apply it.
            </p>
            <a href="/music/lifecycle" className="text-neutral-200 hover:underline">
              Review them in Lifecycle →
            </a>
          </Card>
        )}
        {restDue.length > 0 && (
          <Card title="Rest reviews due" tone="warn">
            <p>These songs have rested past their pool&apos;s standard rest. Decide where each one goes next.</p>
            <ul className="space-y-1">
              {restDue.map((b) => (
                <li key={b.id}>
                  <a href={`/music/categories/${b.id}`} className="text-neutral-200 hover:underline">
                    {b.name}
                  </a>{" "}
                  — {b.restDue} {b.restDue === 1 ? "song" : "songs"}, rested {b.restReviewDays}+ days
                </li>
              ))}
            </ul>
            <a href="/music/lifecycle" className="text-neutral-200 hover:underline">
              Review them in Lifecycle →
            </a>
          </Card>
        )}

        {(changes.draftItems > 0 || changes.inbox > 0 || changes.pendingProjection > 0 || changes.failedProjection > 0) && (
          <Card title="Music changes" tone={changes.failedProjection ? "alert" : "warn"}>
            {changes.inbox > 0 && (
              <p>
                <a href="/music/inbox" className="text-neutral-200 hover:underline">
                  {changes.inbox} {changes.inbox === 1 ? "song has" : "songs have"} no pool
                </a>{" "}
                and can&apos;t be scheduled.
              </p>
            )}
            {changes.draftItems > 0 && (
              <p>
                <a href="/music/changes" className="text-neutral-200 hover:underline">
                  {changes.draftItems} staged {changes.draftItems === 1 ? "change" : "changes"}
                </a>{" "}
                waiting to be applied.
              </p>
            )}
            {changes.pendingProjection > 0 && (
              <p>
                {changes.pendingProjection} applied {changes.pendingProjection === 1 ? "change is" : "changes are"} being
                written to RadioDJ.
              </p>
            )}
            {changes.failedProjection > 0 && (
              <p className="text-red-300">
                {changes.failedProjection} {changes.failedProjection === 1 ? "change" : "changes"} failed to reach
                RadioDJ, so AutoDJ&apos;s fail-safe still uses the old pools.{" "}
                <a href="/music/changes" className="hover:underline">
                  See why and retry →
                </a>
              </p>
            )}
          </Card>
        )}

        {(() => {
          const stale = !runner.lastSync || now.getTime() - runner.lastSync.getTime() > SYNC_STALE_MINUTES * 60_000;
          const failed = runner.latest.sync_library?.status === "failed";
          return (
            <Card title="Library" tone={runner.runnerSilent ? "alert" : stale || failed ? "warn" : "ok"}>
              <p>
                Synced from RadioDJ <span className="text-neutral-100">{fmtAgo(runner.lastSync, now)}</span>.
              </p>
              {runner.runnerSilent && (
                <p className="text-red-300">The Runner isn&apos;t picking up work. Check the services on the box.</p>
              )}
              {failed && <p className="text-amber-300">The last sync failed: {runner.latest.sync_library?.summary}</p>}
              <a href="/station" className="inline-block text-neutral-300 hover:underline">
                Library &amp; Runner →
              </a>
            </Card>
          );
        })()}

        <Card title="As-played" tone={reconcileStale ? "warn" : "ok"}>
          {feedExpected ? (
            <p>
              Last reconciled play: <span className="text-neutral-100">{fmtAgo(summary.lastReconciledAt, now)}</span>
              {reconcileStale && <span className="block text-amber-300">Check that the Runner is up and reconciling.</span>}
            </p>
          ) : (
            <p>No as-played feed for this station — approved logs are assumed to have aired.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
