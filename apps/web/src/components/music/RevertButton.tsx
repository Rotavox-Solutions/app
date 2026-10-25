"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { revert } from "./changes-client";

/** Drafts the undo; it is reviewed and applied on the Changes page like anything else. */
export function RevertButton({ changesetId }: { changesetId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={async () => {
          setPending(true);
          setError(null);
          const err = await revert(changesetId);
          setPending(false);
          if (err) setError(err);
          else {
            router.push("/music/changes");
            router.refresh();
          }
        }}
        disabled={pending}
        className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-900 disabled:opacity-50"
      >
        {pending ? "Drafting…" : "Undo"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
