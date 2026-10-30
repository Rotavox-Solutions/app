"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const field = "rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100";

async function call(url: string, method: string, body?: unknown): Promise<{ error: string | null; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { error: res.ok ? null : data.message ?? data.error ?? `Request failed (${res.status})`, data };
  } catch {
    return { error: "Request failed — is the Cockpit reachable?", data: {} };
  }
}

/** A new clock, blank or copied from one that exists. */
export function NewClock({ clocks }: { clocks: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setPending(true);
    setError(null);
    const { error, data } = await call("/api/clocks", "POST", { name, copyFromClockId: copyFrom || null });
    setPending(false);
    if (error) setError(error);
    else router.push(`/format/clocks/${data.id}`);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        create();
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New clock name" className={`${field} w-48`} />
      <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className={field} aria-label="Start from">
        <option value="">Start blank</option>
        {clocks.map((c) => (
          <option key={c.id} value={c.id}>
            Copy of {c.name}
          </option>
        ))}
      </select>
      <button
        disabled={pending || !name.trim()}
        className="rounded border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
      >
        Create clock
      </button>
      {error && <span className="text-sm text-red-400">{error}</span>}
    </form>
  );
}

/** Delete, for a clock the grid doesn't play. Two clicks, no browser dialog. */
export function DeleteClock({ clockId, name }: { clockId: string; name: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    const { error } = await call(`/api/clocks/${clockId}`, "DELETE");
    setPending(false);
    if (error) setError(error);
    else router.push("/format/clocks");
  }

  return (
    <span className="flex items-center gap-2 text-sm">
      {armed ? (
        <>
          <button onClick={remove} disabled={pending} className="rounded bg-red-800 px-3 py-1 text-white hover:bg-red-700 disabled:opacity-50">
            Delete {name} for good
          </button>
          <button onClick={() => setArmed(false)} className="text-neutral-400 hover:text-neutral-200">
            Keep it
          </button>
        </>
      ) : (
        <button onClick={() => setArmed(true)} className="text-red-400 hover:text-red-300">
          Delete clock…
        </button>
      )}
      {error && <span className="text-red-400">{error}</span>}
    </span>
  );
}
