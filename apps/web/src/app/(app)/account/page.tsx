import { listAccessibleStations, MIN_PASSWORD_LENGTH, ROLE_LABEL } from "@rotavox/schema";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { NameForm, PasswordForm, SignOutOthers } from "@/components/account/AccountForms";

export default async function AccountPage() {
  const ctx = await requireSession();
  const stations = await listAccessibleStations(db, ctx.user);
  const memberships = stations.filter((s) => s.role);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Your account</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {ctx.user.email}
          {ctx.user.isStaff && <span className="ml-2 text-sky-400">Rotavox staff</span>}
        </p>
      </div>

      <section className="space-y-3">
        <NameForm name={ctx.user.name} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Stations</h2>
        {memberships.length === 0 ? (
          <p className="text-sm text-neutral-400">
            {ctx.user.isStaff
              ? "You aren't a member of any station; as staff you can open all of them."
              : "You don't work at any station yet."}
          </p>
        ) : (
          <ul className="text-sm text-neutral-300">
            {memberships.map((s) => (
              <li key={s.id}>
                {s.name} <span className="text-neutral-500">· {ROLE_LABEL[s.role!]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Password</h2>
        <PasswordForm minLength={MIN_PASSWORD_LENGTH} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Signed-in browsers</h2>
        <p className="max-w-2xl text-sm text-neutral-400">
          Signing in keeps a browser signed in for 30 days. If you signed in somewhere you shouldn&apos;t stay signed
          in, sign out everywhere else.
        </p>
        <SignOutOthers />
      </section>
    </div>
  );
}
