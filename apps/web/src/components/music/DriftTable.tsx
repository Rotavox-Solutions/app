"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DriftRow } from "@rotavox/schema";
import { stage } from "./changes-client";
import { fmtStateIn } from "./format";

/**
 * Songs changed in RadioDJ directly. Each can go either way, and neither side is
 * overwritten without a choice (ADR-0002 §4.4): keep RadioDJ's filing (staged like any
 * change), or put RadioDJ back in line with Rotavox (written by the Runner).
 */
export function DriftTable({
  rows,
  categoryNames,
  readOnly = false,
}: {
  rows: DriftRow[];
  categoryNames: Record<string, string>;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const name = (id: string | null) => (id ? categoryNames[id] ?? "?" : null);
  const where = (p: { state: string; categoryId: string | null }) => fmtStateIn(p.state, name(p.categoryId));

  async function accept(targets: DriftRow[]) {
    const ok = targets.filter((r) => r.canAccept);
    if (!ok.length) return;
    setPending(true);
    setMessage(null);
    const err = await stage(
      ok.map((r) => ({
        songId: r.songId,
        state: r.radiodj.state,
        categoryId: r.radiodj.categoryId,
        reason: "Accepted RadioDJ's filing (changed in RadioDJ directly)",
      }))
    );
    setPending(false);
    if (err) setMessage({ ok: false, text: err });
    else {
      setMessage({ ok: true, text: `Staged ${ok.length}. Review and apply them under Changes.` });
      setSelected(new Set());
      router.refresh();
    }
  }

  async function reproject(targets: DriftRow[]) {
    const ok = targets.filter((r) => r.canReproject);
    if (!ok.length) return;
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/drift/reproject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songIds: ok.map((r) => r.songId) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMessage({ ok: false, text: data.message ?? `Request failed (${res.status})` });
      else {
        setMessage({
          ok: true,
          text: data.blocked
            ? `Queued ${data.songs}, but an earlier write to RadioDJ failed and holds the line. Retry it under Changes.`
            : `Queued ${data.songs}. The Runner writes ${data.songs === 1 ? "it" : "them"} back to RadioDJ within a minute or so.`,
        });
        setSelected(new Set());
        router.refresh();
      }
    } catch {
      setMessage({ ok: false, text: "Request failed — is the Cockpit reachable?" });
    }
    setPending(false);
  }

  const chosen = rows.filter((r) => selected.has(r.songId));
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.songId));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const button = "rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-900 disabled:opacity-40";

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-400">
          {selected.size} selected
          <button onClick={() => accept(chosen)} disabled={pending || !chosen.some((r) => r.canAccept)} className={button}>
            Keep RadioDJ&apos;s filing
          </button>
          <button onClick={() => reproject(chosen)} disabled={pending || !chosen.some((r) => r.canReproject)} className={button}>
            Put RadioDJ back
          </button>
        </div>
      )}
      {message && <p className={`text-sm ${message.ok ? "text-emerald-300" : "text-red-400"}`}>{message.text}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-neutral-400">
              {!readOnly && (
                <th className="w-8 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.songId)))}
                    aria-label="Select all"
                  />
                </th>
              )}
              <th className="py-2 font-medium">Song</th>
              <th className="py-2 font-medium">Rotavox has it</th>
              <th className="py-2 font-medium">RadioDJ has it</th>
              {!readOnly && <th className="py-2 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.songId} className="border-b border-neutral-900">
                {!readOnly && (
                  <td className="py-1.5">
                    <input type="checkbox" checked={selected.has(r.songId)} onChange={() => toggle(r.songId)} aria-label={`Select ${r.artist ?? ""} ${r.title ?? ""}`} />
                  </td>
                )}
                <td className="py-1.5">
                  <a href={`/music/library/${r.songId}`} className="hover:underline">
                    {r.artist ?? "—"} · {r.title ?? "—"}
                  </a>
                  {r.staged && <span className="ml-2 text-xs uppercase tracking-wide text-sky-300">staged</span>}
                </td>
                <td className="py-1.5">{where(r.rotavox)}</td>
                <td className="py-1.5">
                  <span className="text-amber-200">{r.rdjSubcatName ?? `subcategory ${r.rdjSubcat}`}</span>
                  <span className="block text-xs text-neutral-500">
                    {r.canAccept ? `means ${where(r.radiodj)}` : "not a Rotavox pool"}
                  </span>
                </td>
                {!readOnly && (
                  <td className="whitespace-nowrap py-1.5 text-right">
                    <button
                      onClick={() => accept([r])}
                      disabled={pending || !r.canAccept}
                      className={button}
                      title={r.canAccept ? "Stage this as a change in Rotavox" : "RadioDJ's subcategory isn't one of Rotavox's pools"}
                    >
                      Keep RadioDJ&apos;s
                    </button>{" "}
                    <button
                      onClick={() => reproject([r])}
                      disabled={pending || !r.canReproject}
                      className={button}
                      title={r.canReproject ? "Have the Runner move it back in RadioDJ" : "RadioDJ has no subcategory for where Rotavox has it"}
                    >
                      Put RadioDJ back
                    </button>
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
