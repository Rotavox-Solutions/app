import { notFound } from "next/navigation";
import { getCategoryBalance, getPoolSongs, RECENT_SPINS_DAYS } from "@/lib/queries";
import { requiredDepth } from "@/lib/balance";
import { BalanceStatusBadge, STATUS_HELP } from "@/components/music/BalanceStatusBadge";
import { fmtSlots, fmtTurnover } from "@/components/music/format";
import { PoolSongTable } from "@/components/music/PoolSongTable";
import { getPlaceableCategories, getPoolEditing, suggestedRestExit } from "@/lib/music-edits";
import { directionsFor } from "@/lib/direction";
import { allowed, requireStation } from "@/lib/auth";

// Live view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-neutral-800 px-4 py-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}

export default async function CategoryDetailPage({ params }: { params: Promise<{ categoryId: string }> }) {
  const ctx = await requireStation();
  const { stationId } = ctx;
  const { categoryId } = await params;
  const balance = await getCategoryBalance(stationId);
  const category = balance.find((b) => b.id === categoryId);
  if (!category) notFound();

  const parent = balance.find((b) => b.id === category.parentId);
  const children = balance.filter((b) => b.parentId === category.id);
  const [songs, options, editing] = await Promise.all([
    getPoolSongs(stationId, category.id),
    getPlaceableCategories(stationId),
    getPoolEditing(stationId),
  ]);
  const restExit = suggestedRestExit(options);
  // "also" rows take their direction from their primary pool, which is elsewhere.
  const directions = await directionsFor(
    stationId,
    songs.map((s) => ({ id: s.id, state: s.lifecycleState, poolId: s.role === "primary" ? category.id : null }))
  );
  const needed = requiredDepth(category);

  return (
    <div className="space-y-6">
      <div>
        <a href="/music/categories" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Categories{parent ? ` / ${parent.name}` : ""}
        </a>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-xl font-semibold">{category.name}</h1>
          {!(category.hasChildren && category.status === "uncalled") && <BalanceStatusBadge status={category.status} />}
        </div>
        {!(category.hasChildren && category.status === "uncalled") && (
          <p className="mt-1 text-sm text-neutral-500">{STATUS_HELP[category.status]}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Schedulable songs"
          value={String(category.enabledDepth)}
          sub={
            [
              needed != null ? `${needed} needed for target` : null,
              category.restingDepth ? `${category.restingDepth} resting` : null,
              category.alsoDepth ? `+${category.alsoDepth} also eligible` : null,
            ]
              .filter(Boolean)
              .join(" · ") || undefined
          }
        />
        <Stat label="Slots per week" value={category.weeklySlots ? fmtSlots(category.weeklySlots) : "—"} />
        <Stat
          label="Turnover"
          value={fmtTurnover(category.projectedTurnoverHours)}
          sub={category.targetTurnoverHours != null ? `target ${fmtTurnover(category.targetTurnoverHours)}` : "no target set"}
        />
        <Stat
          label={`Spins, last ${RECENT_SPINS_DAYS} days`}
          value={String(category.recentSpins)}
          sub={category.weeklySlots ? `${fmtSlots(category.weeklySlots)} designed` : undefined}
        />
      </div>

      {children.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Sub-pools</h2>
          <div className="flex flex-wrap gap-2">
            {children.map((c) => (
              <a
                key={c.id}
                href={`/music/categories/${c.id}`}
                className="rounded border border-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-900"
              >
                {c.name} <span className="text-neutral-500">· {c.enabledDepth}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Songs in {category.name} ({songs.length})
        </h2>
        {songs.length === 0 ? (
          <p className="text-sm text-neutral-500">
            {children.length > 0 ? "Songs sit in the sub-pools above." : "No songs in this category."}
          </p>
        ) : (
          <>
            {!editing.imported && allowed(ctx, "edit_music") && (
              <p className="text-sm text-neutral-500">
                Pools for this station still come from RadioDJ&apos;s subcategories. Import them on the{" "}
                <a href="/station" className="underline hover:text-neutral-300">
                  Station
                </a>{" "}
                page to change songs here.
              </p>
            )}
            <PoolSongTable
              songs={songs}
              category={{ id: category.id, name: category.name, restReviewDays: category.restReviewDays }}
              options={options}
              staged={editing.staged}
              restExit={restExit && restExit.id !== category.id ? restExit : null}
              spinsDays={RECENT_SPINS_DAYS}
              directions={directions}
              readOnly={!editing.imported || !allowed(ctx, "edit_music")}
            />
          </>
        )}
      </section>
    </div>
  );
}
