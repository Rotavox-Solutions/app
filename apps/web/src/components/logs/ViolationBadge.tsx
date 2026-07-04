export function ViolationBadge({ count }: { count: number }) {
  if (count === 0) {
    return <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">0</span>;
  }
  return (
    <span className="rounded bg-amber-900/60 px-2 py-0.5 text-xs font-medium text-amber-300">{count}</span>
  );
}

export function StatusBadge({ status }: { status: "draft" | "approved" | "airing" | "aired" }) {
  const styles: Record<string, string> = {
    draft: "bg-neutral-800 text-neutral-300",
    approved: "bg-blue-900/60 text-blue-300",
    airing: "bg-emerald-900/60 text-emerald-300",
    aired: "bg-neutral-800 text-neutral-500",
  };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}>{status}</span>;
}
