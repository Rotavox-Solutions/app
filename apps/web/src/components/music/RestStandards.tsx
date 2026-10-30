"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RestStandardRow } from "@/lib/library";

async function save(categoryId: string, days: number | null): Promise<string | null> {
  try {
    const res = await fetch(`/api/categories/${categoryId}/rest-standard`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data.message ?? data.error ?? `Request failed (${res.status})`;
  } catch {
    return "Request failed — is the Cockpit reachable?";
  }
}

function StandardCell({ row, readOnly }: { row: RestStandardRow; readOnly: boolean }) {
  const router = useRouter();
  const saved = row.restReviewDays == null ? "" : String(row.restReviewDays);
  const [value, setValue] = useState(saved);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (readOnly) return <>{row.restReviewDays == null ? <span className="text-neutral-600">none</span> : `${row.restReviewDays}d`}</>;

  const submit = async () => {
    const trimmed = value.trim();
    setPending(true);
    setError(null);
    const err = await save(row.id, trimmed === "" ? null : Number(trimmed));
    setPending(false);
    if (err) setError(err);
    else router.refresh();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-center gap-2"
    >
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="none"
        aria-label={`Standard rest for ${row.name}, in days`}
        className="w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-right text-sm tabular-nums text-neutral-100"
      />
      <span className="text-neutral-500">days</span>
      {value.trim() !== saved && (
        <button
          disabled={pending}
          className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
        >
          Save
        </button>
      )}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </form>
  );
}

/** Each music pool's standard rest (ADR-0002 §6.2). Blank means its resting songs are never prompted. */
export function RestStandards({ rows, readOnly = false }: { rows: RestStandardRow[]; readOnly?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-neutral-400">
            <th className="py-2 font-medium">Pool</th>
            <th className="py-2 font-medium">Standard rest</th>
            <th className="py-2 text-right font-medium">Resting</th>
            <th className="py-2 text-right font-medium">Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-neutral-900">
              <td className="py-1.5">
                <a href={`/music/categories/${r.id}`} className="hover:underline">
                  {r.name}
                </a>
                {r.group && <span className="ml-2 text-xs text-neutral-500">{r.group}</span>}
              </td>
              <td className="py-1.5">
                <StandardCell row={r} readOnly={readOnly} />
              </td>
              <td className="py-1.5 text-right tabular-nums text-neutral-400">{r.resting || "—"}</td>
              <td className={`py-1.5 text-right tabular-nums ${r.due ? "text-amber-300" : "text-neutral-400"}`}>
                {r.due || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
