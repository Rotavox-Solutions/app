"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** A button that asks the Runner (or the API) for something, then refreshes the page. */
export function RunnerButton({
  url,
  body,
  label,
  pendingLabel = "Asking…",
  disabled,
  variant = "secondary",
}: {
  url: string;
  body?: unknown;
  label: string;
  pendingLabel?: string;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const style =
    variant === "primary"
      ? "bg-blue-700 text-white hover:bg-blue-600"
      : "border border-neutral-700 text-neutral-200 hover:bg-neutral-900";
  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body ?? {}),
            });
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              setError(data.message ?? data.error ?? `Request failed (${res.status})`);
            } else {
              router.refresh();
            }
          } catch {
            setError("Request failed — is the Cockpit reachable?");
          } finally {
            setPending(false);
          }
        }}
        disabled={pending || disabled}
        className={`rounded px-3 py-1 text-sm font-medium disabled:opacity-50 ${style}`}
      >
        {pending ? pendingLabel : label}
      </button>
      {error && <span className="text-sm text-red-400">{error}</span>}
    </span>
  );
}
