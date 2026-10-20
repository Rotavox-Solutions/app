import type { CategoryBalance } from "@/lib/balance";
import { BalanceStatusBadge } from "./BalanceStatusBadge";
import { fmtSlots, fmtTurnover } from "./format";

/** Parents first, each followed by its children, so the table reads as the category tree. */
function treeOrder(rows: CategoryBalance[]): { row: CategoryBalance; depth: number }[] {
  const ids = new Set(rows.map((r) => r.id));
  const childrenOf = new Map<string | null, CategoryBalance[]>();
  for (const r of rows) {
    const parent = r.parentId && ids.has(r.parentId) ? r.parentId : null;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), r]);
  }
  const out: { row: CategoryBalance; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const r of childrenOf.get(parent) ?? []) {
      out.push({ row: r, depth });
      walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Projected turnover against target on a 0–2× scale; the tick marks target. */
function TurnoverBar({ projected, target }: { projected: number | null; target: number | null }) {
  if (projected == null || target == null) return null;
  const ratio = Math.min(projected / target, 2);
  const tone = ratio < 0.8 ? "bg-amber-400" : ratio > 1.25 ? "bg-sky-400" : "bg-emerald-400";
  return (
    <div className="relative mt-1 h-1 w-24 rounded bg-neutral-800" aria-hidden>
      <div className={`h-1 rounded ${tone}`} style={{ width: `${(ratio / 2) * 100}%` }} />
      <div className="absolute left-1/2 top-[-2px] h-2 w-px bg-neutral-400" />
    </div>
  );
}

export function BalanceTable({ rows }: { rows: CategoryBalance[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">No categories in this group.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-neutral-400">
            <th className="py-2 font-medium">Category</th>
            <th className="py-2 text-right font-medium" title="Enabled songs / all songs, including sub-pools">
              Songs
            </th>
            <th className="py-2 text-right font-medium" title="Clock slots calling this category per week">
              Slots / wk
            </th>
            <th className="py-2 pl-6 font-medium" title="Hours for the pool to cycle once at designed demand">
              Turnover
            </th>
            <th className="py-2 text-right font-medium" title="Actual spins of this pool's songs over the last 7 days">
              Spins, 7d
            </th>
            <th className="py-2 pl-6 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {treeOrder(rows).map(({ row, depth }) => {
            // Played well beyond designed demand means other pools are falling back into this one.
            const absorbing = row.weeklySlots > 0 && row.recentSpins > row.weeklySlots * 1.25;
            return (
              <tr key={row.id} className="border-b border-neutral-900 hover:bg-neutral-900/50">
                <td className="py-2" style={{ paddingLeft: `${depth * 1.25}rem` }}>
                  <a
                    href={`/music/categories/${row.id}`}
                    className={`hover:underline ${row.hasChildren ? "font-medium text-neutral-100" : "text-neutral-200"}`}
                  >
                    {row.name}
                  </a>
                </td>
                <td className="py-2 text-right tabular-nums">
                  <span className={row.enabledDepth === 0 && row.weeklySlots > 0 ? "text-red-300" : ""}>
                    {row.enabledDepth}
                  </span>
                  {row.depth !== row.enabledDepth && <span className="text-neutral-500"> / {row.depth}</span>}
                </td>
                <td className="py-2 text-right tabular-nums text-neutral-300">
                  {row.weeklySlots ? (
                    fmtSlots(row.weeklySlots)
                  ) : row.weeklyFillerSlots ? (
                    <span className="text-neutral-500" title="Conditional filler positions — air only when an hour runs short">
                      filler
                    </span>
                  ) : (
                    <span className="text-neutral-600">—</span>
                  )}
                </td>
                <td className="py-2 pl-6 tabular-nums">
                  <span className="text-neutral-200">{fmtTurnover(row.projectedTurnoverHours)}</span>
                  {row.targetTurnoverHours != null && (
                    <span className="text-neutral-500"> · target {fmtTurnover(row.targetTurnoverHours)}</span>
                  )}
                  <TurnoverBar projected={row.projectedTurnoverHours} target={row.targetTurnoverHours} />
                </td>
                <td className="py-2 text-right tabular-nums text-neutral-300">
                  {row.recentSpins || <span className="text-neutral-600">0</span>}
                  {absorbing && (
                    <span className="ml-1 text-amber-300" title="Playing well above designed slots — absorbing fallback">
                      ▲
                    </span>
                  )}
                </td>
                <td className="py-2 pl-6">
                  {row.hasChildren && row.status === "uncalled" ? (
                    <span className="text-xs text-neutral-600">group</span>
                  ) : (
                    <BalanceStatusBadge status={row.status} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
