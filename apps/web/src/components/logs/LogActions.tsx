"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DisplayStatus } from "@/lib/log-edits";

const ERROR_LABEL: Record<string, string> = {
  nothing_remaining: "Nothing left to change: every remaining hour is already pushed or within 15 minutes of air.",
  changed: "The log changed while regenerating. Try again.",
  horizon_conflict: "Another log already covers those hours.",
  not_found: "This log no longer exists.",
};

/**
 * Delete or regenerate a log. For an airing log both act on its remaining hours only:
 * from the first top of the hour that is past the 15-minute safety horizon and past
 * everything already pushed to RadioDJ.
 */
export function LogActions({ logId, displayStatus }: { logId: string; displayStatus: DisplayStatus }) {
  const router = useRouter();
  const [pending, setPending] = useState<"delete" | "regenerate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (displayStatus === "aired") return null;

  const airing = displayStatus === "airing";
  const scope = airing ? " remaining hours" : "";

  async function run(action: "delete" | "regenerate") {
    const what = airing
      ? `${action === "delete" ? "Delete" : "Regenerate"} this log's remaining hours? Hours already pushed to RadioDJ, ` +
        "or within 15 minutes of air, stay as they are." +
        (action === "delete" ? " The station falls back to AutoDJ after the cut until another log is approved." : "")
      : `${action === "delete" ? "Delete" : "Regenerate"} this log? Locked items are not carried over.` +
        (action === "regenerate" && displayStatus === "approved" ? " The new log is a draft and needs approving." : "");
    if (!window.confirm(what)) return;

    setPending(action);
    setError(null);
    try {
      const res = await fetch(action === "delete" ? `/api/logs/${logId}` : `/api/logs/${logId}/regenerate`, {
        method: action === "delete" ? "DELETE" : "POST",
      });
      const body = await res.json();
      if (!res.ok) {
        setError(ERROR_LABEL[body.error] ?? body.error ?? "Request failed");
        return;
      }
      if (action === "regenerate") router.push(`/logs/${body.generated.logId}`);
      else if (body.whole) router.push("/logs");
      else router.refresh(); // the header shows the log's new end
    } catch {
      setError("Request failed");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="ml-auto flex items-center gap-2">
      {error && <span className="text-sm text-red-400">{error}</span>}
      <button
        onClick={() => run("regenerate")}
        disabled={pending !== null}
        className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-40"
      >
        {pending === "regenerate" ? "Regenerating…" : `Regenerate${scope}`}
      </button>
      <button
        onClick={() => run("delete")}
        disabled={pending !== null}
        className="rounded border border-red-900 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950 disabled:opacity-40"
      >
        {pending === "delete" ? "Deleting…" : `Delete${scope}`}
      </button>
    </div>
  );
}
