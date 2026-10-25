"use client";

import { useState } from "react";
import { input, label, primaryButton, send } from "./api";

/**
 * The form behind an invitation or reset link. A new person picks a name and password;
 * someone who already has an account confirms with theirs; a reset sets a new one.
 */
export function TokenForm({
  url,
  mode,
  email,
  minLength,
}: {
  url: string;
  mode: "new_account" | "existing_account" | "reset";
  email: string;
  minLength: number;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choosing = mode !== "existing_account";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (choosing && password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setPending(true);
    setError(null);
    const { error } = await send(url, "POST", mode === "new_account" ? { name, password } : { password });
    if (error) {
      setError(error);
      setPending(false);
    } else {
      window.location.href = "/today";
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      {mode === "new_account" && (
        <label className={label}>
          <span>Your name</span>
          <input
            className={input}
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}
      <label className={label}>
        <span>{mode === "existing_account" ? "Your Rotavox password" : "Choose a password"}</span>
        <input
          className={input}
          type="password"
          autoComplete={choosing ? "new-password" : "current-password"}
          minLength={choosing ? minLength : undefined}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {choosing && (
          <span className="text-xs text-neutral-500">
            At least {minLength} characters. A phrase of a few words works well.
          </span>
        )}
      </label>
      {choosing && (
        <label className={label}>
          <span>Type it again</span>
          <input
            className={input}
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button className={primaryButton} disabled={pending}>
        {pending
          ? "One moment…"
          : mode === "reset"
            ? "Set password and sign in"
            : mode === "existing_account"
              ? "Accept and sign in"
              : "Create account"}
      </button>
    </form>
  );
}
