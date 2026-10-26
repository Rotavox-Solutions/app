"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { input, primaryButton, secondaryButton, send } from "@/components/account/api";

export interface RunnerKeyView {
  id: string;
  label: string;
  created: string;
  lastUsed: string;
  version: string | null;
}

/** Keys for this station's Runner, and making a new one. Station admins and staff only. */
export function RunnerKeys({ keys, apiUrl }: { keys: RunnerKeyView[]; apiUrl: string }) {
  const router = useRouter();
  const [label, setLabel] = useState("Broadcast box");
  const [made, setMade] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const envLines = made ? `ROTAVOX_API_URL=${apiUrl}\nROTAVOX_RUNNER_KEY=${made}` : "";

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setCopied(false);
    const { error, data } = await send<{ key: string }>("/api/station/runner-keys", "POST", { label });
    setPending(false);
    if (error) setError(error);
    else if (data) {
      setMade(data.key);
      router.refresh();
    }
  }

  async function revoke(id: string) {
    setPending(true);
    const { error } = await send(`/api/station/runner-keys/${id}`, "DELETE");
    setPending(false);
    setConfirmRevoke(null);
    if (error) setError(error);
    else router.refresh();
  }

  return (
    <div className="max-w-3xl space-y-3">
      {keys.length > 0 && (
        <ul className="divide-y divide-neutral-900 text-sm">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span>
                <span className="text-neutral-100">{k.label}</span>
                <span className="ml-2 text-xs text-neutral-500">
                  made {k.created} · last used {k.lastUsed}
                  {k.version && ` · Runner ${k.version}`}
                </span>
              </span>
              {confirmRevoke === k.id ? (
                <span className="inline-flex gap-2">
                  <button
                    className="rounded bg-red-800 px-3 py-1 text-sm text-white hover:bg-red-700"
                    disabled={pending}
                    onClick={() => revoke(k.id)}
                  >
                    Revoke: the Runner stops reaching Rotavox
                  </button>
                  <button className={secondaryButton} onClick={() => setConfirmRevoke(null)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button className={secondaryButton} disabled={pending} onClick={() => setConfirmRevoke(k.id)}>
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={create} className="flex flex-wrap items-end gap-3">
        <label className="block min-w-56 flex-1 space-y-1 text-sm text-neutral-300">
          <span>Name for a new key</span>
          <input className={input} required value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <button className={primaryButton} disabled={pending}>
          Make a Runner key
        </button>
      </form>
      {made && (
        <div className="space-y-2 rounded border border-blue-900/60 bg-blue-950/20 p-4">
          <p className="text-sm text-neutral-300">
            Put these two lines in <code className="text-neutral-100">apps\runner\.env</code> on the broadcast box, then
            restart the Rotavox services. The Runner then reaches Rotavox through this key instead of the database.
          </p>
          <pre className="overflow-x-auto rounded bg-neutral-950 px-3 py-2 text-xs text-neutral-200">{envLines}</pre>
          <button
            type="button"
            className={secondaryButton}
            onClick={async () => {
              await navigator.clipboard.writeText(envLines).catch(() => {});
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <p className="text-xs text-neutral-500">
            This is the only time the key is shown. Anyone who has it can act as this station&apos;s Runner, so keep it
            in that file and nowhere else. Revoke it here if it leaks.
          </p>
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
