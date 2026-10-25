"use client";

import { useState } from "react";
import { input, label, primaryButton, send } from "./api";

/** Only a same-site path, so a crafted ?next= can't send someone elsewhere after signing in. */
function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/today";
}

export function LoginForm({ next }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await send("/api/auth/login", "POST", { email, password });
    if (error) {
      setError(error);
      setPending(false);
    } else {
      window.location.href = safeNext(next);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className={label}>
        <span>Email</span>
        <input
          className={input}
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className={label}>
        <span>Password</span>
        <input
          className={input}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button className={primaryButton} disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
