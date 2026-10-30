"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SuggestionRow } from "@/lib/suggestions";
import { stage } from "./changes-client";
import { fmtStateIn } from "./format";

const RULE_LABEL: Record<string, string> = {
  rest_exit: "Rest is up",
  bench: "Not airing",
  falling: "Falling",
  promote: "Moves on",
};

/**
 * Moves the standing lifecycle rules suggest. Staging one puts it in the draft with its
 * reason, to review and apply like any change; dismissing sets it aside for a while.
 */
export function SuggestionsTable({
  rows,
  categoryNames,
  dismissDays,
  readOnly = false,
}: {
  rows: SuggestionRow[];
  categoryNames: Record<string, string>;
  dismissDays: number;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const where = (p: { state: string; categoryId: string | null }) =>
    fmtStateIn(p.state, p.categoryId ? categoryNames[p.categoryId] ?? "?" : null);

  async function accept(targets: SuggestionRow[]) {
    const open = targets.filter((r) => !r.staged);
    if (!open.length) return;
    setPending(true);
    setError(null);
    const err = await stage(open.map((r) => ({ songId: r.songId, state: r.to.state, categoryId: r.to.categoryId, reason: r.why })));
    setPending(false);
    if (err) setError(err);
    else {
      setSelected(new Set());
      router.refresh();
    }
  }

  async function dismiss(r: SuggestionRow) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/lifecycle/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songId: r.songId, rule: r.rule }),
      });
      if (!res.ok) setError((await res.json().catch(() => ({}))).message ?? `Request failed (${res.status})`);
      else router.refresh();
    } catch {
      setError("Request failed — is the Cockpit reachable?");
    }
    setPending(false);
  }

  const open = rows.filter((r) => !r.staged);
  const chosen = open.filter((r) => selected.has(r.songId));
  const allSelected = open.length > 0 && open.every((r) => selected.has(r.songId));
  const button = "rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-900 disabled:opacity-40";

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-400">
          {chosen.length} selected
          <button onClick={() => accept(chosen)} disabled={pending || chosen.length === 0} className={button}>
            Stage selected
          </button>
          {rows.some((r) => r.staged) && (
            <a href="/music/changes" className="text-neutral-300 hover:underline">
              review staged changes →
            </a>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-neutral-400">
              {!readOnly && (
                <th className="w-8 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(open.map((r) => r.songId)))}
                    aria-label="Select all"
                  />
                </th>
              )}
              <th className="py-2 font-medium">Song</th>
              <th className="py-2 font-medium">Why</th>
              <th className="py-2 font-medium">Suggested</th>
              {!readOnly && <th className="py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.songId} className="border-b border-neutral-900">
                {!readOnly && (
                  <td className="py-1.5">
                    {!r.staged && (
                      <input
                        type="checkbox"
                        checked={selected.has(r.songId)}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(r.songId)) next.delete(r.songId);
                            else next.add(r.songId);
                            return next;
                          })
                        }
                        aria-label={`Select ${r.artist ?? ""} ${r.title ?? ""}`}
                      />
                    )}
                  </td>
                )}
                <td className="py-1.5">
                  <a href={`/music/library/${r.songId}`} className="hover:underline">
                    {r.artist ?? "—"} · {r.title ?? "—"}
                  </a>
                </td>
                <td className="py-1.5">
                  <span className="mr-2 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-300">{RULE_LABEL[r.rule] ?? r.rule}</span>
                  <span className="text-neutral-400">{r.why}</span>
                </td>
                <td className="whitespace-nowrap py-1.5">
                  <span className="text-neutral-500">{where(r.from)}</span> → {where(r.to)}
                </td>
                {!readOnly && (
                  <td className="whitespace-nowrap py-1.5 text-right">
                    {r.staged ? (
                      <span className="text-xs uppercase tracking-wide text-sky-300">staged</span>
                    ) : (
                      <>
                        <button onClick={() => accept([r])} disabled={pending} className={button}>
                          Stage
                        </button>{" "}
                        <button
                          onClick={() => dismiss(r)}
                          disabled={pending}
                          className="text-xs text-neutral-500 hover:text-neutral-300"
                          title={`Hide this suggestion for ${dismissDays} days`}
                        >
                          Not now
                        </button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
