"use client";

import { useState } from "react";
import { input, label, primaryButton, send } from "./api";
import { CopyLink } from "./CopyLink";

export function StaffInvite() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ link: string; note: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setLink(null);
    const { error, data } = await send<{ link: string; email: string }>("/api/staff/invites", "POST", { email });
    setPending(false);
    if (error) setError(error);
    else if (data) {
      setLink({
        link: data.link,
        note: `Send this to ${data.email}. It makes them Rotavox staff, with access to every station.`,
      });
      setEmail("");
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="flex max-w-xl items-end gap-3">
        <label className={`${label} flex-1`}>
          <span>Email</span>
          <input className={input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button className={primaryButton} disabled={pending}>
          Make staff invitation
        </button>
      </form>
      {link && <CopyLink link={link.link} note={link.note} />}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
