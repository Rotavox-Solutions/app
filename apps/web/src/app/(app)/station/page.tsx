import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import {
  AUTODJ_EVENTS_SYNC_KEY,
  formatOffset,
  listRunnerKeys,
  stations,
  syncState,
  utcOffsetMinutes,
} from "@rotavox/schema";
import { db } from "@/lib/db";
import { getRunnerStatus, JOB_LABEL, REQUESTER_LABEL, RUNNER_SILENT_SECONDS } from "@/lib/runner-status";
import { AutoRefresh } from "@/components/station/AutoRefresh";
import { ImportMembership } from "@/components/station/ImportMembership";
import { RunnerButton } from "@/components/station/RunnerButton";
import { RunnerKeys } from "@/components/station/RunnerKeys";
import { fmtAgo, fmtWhenShort } from "@/components/music/format";
import { allowed, requireStation } from "@/lib/auth";
import { getSetupSteps, type SetupStep } from "@/lib/station-setup";

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
  const [[station], status, [eventsState]] = await Promise.all([
    db.select().from(stations).where(eq(stations.id, stationId)),
    getRunnerStatus(stationId),
    db
      .select()
      .from(syncState)
      .where(and(eq(syncState.stationId, stationId), eq(syncState.syncKey, AUTODJ_EVENTS_SYNC_KEY))),
  ]);
  if (!station) return <p className="text-sm text-neutral-500">This station no longer exists.</p>;
  if (station.playout === "file") return <FileStationPage station={station} />;
  const tz = station.timezone;
  const sync = status.latest.sync_library;
  const syncOpen = sync && (sync.status === "queued" || sync.status === "running");
  const events = status.latest.project_autodj_events;
  const eventsOpen = events && (events.status === "queued" || events.status === "running");
  const eventsOffset =
    eventsState?.watermark && /^-?\d+$/.test(eventsState.watermark) ? Number(eventsState.watermark) : null;
  const offsetNow = utcOffsetMinutes(new Date(), tz);

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

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">AutoDJ fail-safe</h2>
        <p className="max-w-2xl text-sm text-neutral-400">
          If Rotavox stops pacing, RadioDJ&apos;s AutoDJ takes over and its weekly events switch rotations to follow
          this station&apos;s clocks. RadioDJ keeps those events in UTC, so they move when daylight saving changes the
          station&apos;s offset. Once they&apos;ve been written here, Rotavox rewrites them by itself at every change.
          After a rewrite, open and close RadioDJ&apos;s Event Scheduler on the box so it loads them.
        </p>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="text-neutral-300">
            {eventsState?.watermark === "none" ? (
              "The broadcast box has no fail-safe plan."
            ) : eventsOffset === null ? (
              "Not written from Rotavox yet."
            ) : (
              <>
                Events set for <span className="text-neutral-100">{formatOffset(eventsOffset)}</span>
                {eventsOffset === offsetNow ? (
                  <span className="text-neutral-500"> (current)</span>
                ) : (
                  <span className="text-amber-300"> — the station is now {formatOffset(offsetNow)}</span>
                )}
                <span className="text-neutral-500"> · {fmtAgo(eventsState!.updatedAt)}</span>
              </>
            )}
            {events?.status === "failed" && (
              <span className="ml-2 text-red-300">last attempt failed: {events.summary}</span>
            )}
          </span>
          {eventsOpen ? (
            <span className="text-sky-300">
              {events!.status === "running" ? "Writing now…" : "Waiting for the Runner…"}
            </span>
          ) : (
            allowed(ctx, "run_runner") && (
              <RunnerButton url="/api/runner/jobs" body={{ kind: "project_autodj_events" }} label="Write events now" />
            )
          )}
        </div>
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

const STEP_TEXT: Record<SetupStep["key"], { title: string; how: React.ReactNode }> = {
  library: {
    title: "Bring in the library",
    how: (
      <>
        Export it from the playout system as CSV and{" "}
        <a href="/music/library/import" className="underline hover:text-neutral-300">
          import it
        </a>
        . Re-import whenever it changes.
      </>
    ),
  },
  pools: {
    title: "Make the categories",
    how: (
      <>
        The pools clocks draw from, under{" "}
        <a href="/music/categories" className="underline hover:text-neutral-300">
          Categories
        </a>
        . Made before the import, a file&apos;s Category column places songs straight into them.
      </>
    ),
  },
  placed: {
    title: "Place the songs",
    how: (
      <>
        Songs with no category wait in the{" "}
        <a href="/music/inbox" className="underline hover:text-neutral-300">
          Inbox
        </a>
        .
      </>
    ),
  },
  clocks: {
    title: "Build the clocks",
    how: (
      <>
        What each hour plays, in{" "}
        <a href="/format/clocks" className="underline hover:text-neutral-300">
          Clocks
        </a>
        .
      </>
    ),
  },
  grid: {
    title: "Lay out the week",
    how: (
      <>
        Which clock airs each hour, on the{" "}
        <a href="/format/grid" className="underline hover:text-neutral-300">
          Week grid
        </a>
        . Then check the{" "}
        <a href="/format/rules" className="underline hover:text-neutral-300">
          Rules
        </a>
        .
      </>
    ),
  },
  log: {
    title: "Generate and approve a log",
    how: (
      <>
        On{" "}
        <a href="/logs" className="underline hover:text-neutral-300">
          Logs
        </a>
        . Download it as CSV or M3U from the log&apos;s page and load it into the playout system.
      </>
    ),
  },
  people: {
    title: "Invite the station's people",
    how: (
      <>
        PDs, MDs and anyone who should look, from{" "}
        <a href="/station/people" className="underline hover:text-neutral-300">
          People
        </a>
        .
      </>
    ),
  },
};

/**
 * A station on adapter tier 0 (ADR-0001 §3.5c): no Runner, a library imported from a file,
 * and logs exported for the station's own playout system to load.
 */
async function FileStationPage({ station }: { station: typeof stations.$inferSelect }) {
  const steps = await getSetupSteps(station.id);
  const remaining = steps.filter((s) => !s.done).length;
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Setup</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {station.name} · {station.timezone} · logs are exported to the station&apos;s own playout system
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          {remaining ? "Getting on air" : "Set up"}
        </h2>
        {!remaining && (
          <p className="text-sm text-emerald-300">Every step is done. Keep the library current by re-importing it.</p>
        )}
        <ol className="max-w-3xl divide-y divide-neutral-900 text-sm">
          {steps.map((s, i) => (
            <li key={s.key} className="flex gap-3 py-2.5">
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                  s.done ? "bg-emerald-900 text-emerald-200" : "border border-neutral-700 text-neutral-400"
                }`}
              >
                {s.done ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className={s.done ? "text-neutral-400" : "text-neutral-100"}>{STEP_TEXT[s.key].title}</span>
                  <span className="text-xs text-neutral-500">{s.detail}</span>
                </div>
                <p className="text-xs text-neutral-500">{STEP_TEXT[s.key].how}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Play history</h2>
        <p className="max-w-2xl text-sm text-neutral-400">
          The playout system doesn&apos;t tell Rotavox what aired, so approving a log records its songs as played.
          Separation and rotation work from that, so approve only what will really air.
        </p>
      </section>
    </div>
  );
}
