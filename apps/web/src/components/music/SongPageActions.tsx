"use client";

import { useMemo } from "react";
import type { CategoryOption } from "@/lib/music-edits";
import { ActionMenu, describeTarget, RestExitButtons, StagedBadge, useStaging, type Placement, type SongAction } from "./song-actions";

/** A song page's change controls: what is staged for it, or the actions to stage one. */
export function SongPageActions({
  song,
  options,
  staged,
  restExit,
}: {
  song: { id: string; state: string; poolId: string | null; poolName: string | null };
  options: CategoryOption[];
  staged: Placement | null;
  restExit: CategoryOption | null;
}) {
  const { pending, error, act, undo } = useStaging();
  const nameOf = useMemo(() => new Map(options.map((o) => [o.id, o.name])), [options]);
  const onAction = (a: SongAction) => act([{ id: song.id, state: song.state, poolId: song.poolId }], a);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {staged ? (
          <>
            <StagedBadge text={describeTarget(staged, song.poolId, nameOf)} disabled={pending} onUndo={() => undo([song.id])} />
            <a href="/music/changes" className="text-sm text-neutral-300 hover:underline">
              review changes →
            </a>
          </>
        ) : (
          <>
            {song.state === "resting" && (
              <RestExitButtons
                poolId={song.poolId}
                poolName={song.poolName}
                restExit={restExit}
                disabled={pending}
                onAction={onAction}
              />
            )}
            <ActionMenu
              label="Change…"
              options={options}
              disabled={pending}
              onAction={onAction}
              state={song.state}
              poolId={song.poolId}
              single
            />
          </>
        )}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
