import { acceptInvite, createSession } from "@rotavox/schema";
import { db } from "@/lib/db";
import { accountResponse, publicRoute, setSessionCookie } from "@/lib/auth";
import { readJson } from "@/lib/changeset-http";

/** Use an invitation: { name, password } for a new account, { password } for an existing one. */
export const POST = publicRoute<{ token: string }>(async (request, { token }) => {
  const body = await readJson(request);
  return accountResponse(async () => {
    const { user, stationId } = await acceptInvite(db, token, {
      name: typeof body.name === "string" ? body.name : undefined,
      password: String(body.password ?? ""),
    });
    const session = await createSession(db, user.id, stationId);
    await setSessionCookie(request, session.token, session.expiresAt);
  });
});
