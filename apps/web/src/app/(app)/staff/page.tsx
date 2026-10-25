import { listAccessibleStations, listStaff } from "@rotavox/schema";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { StaffInvite } from "@/components/account/StaffInvite";
import { StationPicker } from "@/components/account/StationPicker";

export default async function StaffPage() {
  const ctx = await requireSession();
  if (!ctx.user.isStaff) {
    return <p className="text-sm text-neutral-400">This page is for Rotavox staff.</p>;
  }
  const [staff, stations] = await Promise.all([listStaff(db), listAccessibleStations(db, ctx.user)]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Rotavox staff</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          Staff can open every station with a station admin&apos;s powers, and make password-reset links from a
          station&apos;s People page.
        </p>
      </div>
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Stations</h2>
        <StationPicker
          currentId={ctx.station?.id ?? null}
          stations={stations.map((s) => ({ id: s.id, name: s.name, role: "" }))}
        />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Staff</h2>
        <ul className="text-sm text-neutral-300">
          {staff.map((s) => (
            <li key={s.id}>
              {s.name} <span className="text-neutral-500">· {s.email}</span>
            </li>
          ))}
        </ul>
        <StaffInvite />
      </section>
    </div>
  );
}
