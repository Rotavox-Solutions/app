"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Summary {
  imported: number;
  changed: number;
  byState: Record<string, number>;
  unassigned: number;
}

/**
 * The one-time handover of pools to Rotavox: preview first, then import. After it,
 * pools are edited here and RadioDJ follows.
 */
export function ImportMembership() {
  const router = useRouter();
  const [preview, setPreview] = useState<Summary | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(apply: boolean) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/station/import-membership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.message ?? "Import failed");
      else if (apply) router.refresh();
      else setPreview(data);
    } catch {
      setError("Request failed — is the Cockpit reachable?");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      {!preview ? (
        <button
          onClick={() => call(false)}
          disabled={pending}
          className="rounded border border-neutral-700 px-3 py-1 font-medium text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
        >
          {pending ? "Reading the library…" : "Preview the import"}
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-neutral-300">
            {preview.imported} songs would be placed from their RadioDJ subcategories:
          </p>
          <ul className="space-y-0.5 text-neutral-400">
            {Object.entries(preview.byState)
              .sort()
              .map(([state, n]) => (
                <li key={state}>
                  {n} {state}
                </li>
              ))}
          </ul>
          {preview.unassigned > 0 && (
            <p className="text-amber-300">
              {preview.unassigned} would have no pool — their subcategory isn&apos;t mapped. They&apos;ll wait in the
              Inbox.
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={() => call(true)}
              disabled={pending}
              className="rounded bg-blue-700 px-3 py-1 font-medium text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {pending ? "Importing…" : `Import ${preview.imported} songs`}
            </button>
            <button onClick={() => setPreview(null)} disabled={pending} className="text-neutral-500 hover:text-neutral-200">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}
