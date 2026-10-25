import { createInvite } from "@rotavox/schema";
import { db } from "@/lib/db";
import { accountResponse, linkFor, userRoute } from "@/lib/auth";
import { readJson } from "@/lib/changeset-http";

/** Invite someone to Rotavox staff: { email }. */
export const POST = userRoute(
  async (request, ctx) => {
    const body = await readJson(request);
    return accountResponse(async () => {
      const { token, invite } = await createInvite(db, {
        email: String(body.email ?? ""),
        stationId: null,
        role: null,
        isStaff: true,
        createdBy: ctx.user.id,
      });
      return { link: linkFor(request, `/invite/${token}`), email: invite.email, expiresAt: invite.expiresAt };
    });
  },
  { staff: true },
);
