import { eq } from "drizzle-orm";
import { LIFECYCLE_STATES, stations } from "@rotavox/schema";
import { db } from "@/lib/db";
import { getLifecycleOverview, isRestDue, RECENT_TRANSITION_DAYS } from "@/lib/library";
import { getCategoryNames, getPlaceableCategories, getPoolEditing, getRestExits } from "@/lib/music-edits";
import { DISMISS_DAYS, getSuggestions } from "@/lib/suggestions";
import { RECENT_SPINS_DAYS } from "@/lib/queries";
import { allowed, requireStation } from "@/lib/auth";
import { fmtStateIn, fmtWhenShort } from "@/components/music/format";
import { LibraryTable } from "@/components/music/LibraryTable";
import { PoolLifecycleSettings, PoolMoveSettings } from "@/components/music/PoolLifecycleSettings";
import { SuggestionsTable } from "@/components/music/SuggestionsTable";

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
  const [overview, options, editing, [station], suggestions, names] = await Promise.all([
    getLifecycleOverview(stationId),
    getPlaceableCategories(stationId),
    getPoolEditing(stationId),
    db.select({ timezone: stations.timezone }).from(stations).where(eq(stations.id, stationId)),
    getSuggestions(stationId),
    getCategoryNames(stationId),
  ]);
  const tz = station?.timezone ?? "UTC";
  const canEditMusic = allowed(ctx, "edit_music");
  const readOnly = !editing.imported || !canEditMusic;
  const now = new Date();
  const due = overview.resting.filter((r) => isRestDue(r, now));
  const restingOn = overview.resting.filter((r) => !isRestDue(r, now));
  const restExits = await getRestExits(stationId, options);
  const onLadder = overview.standards.some((p) => p.ladderRank != null);
  const table = (rows: typeof due) => (
    <LibraryTable
      rows={rows}
      directions={overview.directions}
      options={options}
      staged={editing.staged}
      restExits={restExits}
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
        <Heading>Suggested moves ({suggestions.rows.length})</Heading>
        {suggestions.rows.length === 0 ? (
          <p className="max-w-2xl text-sm text-neutral-500">
            Nothing to suggest.{suggestions.dismissed ? ` ${suggestions.dismissed} set aside for now.` : ""} Suggestions come
            from each pool&apos;s settings below: where songs leave rest to, when they move on, when a song that isn&apos;t
            airing is benched, and the ladder for falling songs. Nothing moves until you stage and apply it.
          </p>
        ) : (
          <>
            <p className="max-w-2xl text-sm text-neutral-500">
              From each pool&apos;s settings below. Stage the ones you agree with and apply them under Changes; &ldquo;Not
              now&rdquo; hides one for {DISMISS_DAYS} days.
              {suggestions.dismissed ? ` ${suggestions.dismissed} set aside for now.` : ""}
            </p>
            <SuggestionsTable
              rows={suggestions.rows}
              categoryNames={Object.fromEntries(names)}
              dismissDays={DISMISS_DAYS}
              readOnly={readOnly}
            />
          </>
        )}
      </section>

      <section className="space-y-2">
        <Heading>Falling{onLadder ? ` (${overview.falling.length})` : ""}</Heading>
        {!onLadder ? (
          <p className="max-w-2xl text-sm text-neutral-500">
            Give the currents pools a ladder rank under Pool settings below (1 = hottest) and songs that came down
            the ladder, or have stayed in a pool past its falling-after time, show here.
          </p>
        ) : overview.falling.length === 0 ? (
          <p className="text-sm text-neutral-500">No song on the ladder is falling.</p>
        ) : (
          <>
            <p className="text-sm text-neutral-500">
              Came down from a hotter pool, or active past the pool&apos;s falling-after time. Hover a song&apos;s state
              for which. Nothing moves on its own.
            </p>
            {table(overview.falling)}
          </>
        )}
      </section>

      <section className="space-y-2">
        <Heading>Rest reviews due ({due.length})</Heading>
        {due.length === 0 ? (
          <p className="text-sm text-neutral-500">No song has rested past its pool&apos;s standard.</p>
        ) : (
          <>
            <p className="text-sm text-neutral-500">
              Decide where each goes next: its pool&apos;s rest exit, or back to its own pool. They&apos;re also under
              Suggested moves above.
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
        <Heading>Pool settings</Heading>
        <p className="max-w-2xl text-sm text-neutral-500">
          <strong className="font-medium text-neutral-400">Ladder rank</strong> places a currents pool on the ladder, 1
          = hottest; a song that arrives from a hotter pool is falling, from a cooler one rising.{" "}
          <strong className="font-medium text-neutral-400">Falling after</strong> marks a song falling once it has been
          active in the pool that long. <strong className="font-medium text-neutral-400">Standard rest</strong> is how
          long songs rest before they come up for review. Blank turns each off. None of them moves a song.
        </p>
        <PoolLifecycleSettings rows={overview.standards} readOnly={!canEditMusic} />
        <h3 className="pt-4 text-sm font-medium text-neutral-300">What songs are suggested to do next</h3>
        <p className="max-w-2xl text-sm text-neutral-500">
          Feeds Suggested moves above. A song leaving rest goes back to its own pool unless you choose another; a song
          that has been active in a pool past its move-on time is suggested for the next pool (recurrent to gold, say);
          a song that hasn&apos;t aired in the given time is suggested for the bench.
        </p>
        <PoolMoveSettings rows={overview.standards} readOnly={!canEditMusic} />
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
