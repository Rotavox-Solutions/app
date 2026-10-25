import { listMembers, listPendingInvites, ROLE_DESCRIPTION, ROLE_LABEL, STATION_ROLES } from "@rotavox/schema";
import { db } from "@/lib/db";
import { allowed, requireStation } from "@/lib/auth";
import { fmtWhenShort } from "@/components/music/format";
import { PeopleManager } from "@/components/account/PeopleManager";

export default async function PeoplePage() {
  const ctx = await requireStation();
  if (!allowed(ctx, "manage_people")) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">People</h1>
        <p className="text-sm text-neutral-400">Only a station admin can manage who works at {ctx.station.name}.</p>
      </div>
    );
  }
  const tz = ctx.station.timezone;
  const [members, invites] = await Promise.all([listMembers(db, ctx.stationId), listPendingInvites(db, ctx.stationId)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">People</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          Who can sign in to {ctx.station.name}, and what they can do. Rotavox doesn&apos;t send email yet, so an
          invitation is a link for you to send.
        </p>
      </div>
      <PeopleManager
        canReset={ctx.user.isStaff}
        roles={STATION_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r], description: ROLE_DESCRIPTION[r] }))}
        members={members.map((m) => ({
          userId: m.userId,
          name: m.name,
          email: m.email,
          role: m.role,
          isStaff: m.isStaff,
          lastLogin: m.lastLoginAt ? fmtWhenShort(m.lastLoginAt, tz) : "never",
          isYou: m.userId === ctx.user.id,
        }))}
        invites={invites.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role ?? "",
          expires: fmtWhenShort(i.expiresAt, tz),
          invitedBy: i.invitedBy,
        }))}
      />
    </div>
  );
}
