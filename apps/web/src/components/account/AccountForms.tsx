"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { input, label, primaryButton, secondaryButton, send } from "./api";

export function NameForm({ name: saved }: { name: string }) {
  const router = useRouter();
  const [name, setName] = useState(saved);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const { error } = await send("/api/account", "PATCH", { name });
    setPending(false);
    setStatus(error ?? "Saved.");
    if (!error) router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex max-w-md items-end gap-3">
      <label className={`${label} flex-1`}>
        <span>Name</span>
        <input className={input} required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button className={secondaryButton} disabled={pending || name.trim() === saved}>
        Save
      </button>
      {status && <span className="pb-1 text-sm text-neutral-400">{status}</span>}
    </form>
  );
}

export function PasswordForm({ minLength }: { minLength: number }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setStatus({ ok: false, text: "The two new passwords don't match." });
      return;
    }
    setPending(true);
    const { error } = await send("/api/account/password", "POST", { current, next });
    setPending(false);
    if (error) setStatus({ ok: false, text: error });
    else {
      setStatus({ ok: true, text: "Password changed. Any other browser signed in as you has been signed out." });
      setCurrent("");
      setNext("");
      setConfirm("");
    }
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-3">
      <label className={label}>
        <span>Current password</span>
        <input
          className={input}
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </label>
      <label className={label}>
        <span>New password</span>
        <input
          className={input}
          type="password"
          autoComplete="new-password"
          minLength={minLength}
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <span className="text-xs text-neutral-500">At least {minLength} characters.</span>
      </label>
      <label className={label}>
        <span>New password again</span>
        <input
          className={input}
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      {status && <p className={`text-sm ${status.ok ? "text-neutral-300" : "text-red-400"}`}>{status.text}</p>}
      <button className={primaryButton} disabled={pending}>
        Change password
      </button>
    </form>
  );
}

export function SignOutOthers() {
  const [status, setStatus] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-3">
      <button
        className={secondaryButton}
        onClick={async () => {
          const { error } = await send("/api/account/sessions", "DELETE");
          setStatus(error ?? "Every other browser has been signed out.");
        }}
      >
        Sign out everywhere else
      </button>
      {status && <span className="text-sm text-neutral-400">{status}</span>}
    </span>
  );
}
