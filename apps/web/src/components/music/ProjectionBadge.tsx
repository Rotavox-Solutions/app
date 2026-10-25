/** Whether an applied change has reached the playout library yet (ADR-0002 §5). */
export function ProjectionBadge({ projection, error }: { projection: string | null; error?: string | null }) {
  if (projection == null) return <span className="text-neutral-500">not projected</span>;
  if (projection === "projected") return <span className="text-neutral-400">written</span>;
  if (projection === "failed")
    return (
      <span className="text-red-300" title={error ?? undefined}>
        failed{error ? ` — ${error}` : ""}
      </span>
    );
  return (
    <span className="text-amber-300" title="Run project-changesets on the Runner to write it to RadioDJ">
      waiting for the Runner
    </span>
  );
}
