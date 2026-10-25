"use client";

import { useState } from "react";
import { secondaryButton } from "./api";

/** A one-time link just made: shown once, with a copy button, since it is never stored. */
export function CopyLink({ link, note }: { link: string; note: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded border border-blue-900/60 bg-blue-950/20 p-4">
      <p className="text-sm text-neutral-300">{note}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-neutral-950 px-2 py-1 text-xs text-neutral-200">
          {link}
        </code>
        <button
          type="button"
          className={secondaryButton}
          onClick={async () => {
            await navigator.clipboard.writeText(link).catch(() => {});
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        This is the only time the link is shown. It works once. Anyone who has it can use it, so send it privately.
      </p>
    </div>
  );
}
