import {
  listAccessibleStations,
  listRunnerFleet,
  listStaff,
  parseRunnerVersion,
  sameRevision,
  serverRevision,
  shortRevision,
  type FleetStation,
} from "@rotavox/schema";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { StaffInvite } from "@/components/account/StaffInvite";
import { StationPicker } from "@/components/account/StationPicker";
import { AutoRefresh } from "@/components/station/AutoRefresh";
import { RunnerButton } from "@/components/station/RunnerButton";
import { fmtAgo } from "@/components/music/format";

// Runner versions and update progress are live; never prerender.
export const dynamic = "force-dynamic";

/** A Runner quiet for longer than this isn't running: it calls Rotavox every few seconds. */
const RUNNER_QUIET_MS = 2 * 60_000;

const isOpen = (j: FleetStation["lastUpdate"]) => j?.status === "queued" || j?.status === "running";

/** One station's line in the Runners list: where its Runner is, and whether it can be updated. */
function RunnerRow({ s, cloud, now }: { s: FleetStation; cloud: string | null; now: Date }) {
  const [runner] = s.runners; // the most recently heard from
  const reported = parseRunnerVersion(runner?.lastVersion);
  const quiet = runner?.lastUsedAt ? now.getTime() - runner.lastUsedAt.getTime() > RUNNER_QUIET_MS : true;
  const job = s.lastUpdate;

  let state: React.ReactNode;
  let canUpdate = false;
  if (!runner?.lastUsedAt) state = <span className="text-neutral-500">No Runner has connected</span>;
  else if (!reported?.revision)
    state = (
      <span className="text-amber-300">
        Runner {reported?.version ?? "?"} predates self-update; update it on the box once
      </span>
    );
  else if (!cloud) state = <span className="text-neutral-500">at {shortRevision(reported.revision)}</span>;
  else if (sameRevision(reported.revision, cloud)) state = <span className="text-emerald-300">Current</span>;
  else {
    state = <span className="text-amber-300">Behind: at {shortRevision(reported.revision)}</span>;
    canUpdate = true;
  }

  return (
    <li className="space-y-1 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-neutral-100">{s.name}</span>
        {runner && (
          <span className="text-neutral-500">
            {runner.label} · Runner {reported?.version ?? "?"} · seen {fmtAgo(runner.lastUsedAt, now)}
          </span>
        )}
        {state}
        {runner?.lastUsedAt && quiet && <span className="text-red-300">not heard from lately</span>}
        {isOpen(job) ? (
          <span className="text-sky-300">{job!.status === "running" ? "Updating…" : "Waiting for the Runner…"}</span>
        ) : (
          canUpdate && (
            <RunnerButton
              url="/api/staff/runners/update"
              body={{ stationId: s.id }}
              label={`Update to ${shortRevision(cloud!)}`}
              pendingLabel="Asking…"
            />
          )
        )}
      </div>
      {job && !isOpen(job) && (
        <details className="text-sm">
          <summary className="cursor-pointer text-neutral-500">
            Last update {fmtAgo(job.requestedAt, now)}:{" "}
            <span className={job.status === "failed" ? "text-red-300" : "text-neutral-400"}>{job.summary}</span>
          </summary>
          {job.output ? (
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-neutral-900 p-3 text-xs text-neutral-400">
              {job.output}
            </pre>
          ) : (
            <p className="mt-2 text-xs text-neutral-500">No output.</p>
          )}
        </details>
      )}
    </li>
  );
}

export default async function StaffPage() {
  const ctx = await requireSession();
  if (!ctx.user.isStaff) {
    return <p className="text-sm text-neutral-400">This page is for Rotavox staff.</p>;
  }
  const [staff, stations, fleet] = await Promise.all([
    listStaff(db),
    listAccessibleStations(db, ctx.user),
    listRunnerFleet(db),
  ]);
  const cloud = serverRevision();
  const now = new Date();

  return (
    <div className="space-y-8">
      <AutoRefresh active={fleet.some((s) => isOpen(s.lastUpdate))} />
      <div>
        <h1 className="text-xl font-semibold">Rotavox staff</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          Staff can open every station with a station admin&apos;s powers, and make password-reset links from a
          station&apos;s People page.
        </p>
      </div>
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Stations</h2>
        <StationPicker
          currentId={ctx.station?.id ?? null}
          stations={stations.map((s) => ({ id: s.id, name: s.name, role: "" }))}
        />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Runners</h2>
        <p className="max-w-2xl text-sm text-neutral-400">
          Rotavox runs {cloud ? <span className="text-neutral-200">{shortRevision(cloud)}</span> : "an unknown commit"}.
          A Runner that&apos;s behind updates itself to the same commit, fetched from GitHub. The update restarts it,
          and RadioDJ&apos;s AutoDJ covers playout until it&apos;s back: under a minute, or a few minutes when the
          update installs new dependencies.
        </p>
        <ul className="divide-y divide-neutral-900 text-sm">
          {fleet.map((s) => (
            <RunnerRow key={s.id} s={s} cloud={cloud} now={now} />
          ))}
        </ul>
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Staff</h2>
        <ul className="text-sm text-neutral-300">
          {staff.map((s) => (
            <li key={s.id}>
              {s.name} <span className="text-neutral-500">· {s.email}</span>
            </li>
          ))}
        </ul>
        <StaffInvite />
      </section>
    </div>
  );
}
