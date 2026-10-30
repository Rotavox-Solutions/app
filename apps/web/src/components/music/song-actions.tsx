"use client";

// The lifecycle and pool actions a PD takes on songs, shared by the category page, the
// Library and a song's own page. Each stages into the draft (ADR-0002 §2.3); nothing
// reaches the air until the changes are applied.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CategoryOption } from "@/lib/music-edits";
import { groupOptions } from "./format";
import { stage, unstageSongs, type StageItem } from "./changes-client";

export interface Placement {
  state: string;
  categoryId: string | null;
}

/**
 *   rest      — off air on purpose, keeping its pool as its origin
 *   return    — back into rotation in its pool (a resting song's rest exit, case by case)
 *   benched   — held in the library, no pool
 *   retired   — out of the format for good
 *   move:<id> — active in that pool
 */
export type SongAction = "rest" | "return" | "benched" | "retired" | `move:${string}`;

/** A song as the actions see it: its state and primary pool. */
export interface ActionSong {
  id: string;
  state: string;
  poolId: string | null;
}

export function targetFor(action: SongAction, poolId: string | null): Placement {
  if (action === "rest") return { state: "resting", categoryId: poolId };
  if (action === "return") return { state: "active", categoryId: poolId };
  if (action === "benched" || action === "retired") return { state: action, categoryId: null };
  return { state: "active", categoryId: action.slice("move:".length) };
}

/** A staged target in a PD's words, relative to where the song is now. */
export function describeTarget(to: Placement, poolId: string | null, nameOf: Map<string, string>): string {
  if (to.state === "active") {
    return to.categoryId === poolId ? "back in rotation" : `to ${nameOf.get(to.categoryId ?? "") ?? "?"}`;
  }
  return to.state === "resting" ? "rest" : to.state === "benched" ? "bench" : "retire";
}

/** Staging state for a table or page: run an action, then refresh the server render. */
export function useStaging(onStaged?: (songIds: string[]) => void) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(op: () => Promise<string | null>) {
    setPending(true);
    setError(null);
    const err = await op();
    setPending(false);
    if (err) setError(err);
    else router.refresh();
    return err;
  }

  const act = async (targets: ActionSong[], action: SongAction) => {
    const err = await run(() =>
      stage(targets.map((s): StageItem => ({ songId: s.id, ...targetFor(action, s.poolId) })))
    );
    if (!err) onStaged?.(targets.map((s) => s.id));
  };
  const undo = (songIds: string[]) => run(() => unstageSongs(songIds));

  return { pending, error, act, undo };
}

/**
 * The action menu. `state`/`poolId` narrow it to one song's choices; leave them out for a
 * bulk selection, where each song's own pool is used.
 */
export function ActionMenu({
  label,
  options,
  disabled,
  onAction,
  state,
  poolId,
  single = false,
}: {
  label: string;
  options: CategoryOption[];
  disabled?: boolean;
  onAction: (action: SongAction) => void;
  state?: string;
  poolId?: string | null;
  single?: boolean;
}) {
  const hasPool = !single || !!poolId;
  return (
    <select
      value=""
      disabled={disabled}
      onChange={(e) => e.target.value && onAction(e.target.value as SongAction)}
      className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 disabled:opacity-50"
      aria-label={label}
    >
      <option value="">{label}</option>
      <optgroup label={single ? "Lifecycle" : "Lifecycle (each in its own pool)"}>
        {hasPool && state !== "resting" && <option value="rest">Rest</option>}
        {hasPool && state !== "active" && <option value="return">Return to rotation</option>}
        {state !== "benched" && <option value="benched">Bench</option>}
        {state !== "retired" && <option value="retired">Retire</option>}
      </optgroup>
      {groupOptions(options.filter((o) => !single || o.id !== poolId)).map(([group, opts]) => (
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
}

/** The ADR-0002 §6.1 rest exit: the suggested pool first, its own pool one click away. */
export function RestExitButtons({
  poolId,
  poolName,
  restExit,
  disabled,
  onAction,
}: {
  poolId: string | null;
  poolName: string | null;
  restExit: CategoryOption | null;
  disabled?: boolean;
  onAction: (action: SongAction) => void;
}) {
  return (
    <>
      {restExit && restExit.id !== poolId && (
        <button
          onClick={() => onAction(`move:${restExit.id}`)}
          disabled={disabled}
          className="rounded bg-blue-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          title="The suggested way out of rest"
        >
          To {restExit.name}
        </button>
      )}
      {poolId && (
        <button
          onClick={() => onAction("return")}
          disabled={disabled}
          className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
        >
          Back to {poolName ?? "its pool"}
        </button>
      )}
    </>
  );
}

export function StagedBadge({ text, disabled, onUndo }: { text: string; disabled?: boolean; onUndo: () => void }) {
  return (
    <span className="text-xs uppercase tracking-wide text-sky-300">
      staged · {text}{" "}
      <button
        onClick={onUndo}
        disabled={disabled}
        className="ml-1 normal-case tracking-normal text-neutral-400 underline hover:text-neutral-200 disabled:opacity-50"
      >
        undo
      </button>
    </span>
  );
}

const daysSince = (at: Date | null) => (at ? Math.floor((Date.now() - at.getTime()) / 86_400_000) : null);

export function LifecycleCell({ state, since, reviewDays }: { state: string; since: Date | null; reviewDays: number | null }) {
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
