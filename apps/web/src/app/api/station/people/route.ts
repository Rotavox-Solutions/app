import {
  AccountError,
  createInvite,
  removeMember,
  setMemberRole,
  STATION_ROLES,
  type StationRole,
} from "@rotavox/schema";
import { db } from "@/lib/db";
import { accountResponse, linkFor, stationRoute } from "@/lib/auth";
import { readJson } from "@/lib/changeset-http";

function role(value: unknown): StationRole {
  if (typeof value !== "string" || !STATION_ROLES.includes(value as StationRole)) {
    throw new AccountError("invalid", "Pick a role.");
  }
  return value as StationRole;
}

/** Invite someone: { email, role }. Returns the link to send them; it is shown only now. */
export const POST = stationRoute("manage_people", async (request, { stationId, user }) => {
  const body = await readJson(request);
  return accountResponse(async () => {
    const { token, invite } = await createInvite(db, {
      email: String(body.email ?? ""),
      stationId,
      role: role(body.role),
      createdBy: user.id,
    });
    return { link: linkFor(request, `/invite/${token}`), email: invite.email, expiresAt: invite.expiresAt };
  });
});

/** Change someone's role: { userId, role }. */
export const PATCH = stationRoute("manage_people", async (request, { stationId }) => {
  const body = await readJson(request);
  return accountResponse(() => setMemberRole(db, stationId, String(body.userId ?? ""), role(body.role)));
});

/** Remove someone from the station: { userId }. Their account stays, for any other station. */
export const DELETE = stationRoute("manage_people", async (request, { stationId }) => {
  const body = await readJson(request);
  return accountResponse(() => removeMember(db, stationId, String(body.userId ?? "")));
});
