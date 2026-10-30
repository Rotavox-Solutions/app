"use client";

import type { DirectionResult } from "@rotavox/schema";
import { useMemo, useState } from "react";
import type { LibraryRow } from "@/lib/library";
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

const SONG_TYPE: Record<number, string> = { 0: "music", 1: "jingle", 2: "sweeper", 3: "voiceover" };

/** One page of the library. readOnly: for a Viewer, or before the station's pools are imported. */
export function LibraryTable({
  rows,
  options,
  staged,
  restExits,
  spinsDays,
  directions = {},
  readOnly = false,
}: {
  rows: LibraryRow[];
  options: CategoryOption[];
  staged: Record<string, Placement>;
  /** Each pool's rest exit, by pool id. */
  restExits: Record<string, CategoryOption | null>;
  spinsDays: number;
  /** Rising or falling, by song id, for songs on the currents ladder. */
  directions?: Record<string, DirectionResult>;
  readOnly?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { pending, error, act, undo } = useStaging((ids) =>
    setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))))
  );
  const nameOf = useMemo(() => new Map(options.map((o) => [o.id, o.name])), [options]);
  const asTarget = (r: LibraryRow): ActionSong => ({ id: r.id, state: r.state, poolId: r.poolId });

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          {selected.size} selected
          <ActionMenu
            label="Stage for selected…"
            options={options}
            disabled={pending || selected.size === 0}
            onAction={(a) => act(rows.filter((r) => selected.has(r.id)).map(asTarget), a)}
          />
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-neutral-400">
              {!readOnly && (
                <th className="w-8 py-2">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all on this page" />
                </th>
              )}
              <th className="py-2 font-medium">Artist</th>
              <th className="py-2 font-medium">Title</th>
              <th className="py-2 font-medium">Pool</th>
              <th className="py-2 font-medium">State</th>
              <th className="py-2 text-right font-medium">Length</th>
              <th className="py-2 pl-6 font-medium">Last aired</th>
              <th className="py-2 text-right font-medium">Spins, {spinsDays}d</th>
              {!readOnly && <th className="py-2 pl-6 font-medium">Change</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const to = staged[r.id];
              const onAction = (a: SongAction) => act([asTarget(r)], a);
              return (
                <tr
                  key={r.id}
                  className={`border-b border-neutral-900 ${r.enabled && r.state === "active" ? "" : "text-neutral-600"}`}
                  title={r.enabled ? undefined : "Disabled in the playout library — not schedulable"}
                >
                  {!readOnly && (
                    <td className="py-1.5">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        aria-label={`Select ${r.artist ?? ""} ${r.title ?? ""}`}
                      />
                    </td>
                  )}
                  <td className="py-1.5">{r.artist ?? "—"}</td>
                  <td className="py-1.5">
                    <a href={`/music/library/${r.id}`} className="hover:underline">
                      {r.title ?? "—"}
                    </a>
                    {!r.enabled && <span className="ml-2 text-xs uppercase tracking-wide">disabled</span>}
                    {r.songType != null && r.songType !== 0 && (
                      <span className="ml-2 text-xs text-neutral-500">{SONG_TYPE[r.songType] ?? `type ${r.songType}`}</span>
                    )}
                  </td>
                  <td className="py-1.5">
                    {r.poolId ? (
                      <a href={`/music/categories/${r.poolId}`} className="text-neutral-300 hover:underline">
                        {r.poolName}
                      </a>
                    ) : (
                      <span className="text-neutral-600">—</span>
                    )}
                  </td>
                  <td className="py-1.5">
                    <LifecycleCell state={r.state} since={r.since} reviewDays={r.restReviewDays} direction={directions[r.id]} />
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-400">{fmtDuration(r.durationMs)}</td>
                  <td className="py-1.5 pl-6 text-neutral-400">{fmtAgo(r.lastAiredAt)}</td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-400">{r.recentSpins}</td>
                  {!readOnly && (
                    <td className="py-1.5 pl-6 text-neutral-100">
                      {to ? (
                        <StagedBadge text={describeTarget(to, r.poolId, nameOf)} disabled={pending} onUndo={() => undo([r.id])} />
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          {r.state === "resting" && (
                            <RestExitButtons
                              poolId={r.poolId}
                              poolName={r.poolName}
                              restExit={restExits[r.poolId ?? ""] ?? null}
                              disabled={pending}
                              onAction={onAction}
                            />
                          )}
                          <ActionMenu
                            label={r.poolId || r.state !== "active" ? "More…" : "Place in…"}
                            options={options}
                            disabled={pending}
                            onAction={onAction}
                            state={r.state}
                            poolId={r.poolId}
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
    </div>
  );
}
