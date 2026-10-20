import { getCategoryBalance, getTodaySummary } from "@/lib/queries";
import { stationId } from "@/lib/station";
import { needsAttention } from "@/lib/balance";
import { HOUR_MS } from "@/lib/constants";
import { fmtAgo, fmtTurnover } from "@/components/music/format";

// Live ops view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

/** Less approved air ahead than this and the PD should be generating the next log. */
const COVERAGE_WARN_HOURS = 24;
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
  const [summary, balance] = await Promise.all([getTodaySummary(stationId), getCategoryBalance(stationId)]);
  if (!summary) {
    return <p className="text-sm text-neutral-500">No station configured for SCHEDULER_STATION_ID.</p>;
  }

  const now = new Date();
  const hoursAhead = summary.approvedThrough ? (summary.approvedThrough.getTime() - now.getTime()) / HOUR_MS : 0;
  const coverageTone: Tone = !summary.airing ? "alert" : hoursAhead < COVERAGE_WARN_HOURS ? "warn" : "ok";

  const attention = balance.filter(needsAttention);
  const covered = balance.filter((b) => b.status === "covered");

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
