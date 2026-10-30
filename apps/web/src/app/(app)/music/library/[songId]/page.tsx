import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { stations } from "@rotavox/schema";
import { db } from "@/lib/db";
import { getSongDetail, type SongEvent } from "@/lib/library";
import { getPlaceableCategories, getPoolEditing, suggestedRestExit } from "@/lib/music-edits";
import { RECENT_SPINS_DAYS } from "@/lib/queries";
import { allowed, requireStation } from "@/lib/auth";
import { fmtAgo, fmtDuration, fmtStateIn, fmtWhenShort } from "@/components/music/format";
import { LifecycleCell } from "@/components/music/song-actions";
import { SongPageActions } from "@/components/music/SongPageActions";

// Live view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

const SOURCE: Record<string, string> = { import: "Imported from RadioDJ", changeset: "Change", ui: "Edited" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function EventRow({ e, tz }: { e: SongEvent; tz: string }) {
  const moved = e.fromState !== e.toState || e.fromCategoryName !== e.toCategoryName;
  return (
    <li className="border-b border-neutral-900 py-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="tabular-nums text-neutral-400">{fmtWhenShort(e.at, tz)}</span>
        <span>
          {e.fromState == null ? (
            fmtStateIn(e.toState, e.toCategoryName)
          ) : moved ? (
            <>
              {fmtStateIn(e.fromState, e.fromCategoryName)} → {fmtStateIn(e.toState, e.toCategoryName)}
            </>
          ) : (
            <>{fmtStateIn(e.toState, e.toCategoryName)} (unchanged)</>
          )}
        </span>
        <span className="text-xs text-neutral-500">
          {e.changesetId ? (
            <a href={`/music/changes/${e.changesetId}`} className="hover:underline">
              {SOURCE[e.source] ?? e.source} →
            </a>
          ) : (
            SOURCE[e.source] ?? e.source
          )}
        </span>
      </div>
      {e.reason && <p className="mt-0.5 text-sm text-neutral-500">{e.reason}</p>}
    </li>
  );
}

export default async function SongPage({ params }: { params: Promise<{ songId: string }> }) {
  const ctx = await requireStation();
  const { stationId } = ctx;
  const { songId } = await params;
  // Not a uuid can't be a song; don't hand it to Postgres to reject.
  if (!/^[0-9a-f-]{36}$/i.test(songId)) notFound();
  const [detail, options, editing, [station]] = await Promise.all([
    getSongDetail(stationId, songId),
    getPlaceableCategories(stationId),
    getPoolEditing(stationId),
    db.select({ timezone: stations.timezone }).from(stations).where(eq(stations.id, stationId)),
  ]);
  if (!detail) notFound();
  const { song } = detail;
  const tz = station?.timezone ?? "UTC";
  const canEdit = editing.imported && allowed(ctx, "edit_music");

  return (
    <div className="space-y-6">
      <div>
        <a href="/music/library" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Library
        </a>
        <h1 className="mt-1 text-xl font-semibold">
          {song.artist ?? "—"} <span className="text-neutral-500">·</span> {song.title ?? "—"}
        </h1>
        {song.album && <p className="text-sm text-neutral-500">{song.album}</p>}
      </div>

      <section className="space-y-3 rounded border border-neutral-800 p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Field label="Pool">
            {song.poolId ? (
              <a href={`/music/categories/${song.poolId}`} className="hover:underline">
                {song.poolName}
              </a>
            ) : (
              <span className="text-neutral-500">none</span>
            )}
            {detail.alsoPools.length > 0 && (
              <span className="text-neutral-500"> · also {detail.alsoPools.map((p) => p.name).join(", ")}</span>
            )}
          </Field>
          <Field label="State">
            <LifecycleCell state={song.state} since={song.since} reviewDays={song.restReviewDays} />
          </Field>
          <Field label="In RadioDJ">
            {song.enabled ? "enabled" : <span className="text-neutral-500">disabled</span>} · song {song.rdjSongId}
            {song.rdjSubcategoryId != null && ` · subcat ${song.rdjSubcategoryId}`}
          </Field>
          <Field label="Length">{fmtDuration(song.durationMs)}</Field>
        </div>
        {canEdit && (
          <SongPageActions
            song={{ id: song.id, state: song.state, poolId: song.poolId, poolName: song.poolName }}
            options={options}
            staged={editing.staged[song.id] ?? null}
            restExit={suggestedRestExit(options)}
          />
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">History</h2>
          {detail.events.length === 0 ? (
            <p className="text-sm text-neutral-500">No lifecycle changes recorded.</p>
          ) : (
            <ul className="text-sm">
              {detail.events.map((e) => (
                <EventRow key={e.id} e={e} tz={tz} />
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Airplay</h2>
          <p className="text-sm text-neutral-400">
            Last aired {fmtAgo(song.lastAiredAt)} · {song.recentSpins} in {RECENT_SPINS_DAYS} days · {detail.spins30d} in
            30 days · {detail.spinsTotal} on record
          </p>
          {detail.plays.length > 0 && (
            <ul className="text-sm tabular-nums text-neutral-400">
              {detail.plays.map((p, i) => (
                <li key={i} className="border-b border-neutral-900 py-1">
                  {fmtWhenShort(p.airedAt, tz)}
                  {p.source === "assumed" && (
                    <span className="ml-2 text-xs text-neutral-600" title="Not yet confirmed against RadioDJ's history">
                      assumed
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
