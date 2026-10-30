"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PoolLifecycleRow } from "@/lib/library";

type Field = "restReviewDays" | "ladderRank" | "fallingAfterDays" | "promoteAfterDays" | "benchAfterUnairedDays";
type RefField = "restExitCategoryId" | "promoteToCategoryId";

async function save(categoryId: string, field: Field | RefField, value: number | string | null): Promise<string | null> {
  try {
    const res = await fetch(`/api/categories/${categoryId}/lifecycle`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data.message ?? data.error ?? `Request failed (${res.status})`;
  } catch {
    return "Request failed — is the Cockpit reachable?";
  }
}

function NumberCell({
  row,
  field,
  unit,
  label,
  readOnly,
}: {
  row: PoolLifecycleRow;
  field: Field;
  unit?: string;
  label: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const saved = row[field] == null ? "" : String(row[field]);
  const [value, setValue] = useState(saved);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (readOnly) {
    return <>{row[field] == null ? <span className="text-neutral-600">—</span> : `${row[field]}${unit ? ` ${unit}` : ""}`}</>;
  }

  const submit = async () => {
    const trimmed = value.trim();
    setPending(true);
    setError(null);
    const err = await save(row.id, field, trimmed === "" ? null : Number(trimmed));
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
        placeholder="—"
        aria-label={`${label} for ${row.name}`}
        className="w-16 rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-right text-sm tabular-nums text-neutral-100"
      />
      {unit && <span className="text-neutral-500">{unit}</span>}
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

/** A pool picker that saves as soon as it changes. */
function RefCell({
  row,
  field,
  pools,
  none,
  label,
  readOnly,
}: {
  row: PoolLifecycleRow;
  field: RefField;
  pools: { id: string; name: string }[];
  none: string;
  label: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = row[field];
  if (readOnly) {
    return <>{value ? pools.find((p) => p.id === value)?.name ?? "?" : <span className="text-neutral-600">{none}</span>}</>;
  }
  return (
    <span className="flex items-center gap-2">
      <select
        value={value ?? ""}
        disabled={pending}
        aria-label={`${label} for ${row.name}`}
        onChange={async (e) => {
          setPending(true);
          setError(null);
          const err = await save(row.id, field, e.target.value || null);
          setPending(false);
          if (err) setError(err);
          else router.refresh();
        }}
        className="max-w-[10rem] rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-sm text-neutral-100 disabled:opacity-50"
      >
        <option value="">{none}</option>
        {pools
          .filter((p) => p.id !== row.id)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}

/** What each pool's songs are suggested to do next (standing lifecycle rules). Suggestions only. */
export function PoolMoveSettings({ rows, readOnly = false }: { rows: PoolLifecycleRow[]; readOnly?: boolean }) {
  const pools = rows.map((r) => ({ id: r.id, name: r.name }));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-neutral-400">
            <th className="py-2 font-medium">Pool</th>
            <th className="py-2 font-medium" title="Where a song leaving rest from this pool is suggested to go, once its standard rest is up.">
              Leaves rest to
            </th>
            <th className="py-2 font-medium" title="After this long active in the pool, suggest moving the song on.">
              Moves on to
            </th>
            <th className="py-2 font-medium">after</th>
            <th className="py-2 font-medium" title="An active song that hasn't aired in this long is suggested for the bench.">
              Bench if unaired for
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-neutral-900">
              <td className="py-1.5">
                {r.name}
                {r.group && <span className="ml-2 text-xs text-neutral-500">{r.group}</span>}
              </td>
              <td className="py-1.5">
                <RefCell row={r} field="restExitCategoryId" pools={pools} none="back to this pool" label="Leaves rest to" readOnly={readOnly} />
              </td>
              <td className="py-1.5">
                <RefCell row={r} field="promoteToCategoryId" pools={pools} none="—" label="Moves on to" readOnly={readOnly} />
              </td>
              <td className="py-1.5">
                <NumberCell row={r} field="promoteAfterDays" unit="days" label="Moves on after" readOnly={readOnly} />
              </td>
              <td className="py-1.5">
                <NumberCell row={r} field="benchAfterUnairedDays" unit="days" label="Bench if unaired for" readOnly={readOnly} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Each music pool's lifecycle settings. None moves a song: the rest standard decides when a
 * resting song comes up for review; the ladder rank and falling-after time decide what is
 * shown as rising or falling (ADR-0002 §3, §6.2).
 */
export function PoolLifecycleSettings({ rows, readOnly = false }: { rows: PoolLifecycleRow[]; readOnly?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-neutral-400">
            <th className="py-2 font-medium">Pool</th>
            <th className="py-2 font-medium" title="1 = hottest. Blank = not on the currents ladder.">
              Ladder rank
            </th>
            <th className="py-2 font-medium" title="Active this long in the pool and a song counts as falling.">
              Falling after
            </th>
            <th className="py-2 font-medium" title="Resting this long and a song comes up for review.">
              Standard rest
            </th>
            <th className="py-2 text-right font-medium">Falling</th>
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
                <NumberCell row={r} field="ladderRank" label="Ladder rank" readOnly={readOnly} />
              </td>
              <td className="py-1.5">
                <NumberCell row={r} field="fallingAfterDays" unit="days" label="Falling after" readOnly={readOnly} />
              </td>
              <td className="py-1.5">
                <NumberCell row={r} field="restReviewDays" unit="days" label="Standard rest" readOnly={readOnly} />
              </td>
              <td className={`py-1.5 text-right tabular-nums ${r.falling ? "text-orange-300" : "text-neutral-400"}`}>
                {r.falling || "—"}
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
