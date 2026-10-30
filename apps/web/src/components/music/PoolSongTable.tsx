"use client";

import { useMemo, useState } from "react";
import type { PoolSongRow } from "@/lib/queries";
import type { CategoryOption } from "@/lib/music-edits";
import { fmtAgo, fmtDuration } from "./format";
import {
  ActionMenu,
  describeTarget,
  LifecycleCell,
  RestExitButtons,
  StagedBadge,
  useStaging,
  type ActionSong,
  type Placement,
  type SongAction,
} from "./song-actions";

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
  /** The suggested rest exit (R1). */
  restExit: CategoryOption | null;
  spinsDays: number;
  readOnly?: boolean;
}) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { pending, error, act, undo } = useStaging((ids) =>
    setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))))
  );

  const nameOf = useMemo(() => new Map(options.map((o) => [o.id, o.name])), [options]);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter((s) => [s.artist, s.title, s.lifecycleState].join(" ").toLowerCase().includes(q));
  }, [songs, filter]);
  // An "also" row's placement belongs to its primary pool; it is edited there.
  const editable = (s: PoolSongRow) => !readOnly && s.role === "primary";
  const asTarget = (s: PoolSongRow): ActionSong => ({ id: s.id, state: s.lifecycleState, poolId: category.id });

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
            <ActionMenu
              label="Stage for selected…"
              options={options.filter((o) => o.id !== category.id)}
              disabled={pending || selected.size === 0}
              onAction={(a) => act(songs.filter((s) => selected.has(s.id)).map(asTarget), a)}
            />
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
              const onAction = (a: SongAction) => act([asTarget(s)], a);
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
                    <a href={`/music/library/${s.id}`} className="hover:underline">
                      {s.title ?? "—"}
                    </a>
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
                        <StagedBadge text={describeTarget(to, category.id, nameOf)} disabled={pending} onUndo={() => undo([s.id])} />
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          {s.lifecycleState === "resting" && (
                            <RestExitButtons
                              poolId={category.id}
                              poolName={category.name}
                              restExit={restExit}
                              disabled={pending}
                              onAction={onAction}
                            />
                          )}
                          <ActionMenu
                            label="More…"
                            options={options}
                            disabled={pending}
                            onAction={onAction}
                            state={s.lifecycleState}
                            poolId={category.id}
                            single
                          />
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
