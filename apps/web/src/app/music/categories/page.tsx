import { getCategoryBalance } from "@/lib/queries";
import { stationId } from "@/lib/station";
import { needsAttention, requiredDepth } from "@/lib/balance";
import { BalanceTable } from "@/components/music/BalanceTable";
import { fmtTurnover } from "@/components/music/format";

// Live view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const balance = await getCategoryBalance(stationId);
  const music = balance.filter((b) => b.kind === "music");
  const other = balance.filter((b) => b.kind !== "music");
  const attention = balance.filter(needsAttention);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Categories</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          Each pool&apos;s songs against the clock slots that call it. Turnover is how long a pool takes to cycle
          once: too short and listeners hear repeats, too long and good records sit idle.
        </p>
      </div>

      {attention.length > 0 && (
        <div className="rounded border border-amber-900/60 bg-amber-950/30 p-4 text-sm">
          <div className="font-medium text-amber-200">
            {attention.length} {attention.length === 1 ? "category needs" : "categories need"} attention
          </div>
          <ul className="mt-2 space-y-1 text-neutral-300">
            {attention.map((b) => (
              <li key={b.id}>
                <a href={`/music/categories/${b.id}`} className="font-medium hover:underline">
                  {b.name}
                </a>{" "}
                {b.status === "empty"
                  ? "is called by the clocks but has no enabled songs."
                  : `cycles every ${fmtTurnover(b.projectedTurnoverHours)} against a ${fmtTurnover(
                      b.targetTurnoverHours
                    )} target. Add about ${Math.max(
                      1,
                      (requiredDepth(b) ?? 0) - b.enabledDepth
                    )} songs, or take slots away from it.`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Music</h2>
        <BalanceTable rows={music} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Imaging &amp; other</h2>
        <BalanceTable rows={other} />
      </section>
    </div>
  );
}
