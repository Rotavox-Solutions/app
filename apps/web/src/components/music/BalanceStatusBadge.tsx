import type { BalanceStatus } from "@/lib/balance";

const LABEL: Record<BalanceStatus, string> = {
  empty: "Empty",
  covered: "Empty · falls back",
  hot: "Repeating fast",
  on_target: "On target",
  cold: "Resting long",
  no_target: "No target",
  filler: "Filler",
  fallback: "Fallback pool",
  uncalled: "Not scheduled",
};

const STYLE: Record<BalanceStatus, string> = {
  empty: "bg-red-900/60 text-red-300",
  covered: "bg-neutral-800 text-amber-200/80",
  hot: "bg-amber-900/60 text-amber-300",
  on_target: "bg-emerald-900/50 text-emerald-300",
  cold: "bg-sky-900/50 text-sky-300",
  no_target: "bg-neutral-800 text-neutral-300",
  filler: "bg-neutral-800 text-neutral-400",
  fallback: "bg-neutral-800 text-neutral-400",
  uncalled: "bg-neutral-900 text-neutral-500",
};

export const STATUS_HELP: Record<BalanceStatus, string> = {
  empty: "A clock calls this category, but it has no enabled songs. Those slots fall back or go unfilled.",
  covered: "No enabled songs, but every position calling it has a fallback, so the slot airs the fallback instead.",
  hot: "Too few songs for the slots calling it — each one comes back sooner than its target.",
  on_target: "Depth and demand land the pool within 20–25% of its turnover target.",
  cold: "More songs than the slots need — each one rests well past its target.",
  no_target: "Scheduled, but no turnover target is set, so there is nothing to measure against.",
  filler: "Called only by conditional filler positions, which air when an hour runs short. No designed demand to measure.",
  fallback: "No position calls it directly; it airs when the pools it backs up can't fill.",
  uncalled: "No clock calls it. Right for rest and bench pools; worth checking for anything else.",
};

export function BalanceStatusBadge({ status }: { status: BalanceStatus }) {
  return (
    <span title={STATUS_HELP[status]} className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${STYLE[status]}`}>
      {LABEL[status]}
    </span>
  );
}
