import { revokeInvite } from "@rotavox/schema";
import { db } from "@/lib/db";
import { accountResponse, stationRoute } from "@/lib/auth";

/** Withdraw an invitation that hasn't been used. */
export const DELETE = stationRoute<{ inviteId: string }>(
  "manage_people",
  async (_request, { stationId }, { inviteId }) => accountResponse(() => revokeInvite(db, stationId, inviteId)),
);
