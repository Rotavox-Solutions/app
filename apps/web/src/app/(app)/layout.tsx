import type { ReactNode } from "react";
import { getDraft, listAccessibleStations, ROLE_LABEL, type Permission } from "@rotavox/schema";
import { db } from "@/lib/db";
import { allowed, requireSession } from "@/lib/auth";
import { getInboxCount } from "@/lib/music-edits";
import { getDriftCount } from "@/lib/drift";
import { Sidebar } from "@/components/shell/Sidebar";

const SHOWN_PERMISSIONS = ["manage_people", "staff"] as const satisfies readonly Permission[];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireSession();
  const stationId = ctx.station?.id;
  const [inbox, drift, draft, stations] = await Promise.all([
    stationId ? getInboxCount(stationId) : 0,
    stationId ? getDriftCount(stationId) : 0,
    stationId ? getDraft(db, stationId) : null,
    listAccessibleStations(db, ctx.user),
  ]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:flex-row md:gap-10 md:px-6 md:py-8">
      <aside className="md:w-44 md:shrink-0">
        <Sidebar
          station={ctx.station ? { id: ctx.station.id, name: ctx.station.name, playout: ctx.station.playout } : null}
          stations={stations.map((s) => ({ id: s.id, name: s.name }))}
          user={{
            name: ctx.user.name,
            role: ctx.user.isStaff ? "Rotavox staff" : ctx.role ? ROLE_LABEL[ctx.role] : "",
          }}
          permissions={SHOWN_PERMISSIONS.filter((p) => allowed(ctx, p))}
          counts={{ inbox, drift, changes: draft?.items.length ?? 0 }}
        />
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
