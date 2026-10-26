import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { listRunnerKeys, stations } from "@rotavox/schema";
import { db } from "@/lib/db";
import { getRunnerStatus, JOB_LABEL, REQUESTER_LABEL, RUNNER_SILENT_SECONDS } from "@/lib/runner-status";
import { AutoRefresh } from "@/components/station/AutoRefresh";
import { ImportMembership } from "@/components/station/ImportMembership";
import { RunnerButton } from "@/components/station/RunnerButton";
import { RunnerKeys } from "@/components/station/RunnerKeys";
import { fmtAgo, fmtWhenShort } from "@/components/music/format";
import { allowed, requireStation } from "@/lib/auth";

// Live view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  queued: "text-neutral-400",
  running: "text-sky-300",
  succeeded: "text-neutral-400",
  failed: "text-red-300",
};

/**
 * The address a Runner should use: APP_URL when set, otherwise how this page was reached.
 * "localhost" becomes 127.0.0.1, because Node may try IPv6 ::1 first, and the web service
 * on the box listens on 127.0.0.1 only.
 */
async function runnerApiUrl(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "127.0.0.1:3000").replace(
    /^localhost(?=:|$)/,
    "127.0.0.1",
  );
  return `${proto}://${host}`;
}

export default async function StationPage() {
  const ctx = await requireStation();
  const { stationId } = ctx;
  const [[station], status] = await Promise.all([
    db.select().from(stations).where(eq(stations.id, stationId)),
    getRunnerStatus(stationId),
  ]);
  if (!station) return <p className="text-sm text-neutral-500">This station no longer exists.</p>;
  const tz = station.timezone;
  const sync = status.latest.sync_library;
  const syncOpen = sync && (sync.status === "queued" || sync.status === "running");

  return (
    <div className="space-y-8">
      <AutoRefresh active={status.busy} />
      <div>
        <h1 className="text-xl font-semibold">Station</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {station.name} · {tz}
        </p>
      </div>

      {status.runnerSilent && (
        <p className="rounded border border-red-900/70 bg-red-950/20 p-4 text-sm text-red-300">
          The Runner on the broadcast box hasn&apos;t picked up work queued more than {RUNNER_SILENT_SECONDS} seconds
          ago. Library syncs and RadioDJ writes are waiting on it. Check that the Rotavox services are running on the
          box.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Library</h2>
        <p className="max-w-2xl text-sm text-neutral-400">
          Rotavox copies the song library from RadioDJ every 15 minutes: new songs, edited tags and cue points, and
          songs enabled or disabled. New songs land in the{" "}
          <a href="/music/inbox" className="text-neutral-200 hover:underline">
            Inbox
          </a>
          .
        </p>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="text-neutral-300">
            Last synced: <span className="text-neutral-100">{fmtAgo(status.lastSync)}</span>
            {sync?.status === "failed" && (
              <span className="ml-2 text-red-300">last attempt failed: {sync.summary}</span>
            )}
          </span>
          {syncOpen ? (
            <span className="text-sky-300">
              {sync!.status === "running" ? "Syncing now…" : "Waiting for the Runner…"}
            </span>
          ) : (
            allowed(ctx, "run_runner") && (
              <RunnerButton url="/api/runner/jobs" body={{ kind: "sync_library" }} label="Sync now" />
            )
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Pools</h2>
        {station.membershipImportedAt ? (
          <p className="max-w-2xl text-sm text-neutral-400">
            Rotavox has owned pool membership since {fmtWhenShort(station.membershipImportedAt, tz)}. Pools are edited
            in Music, and every applied change is written back to RadioDJ so AutoDJ&apos;s fail-safe stays current.
          </p>
        ) : (
          <div className="max-w-2xl space-y-3">
            <p className="text-sm text-neutral-400">
              Pools still come from RadioDJ&apos;s subcategories. Import them once to edit pools here: each song is
              placed in the pool its subcategory maps to, and Z, W, Y and K become resting, benched and retired. Nothing
              in RadioDJ changes.
            </p>
            {allowed(ctx, "manage_station") ? (
              <ImportMembership />
            ) : (
              <p className="text-sm text-neutral-500">A station admin can start the import.</p>
            )}
          </div>
        )}
      </section>

      {allowed(ctx, "manage_station") && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Runner connection</h2>
          <p className="max-w-2xl text-sm text-neutral-400">
            The Runner on the broadcast box proves it works for {station.name} with a key. Make one when installing a
            Runner, and revoke it if the box is replaced or the key gets out.
          </p>
          <RunnerKeys
            apiUrl={await runnerApiUrl()}
            keys={(await listRunnerKeys(db, stationId)).map((k) => ({
              id: k.id,
              label: k.label,
              created: fmtWhenShort(k.createdAt, tz),
              lastUsed: k.lastUsedAt ? fmtAgo(k.lastUsedAt) : "never",
              version: k.lastVersion,
            }))}
          />
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Runner activity</h2>
        {status.recent.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-900 text-sm">
            {status.recent.map((j) => (
              <li key={j.id} className="py-2">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-neutral-200">{JOB_LABEL[j.kind as keyof typeof JOB_LABEL] ?? j.kind}</span>
                    <span className={STATUS_STYLE[j.status] ?? ""}>{j.status}</span>
                    <span className="text-neutral-500">
                      {fmtWhenShort(j.requestedAt, tz)} · asked by {REQUESTER_LABEL[j.requestedBy] ?? j.requestedBy}
                    </span>
                    {j.summary && <span className="text-neutral-400">{j.summary}</span>}
                  </summary>
                  {j.output ? (
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-neutral-900 p-3 text-xs text-neutral-400">
                      {j.output}
                    </pre>
                  ) : (
                    <p className="mt-2 text-xs text-neutral-500">No output.</p>
                  )}
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
