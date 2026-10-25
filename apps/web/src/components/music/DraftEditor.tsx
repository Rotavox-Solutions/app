"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { applyDraft, discard, saveIntent, stage, unstageSongs, type ApplyConflict } from "./changes-client";
import { fmtPlacement } from "./format";

export interface DraftItemView {
  songId: string;
  artist: string | null;
  title: string | null;
  from: { state: string; categoryId: string | null };
  to: { state: string; categoryId: string | null };
  reason: string | null;
}

export function DraftEditor({
  items,
  intent: savedIntent,
  categoryNames,
  revertsLabel,
}: {
  items: DraftItemView[];
  intent: string | null;
  categoryNames: Record<string, string>;
  /** Set when this draft is an undo, naming what it undoes. */
  revertsLabel: string | null;
}) {
  const router = useRouter();
  const names = new Map(Object.entries(categoryNames));
  const [intent, setIntent] = useState(savedIntent ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ApplyConflict[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const conflicted = new Set(conflicts.map((c) => c.songId));

  async function run(op: () => Promise<string | null>) {
    setPending(true);
    setError(null);
    const err = await op();
    setPending(false);
    if (err) setError(err);
    else router.refresh();
  }

  async function handleApply() {
    setPending(true);
    setError(null);
    setConflicts([]);
    const result = await applyDraft(intent);
    setPending(false);
    if (result.error) {
      setError(result.error);
      setConflicts(result.conflicts);
    } else {
      router.refresh();
    }
  }

  const saveReason = (item: DraftItemView, reason: string) => {
    if ((item.reason ?? "") === reason.trim()) return;
    void run(() => stage([{ songId: item.songId, state: item.to.state, categoryId: item.to.categoryId, reason }]));
  };

  return (
    <div className="space-y-4">
      {revertsLabel && <p className="text-sm text-sky-300">This draft undoes {revertsLabel}.</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-neutral-400">
              <th className="py-2 font-medium">Song</th>
              <th className="py-2 font-medium">From</th>
              <th className="py-2 font-medium">To</th>
              <th className="py-2 font-medium">Reason (optional — the intent covers the rest)</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.songId} className={`border-b border-neutral-900 ${conflicted.has(i.songId) ? "bg-red-950/30" : ""}`}>
                <td className="py-1.5">
                  {i.artist ?? "—"} <span className="text-neutral-500">·</span> {i.title ?? "—"}
                  {conflicted.has(i.songId) && (
                    <span className="block text-xs text-red-300">Changed since it was staged — restage or remove it.</span>
                  )}
                </td>
                <td className="py-1.5 text-neutral-400">{fmtPlacement(i.from, names)}</td>
                <td className="py-1.5 text-neutral-100">{fmtPlacement(i.to, names)}</td>
                <td className="py-1.5">
                  <input
                    defaultValue={i.reason ?? ""}
                    onBlur={(e) => saveReason(i, e.target.value)}
                    placeholder="—"
                    disabled={pending}
                    className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-sm text-neutral-200"
                  />
                </td>
                <td className="py-1.5 pl-3 text-right">
                  <button
                    onClick={() => run(() => unstageSongs([i.songId]))}
                    disabled={pending}
                    className="text-xs text-neutral-500 hover:text-neutral-200 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <label className="block text-sm text-neutral-300" htmlFor="intent">
          Why? <span className="text-neutral-500">Required. Recorded on every song this changes.</span>
        </label>
        <textarea
          id="intent"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          onBlur={() => intent !== (savedIntent ?? "") && void saveIntent(intent)}
          rows={2}
          placeholder="e.g. Place the October adds from the inbox"
          className="w-full max-w-2xl rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleApply}
          disabled={pending || !intent.trim() || items.length === 0}
          className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {pending ? "Working…" : `Apply ${items.length} ${items.length === 1 ? "change" : "changes"}`}
        </button>
        {confirmDiscard ? (
          <span className="flex items-center gap-2 text-sm text-neutral-300">
            Discard every staged change?
            <button
              onClick={() => run(discard)}
              disabled={pending}
              className="rounded border border-red-800 px-2 py-1 text-red-300 hover:bg-red-950"
            >
              Discard
            </button>
            <button onClick={() => setConfirmDiscard(false)} className="text-neutral-500 hover:text-neutral-200">
              Keep
            </button>
          </span>
        ) : (
          <button onClick={() => setConfirmDiscard(true)} disabled={pending} className="text-sm text-neutral-500 hover:text-neutral-200">
            Discard draft
          </button>
        )}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
    </div>
  );
}
