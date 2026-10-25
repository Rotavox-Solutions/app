"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { input, label, primaryButton, secondaryButton, send } from "./api";
import { CopyLink } from "./CopyLink";

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  role: string;
  isStaff: boolean;
  lastLogin: string;
  isYou: boolean;
}

export interface InviteView {
  id: string;
  email: string;
  role: string;
  expires: string;
  invitedBy: string | null;
}

export function PeopleManager({
  members,
  invites,
  roles,
  canReset,
}: {
  members: MemberView[];
  invites: InviteView[];
  roles: { value: string; label: string; description: string }[];
  /** Staff only: make a password-reset link for someone locked out. */
  canReset: boolean;
}) {
  const router = useRouter();
  const roleLabel = new Map(roles.map((r) => [r.value, r.label]));
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("programmer");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ link: string; note: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  async function run(op: () => Promise<{ error: string | null; data: Record<string, unknown> | null }>) {
    setPending(true);
    setError(null);
    const { error, data } = await op();
    setPending(false);
    if (error) setError(error);
    else router.refresh();
    return data;
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setLink(null);
    const data = await run(() => send("/api/station/people", "POST", { email, role }));
    if (data) {
      setLink({
        link: String(data.link),
        note: `Send this link to ${data.email}. It invites them as ${roleLabel.get(role)} and expires in 7 days.`,
      });
      setEmail("");
    }
  }

  async function reset(m: MemberView) {
    setLink(null);
    const data = await run(() => send("/api/staff/reset", "POST", { userId: m.userId }));
    if (data) {
      setLink({
        link: String(data.link),
        note: `Send this to ${m.name} (${m.email}). It lets them set a new password within ${data.hours} hours.`,
      });
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Invite someone</h2>
        <form onSubmit={invite} className="flex max-w-2xl flex-wrap items-end gap-3">
          <label className={`${label} min-w-56 flex-1`}>
            <span>Email</span>
            <input className={input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className={label}>
            <span>Role</span>
            <select className={input} value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button className={primaryButton} disabled={pending}>
            Make invitation link
          </button>
        </form>
        <ul className="max-w-2xl space-y-1 text-xs text-neutral-500">
          {roles.map((r) => (
            <li key={r.value}>
              <span className="text-neutral-400">{r.label}:</span> {r.description}
            </li>
          ))}
        </ul>
        {link && <CopyLink link={link.link} note={link.note} />}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">People at this station</h2>
        <table className="w-full max-w-4xl text-sm">
          <thead className="text-left text-xs text-neutral-500">
            <tr>
              <th className="py-1 font-normal">Name</th>
              <th className="py-1 font-normal">Role</th>
              <th className="py-1 font-normal">Last signed in</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {members.map((m) => (
              <tr key={m.userId}>
                <td className="py-2">
                  <div className="text-neutral-100">
                    {m.name}
                    {m.isYou && <span className="ml-2 text-xs text-neutral-500">you</span>}
                    {m.isStaff && <span className="ml-2 text-xs text-sky-400">Rotavox staff</span>}
                  </div>
                  <div className="text-xs text-neutral-500">{m.email}</div>
                </td>
                <td className="py-2">
                  <select
                    aria-label={`Role for ${m.name}`}
                    className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-sm"
                    value={m.role}
                    disabled={pending}
                    onChange={(e) =>
                      run(() => send("/api/station/people", "PATCH", { userId: m.userId, role: e.target.value }))
                    }
                  >
                    {roles.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 text-neutral-400">{m.lastLogin}</td>
                <td className="py-2 text-right">
                  <span className="inline-flex gap-2">
                    {canReset && !m.isYou && (
                      <button className={secondaryButton} disabled={pending} onClick={() => reset(m)}>
                        Reset link
                      </button>
                    )}
                    {confirmRemove === m.userId ? (
                      <>
                        <button
                          className="rounded bg-red-800 px-3 py-1 text-sm text-white hover:bg-red-700"
                          disabled={pending}
                          onClick={async () => {
                            await run(() => send("/api/station/people", "DELETE", { userId: m.userId }));
                            setConfirmRemove(null);
                          }}
                        >
                          {m.isYou ? "Leave the station" : `Remove ${m.name.split(" ")[0]}`}
                        </button>
                        <button className={secondaryButton} onClick={() => setConfirmRemove(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <button className={secondaryButton} disabled={pending} onClick={() => setConfirmRemove(m.userId)}>
                        Remove
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {invites.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Invitations not yet used</h2>
          <ul className="max-w-4xl divide-y divide-neutral-900 text-sm">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-4 py-2">
                <span>
                  <span className="text-neutral-100">{i.email}</span>
                  <span className="ml-2 text-neutral-400">{roleLabel.get(i.role) ?? i.role}</span>
                  <span className="ml-2 text-xs text-neutral-500">
                    {i.invitedBy ? `from ${i.invitedBy}, ` : ""}expires {i.expires}
                  </span>
                </span>
                <button
                  className={secondaryButton}
                  disabled={pending}
                  onClick={() => run(() => send(`/api/station/invites/${i.id}`, "DELETE"))}
                >
                  Withdraw
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-neutral-500">
            A lost link can't be shown again. Invite the same email again to replace it.
          </p>
        </section>
      )}
    </div>
  );
}
