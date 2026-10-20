import { notFound } from "next/navigation";
import { getCategoryBalance, getPoolSongs, RECENT_SPINS_DAYS } from "@/lib/queries";
import { stationId } from "@/lib/station";
import { requiredDepth } from "@/lib/balance";
import { BalanceStatusBadge, STATUS_HELP } from "@/components/music/BalanceStatusBadge";
import { fmtAgo, fmtDuration, fmtSlots, fmtTurnover } from "@/components/music/format";

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
  const { categoryId } = await params;
  const balance = await getCategoryBalance(stationId);
  const category = balance.find((b) => b.id === categoryId);
  if (!category) notFound();

  const parent = balance.find((b) => b.id === category.parentId);
  const children = balance.filter((b) => b.parentId === category.id);
  const songs = await getPoolSongs(stationId, category.id);
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
          label="Enabled songs"
          value={String(category.enabledDepth)}
          sub={
            needed != null
              ? `${needed} needed for target`
              : category.depth !== category.enabledDepth
                ? `${category.depth} in total`
                : undefined
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-neutral-400">
                  <th className="py-2 font-medium">Artist</th>
                  <th className="py-2 font-medium">Title</th>
                  <th className="py-2 text-right font-medium">Length</th>
                  <th className="py-2 pl-6 font-medium">Last aired</th>
                  <th className="py-2 text-right font-medium">Spins, {RECENT_SPINS_DAYS}d</th>
                </tr>
              </thead>
              <tbody>
                {songs.map((s) => (
                  <tr
                    key={s.id}
                    className={`border-b border-neutral-900 ${s.enabled ? "" : "text-neutral-600"}`}
                    title={s.enabled ? undefined : "Disabled in the playout library — not schedulable"}
                  >
                    <td className="py-1.5">{s.artist ?? "—"}</td>
                    <td className="py-1.5">
                      {s.title ?? "—"}
                      {!s.enabled && <span className="ml-2 text-xs uppercase tracking-wide">disabled</span>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-neutral-400">{fmtDuration(s.durationMs)}</td>
                    <td className="py-1.5 pl-6 text-neutral-400">{fmtAgo(s.lastAiredAt)}</td>
                    <td className="py-1.5 text-right tabular-nums text-neutral-400">{s.recentSpins}</td>
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
