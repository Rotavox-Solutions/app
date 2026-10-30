import { eq } from "drizzle-orm";
import { LIFECYCLE_STATES, stations } from "@rotavox/schema";
import { db } from "@/lib/db";
import { getLifecycleOverview, isRestDue, RECENT_TRANSITION_DAYS } from "@/lib/library";
import { getPlaceableCategories, getPoolEditing, suggestedRestExit } from "@/lib/music-edits";
import { RECENT_SPINS_DAYS } from "@/lib/queries";
import { allowed, requireStation } from "@/lib/auth";
import { fmtStateIn, fmtWhenShort } from "@/components/music/format";
import { LibraryTable } from "@/components/music/LibraryTable";
import { RestStandards } from "@/components/music/RestStandards";

// Live view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

const STATE_HELP: Record<string, string> = {
  active: "in rotation",
  resting: "off air on purpose",
  benched: "held, no plan to return",
  retired: "out of the format",
};

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">{children}</h2>;
}

export default async function LifecyclePage() {
  const ctx = await requireStation();
  const { stationId } = ctx;
  const [overview, options, editing, [station]] = await Promise.all([
    getLifecycleOverview(stationId),
    getPlaceableCategories(stationId),
    getPoolEditing(stationId),
    db.select({ timezone: stations.timezone }).from(stations).where(eq(stations.id, stationId)),
  ]);
  const tz = station?.timezone ?? "UTC";
  const canEditMusic = allowed(ctx, "edit_music");
  const readOnly = !editing.imported || !canEditMusic;
  const now = new Date();
  const due = overview.resting.filter((r) => isRestDue(r, now));
  const restingOn = overview.resting.filter((r) => !isRestDue(r, now));
  const restExit = suggestedRestExit(options);
  const table = (rows: typeof due) => (
    <LibraryTable
      rows={rows}
      options={options}
      staged={editing.staged}
      restExit={restExit}
      spinsDays={RECENT_SPINS_DAYS}
      readOnly={readOnly}
    />
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Lifecycle</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          Where songs are in their life on the station. Rest reviews come due when a song has rested past its
          pool&apos;s standard; nothing leaves rest on its own. Changes stage like everywhere else.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {LIFECYCLE_STATES.map((s) => (
          <a
            key={s}
            href={`/music/library?state=${s}`}
            className="rounded border border-neutral-800 px-4 py-3 hover:bg-neutral-900"
          >
            <div className="text-xs capitalize text-neutral-500">{s}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{overview.counts[s].toLocaleString("en-US")}</div>
            <div className="text-xs text-neutral-500">{STATE_HELP[s]}</div>
          </a>
        ))}
      </div>

      {!editing.imported && canEditMusic && (
        <p className="text-sm text-neutral-500">
          Pools for this station still come from RadioDJ&apos;s subcategories. Import them on the{" "}
          <a href="/station" className="underline hover:text-neutral-300">
            Station
          </a>{" "}
          page to change songs here.
        </p>
      )}

      <section className="space-y-2">
        <Heading>Rest reviews due ({due.length})</Heading>
        {due.length === 0 ? (
          <p className="text-sm text-neutral-500">No song has rested past its pool&apos;s standard.</p>
        ) : (
          <>
            <p className="text-sm text-neutral-500">
              Decide where each goes next{restExit ? `: ${restExit.name} is suggested, or back to its own pool` : ""}.
            </p>
            {table(due)}
          </>
        )}
      </section>

      <section className="space-y-2">
        <Heading>Resting ({restingOn.length})</Heading>
        {restingOn.length === 0 ? (
          <p className="text-sm text-neutral-500">No other song is resting.</p>
        ) : (
          <>
            <p className="text-sm text-neutral-500">
              Within their standard rest, or resting from a pool with none set, so never prompted.
            </p>
            {table(restingOn)}
          </>
        )}
      </section>

      <section className="space-y-2">
        <Heading>Rest standards</Heading>
        <p className="max-w-2xl text-sm text-neutral-500">
          How long songs rest from each pool before they come up for review. Leave it blank and that pool&apos;s
          resting songs are never prompted. Changing a standard moves no song.
        </p>
        <RestStandards rows={overview.standards} readOnly={!canEditMusic} />
      </section>

      <section className="space-y-2">
        <Heading>Changes in the last {RECENT_TRANSITION_DAYS} days</Heading>
        {overview.recent.length === 0 ? (
          <p className="text-sm text-neutral-500">No song has changed pool or state.</p>
        ) : (
          <ul className="text-sm">
            {overview.recent.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 border-b border-neutral-900 py-1.5">
                <span className="w-32 shrink-0 tabular-nums text-neutral-400">{fmtWhenShort(e.at, tz)}</span>
                <a href={`/music/library/${e.songId}`} className="hover:underline">
                  {e.artist ?? "—"} · {e.title ?? "—"}
                </a>
                <span className="text-neutral-400">
                  {fmtStateIn(e.fromState, e.fromCategoryName)} → {fmtStateIn(e.toState, e.toCategoryName)}
                </span>
                {e.changesetId ? (
                  <a href={`/music/changes/${e.changesetId}`} className="text-neutral-500 hover:underline" title={e.reason}>
                    {e.reason}
                  </a>
                ) : (
                  <span className="text-neutral-500">{e.reason}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
