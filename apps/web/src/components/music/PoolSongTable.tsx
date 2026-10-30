"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PoolSongRow } from "@/lib/queries";
import type { CategoryOption } from "@/lib/music-edits";
import { groupOptions } from "./CategoryPicker";
import { stage, unstageSongs, type StageItem } from "./changes-client";
import { fmtAgo, fmtDuration } from "./format";

interface Placement {
  state: string;
  categoryId: string | null;
}

/**
 * What a PD can do to a song from its pool page. Each stages into the draft (ADR-0002
 * §2.3); nothing reaches the air until the changes are applied.
 *   rest      — off air on purpose, keeping this pool as its origin
 *   return    — back into rotation here (a resting song's rest exit, case by case)
 *   benched   — held in the library, no pool
 *   retired   — out of the format for good
 *   move:<id> — active in another pool
 */
type Action = "rest" | "return" | "benched" | "retired" | `move:${string}`;

const daysSince = (at: Date | null) => (at ? Math.floor((Date.now() - at.getTime()) / 86_400_000) : null);

function LifecycleCell({ state, since, reviewDays }: { state: string; since: Date | null; reviewDays: number | null }) {
  if (state === "active") return <span className="text-neutral-500">active</span>;
  const days = daysSince(since);
  const due = state === "resting" && reviewDays != null && days != null && days >= reviewDays;
  return (
    <span className={due ? "text-amber-300" : "text-sky-300"} title={due ? "Past this pool's standard rest — decide where it goes next" : undefined}>
      {state}
      {days != null && ` ${days}d`}
      {due && " · review"}
    </span>
  );
}

/** readOnly: for a Viewer, or before the station's pools are imported — the list with no controls. */
export function PoolSongTable({
  songs,
  category,
  options,
  staged,
  restExit,
  spinsDays,
  readOnly = false,
}: {
  songs: PoolSongRow[];
  category: { id: string; name: string; restReviewDays: number | null };
  options: CategoryOption[];
  staged: Record<string, Placement>;
  /** The suggested rest exit (R1), when it isn't this pool. */
  restExit: CategoryOption | null;
  spinsDays: number;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOf = useMemo(() => new Map(options.map((o) => [o.id, o.name])), [options]);
  const moveTargets = useMemo(() => options.filter((o) => o.id !== category.id), [options, category.id]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter((s) => [s.artist, s.title, s.lifecycleState].join(" ").toLowerCase().includes(q));
  }, [songs, filter]);
  // An "also" row's placement belongs to its primary pool; it is edited there.
  const editable = (s: PoolSongRow) => !readOnly && s.role === "primary";

  const target = (action: Action): Placement => {
    if (action === "rest") return { state: "resting", categoryId: category.id };
    if (action === "return") return { state: "active", categoryId: category.id };
    if (action === "benched" || action === "retired") return { state: action, categoryId: null };
    return { state: "active", categoryId: action.slice("move:".length) };
  };

  async function run(op: () => Promise<string | null>) {
    setPending(true);
    setError(null);
    const err = await op();
    setPending(false);
    if (err) setError(err);
    else router.refresh();
  }

  const act = (songIds: string[], action: Action) =>
    run(async () => {
      const err = await stage(songIds.map((songId): StageItem => ({ songId, ...target(action) })));
      if (!err) setSelected((prev) => new Set([...prev].filter((id) => !songIds.includes(id))));
      return err;
    });

  const editableVisible = visible.filter(editable);
  const allSelected = editableVisible.length > 0 && editableVisible.every((s) => selected.has(s.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(editableVisible.map((s) => s.id)));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const describe = (p: Placement) =>
    p.state === "active"
      ? p.categoryId === category.id
        ? "back in rotation"
        : `to ${nameOf.get(p.categoryId ?? "") ?? "?"}`
      : p.state === "resting"
        ? "rest"
        : p.state === "benched"
          ? "bench"
          : "retire";

  const actionSelect = (songIds: string[], label: string, state?: string) => (
    <select
      value=""
      disabled={pending || songIds.length === 0}
      onChange={(e) => e.target.value && act(songIds, e.target.value as Action)}
      className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 disabled:opacity-50"
      aria-label={label}
    >
      <option value="">{label}</option>
      <optgroup label="In this pool">
        {state !== "resting" && <option value="rest">Rest</option>}
        {state !== "active" && <option value="return">Return to rotation</option>}
        <option value="benched">Bench</option>
        <option value="retired">Retire</option>
      </optgroup>
      {groupOptions(moveTargets).map(([group, opts]) => (
        <optgroup key={group} label={`Move to · ${group}`}>
          {opts.map((o) => (
            <option key={o.id} value={`move:${o.id}`}>
              {o.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );

  const stagedCount = songs.filter((s) => staged[s.id]).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by artist, title or state…"
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 sm:w-72"
        />
        {!readOnly && (
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            {selected.size} selected
            {actionSelect([...selected], "Stage for selected…")}
          </div>
        )}
        {stagedCount > 0 && (
          <a href="/music/changes" className="text-sm text-neutral-300 hover:underline">
            {stagedCount} staged — review changes →
          </a>
        )}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-neutral-400">
              {!readOnly && (
                <th className="w-8 py-2">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all shown" />
                </th>
              )}
              <th className="py-2 font-medium">Artist</th>
              <th className="py-2 font-medium">Title</th>
              <th className="py-2 font-medium">State</th>
              <th className="py-2 text-right font-medium">Length</th>
              <th className="py-2 pl-6 font-medium">Last aired</th>
              <th className="py-2 text-right font-medium">Spins, {spinsDays}d</th>
              {!readOnly && <th className="py-2 pl-6 font-medium">Change</th>}
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const to = staged[s.id];
              const resting = s.lifecycleState === "resting";
              return (
                <tr
                  key={s.id}
                  className={`border-b border-neutral-900 ${s.enabled && s.lifecycleState === "active" ? "" : "text-neutral-600"}`}
                  title={s.enabled ? undefined : "Disabled in the playout library — not schedulable"}
                >
                  {!readOnly && (
                    <td className="py-1.5">
                      {editable(s) && (
                        <input
                          type="checkbox"
                          checked={selected.has(s.id)}
                          onChange={() => toggle(s.id)}
                          aria-label={`Select ${s.artist ?? ""} ${s.title ?? ""}`}
                        />
                      )}
                    </td>
                  )}
                  <td className="py-1.5">{s.artist ?? "—"}</td>
                  <td className="py-1.5">
                    {s.title ?? "—"}
                    {!s.enabled && <span className="ml-2 text-xs uppercase tracking-wide">disabled</span>}
                    {s.role === "also" && (
                      <span className="ml-2 text-xs uppercase tracking-wide text-neutral-500" title="Primary pool is elsewhere">
                        also
                      </span>
                    )}
                  </td>
                  <td className="py-1.5">
                    <LifecycleCell state={s.lifecycleState} since={s.lifecycleSince} reviewDays={category.restReviewDays} />
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-400">{fmtDuration(s.durationMs)}</td>
                  <td className="py-1.5 pl-6 text-neutral-400">{fmtAgo(s.lastAiredAt)}</td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-400">{s.recentSpins}</td>
                  {!readOnly && (
                    <td className="py-1.5 pl-6 text-neutral-100">
                      {!editable(s) ? (
                        <span className="text-xs text-neutral-500">edit from its primary pool</span>
                      ) : to ? (
                        <span className="text-xs uppercase tracking-wide text-sky-300">
                          staged · {describe(to)}{" "}
                          <button
                            onClick={() => run(() => unstageSongs([s.id]))}
                            disabled={pending}
                            className="ml-1 normal-case tracking-normal text-neutral-400 underline hover:text-neutral-200 disabled:opacity-50"
                          >
                            undo
                          </button>
                        </span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          {resting && restExit && (
                            <button
                              onClick={() => act([s.id], `move:${restExit.id}`)}
                              disabled={pending}
                              className="rounded bg-blue-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
                              title="The suggested way out of rest"
                            >
                              To {restExit.name}
                            </button>
                          )}
                          {resting && (
                            <button
                              onClick={() => act([s.id], "return")}
                              disabled={pending}
                              className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
                            >
                              Back to {category.name}
                            </button>
                          )}
                          {actionSelect([s.id], "More…", s.lifecycleState)}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && songs.length > 0 && <p className="text-sm text-neutral-500">No song matches the filter.</p>}
    </div>
  );
}
