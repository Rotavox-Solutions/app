"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function GenerateControl() {
  const router = useRouter();
  const [hours, setHours] = useState(24);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/logs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (body.error === "horizon_conflict") {
          setError(`Overlaps existing log ${body.conflictingLogId}`);
        } else {
          setError(body.error ?? "Generation failed");
        }
        return;
      }
      router.refresh();
    } catch {
      setError("Request failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <label className="text-sm text-neutral-400">
        Generate next
        <input
          type="number"
          min={1}
          max={168}
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          className="mx-2 w-16 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
        />
        hours
      </label>
      <button
        onClick={handleGenerate}
        disabled={pending}
        className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
      >
        {pending ? "Generating…" : "Generate"}
      </button>
      {error && <span className="text-sm text-red-400">{error}</span>}
    </div>
  );
}
