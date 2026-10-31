import { listAccessibleStations, ROLE_LABEL } from "@rotavox/schema";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { StationPicker } from "@/components/account/StationPicker";

export default async function StationsPage() {
  const ctx = await requireSession();
  const stations = await listAccessibleStations(db, ctx.user);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Stations</h1>
      {stations.length === 0 ? (
        <p className="max-w-xl text-sm text-neutral-400">
          {ctx.user.isStaff
            ? "There are no stations yet. Set one up from the Staff page."
            : "Your account isn't part of any station right now. Ask your station admin to invite you again."}
        </p>
      ) : (
        <StationPicker
          currentId={ctx.station?.id ?? null}
          stations={stations.map((s) => ({ id: s.id, name: s.name, role: s.role ? ROLE_LABEL[s.role] : "" }))}
        />
      )}
    </div>
  );
}
