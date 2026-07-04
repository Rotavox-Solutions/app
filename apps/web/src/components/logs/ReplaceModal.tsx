"use client";

import { useEffect, useState } from "react";
import type { SongSearchResult } from "@/lib/queries";

interface Props {
  logId: string;
  itemId: string;
  categoryId: string | null;
  onClose: () => void;
  onReplaced: () => void;
}

export function ReplaceModal({ logId, itemId, categoryId, onClose, onReplaced }: Props) {
  const [scopeToCategory, setScopeToCategory] = useState(categoryId != null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SongSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (scopeToCategory && categoryId) params.set("categoryId", categoryId);
    if (q) params.set("q", q);
    setLoading(true);
    fetch(`/api/songs/search?${params.toString()}`)
      .then((r) => r.json())
      .then((rows) => setResults(rows))
      .finally(() => setLoading(false));
  }, [q, scopeToCategory, categoryId]);

  async function pick(songId: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/logs/${logId}/items/${itemId}/replace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Replace failed");
        return;
      }
      onReplaced();
    } catch {
      setError("Request failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-lg border border-neutral-800 bg-neutral-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Replace song</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300">
            ✕
          </button>
        </div>

        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search artist or title…"
          className="mb-2 w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm"
        />
        {categoryId && (
          <label className="mb-2 flex items-center gap-2 text-xs text-neutral-400">
            <input type="checkbox" checked={scopeToCategory} onChange={(e) => setScopeToCategory(e.target.checked)} />
            Scope to this position&apos;s category pool
          </label>
        )}

        {error && <p className="mb-2 text-sm text-red-400">{error}</p>}

        <div className="max-h-72 overflow-y-auto">
          {loading && <p className="text-sm text-neutral-500">Searching…</p>}
          {!loading &&
            results.map((s) => (
              <button
                key={s.id}
                disabled={submitting}
                onClick={() => pick(s.id)}
                className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-800 disabled:opacity-50"
              >
                <span className="text-neutral-100">{s.artist ?? "?"}</span>
                <span className="text-neutral-500"> — {s.title ?? "?"}</span>
              </button>
            ))}
          {!loading && results.length === 0 && <p className="text-sm text-neutral-500">No matches.</p>}
        </div>
      </div>
    </div>
  );
}
