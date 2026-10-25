import { createSession, useReset } from "@rotavox/schema";
import { db } from "@/lib/db";
import { accountResponse, publicRoute, setSessionCookie } from "@/lib/auth";
import { readJson } from "@/lib/changeset-http";

/** Set a new password from a reset link: { password }. Signs out every other browser. */
export const POST = publicRoute<{ token: string }>(async (request, { token }) => {
  const body = await readJson(request);
  return accountResponse(async () => {
    const user = await useReset(db, token, String(body.password ?? ""));
    const session = await createSession(db, user.id);
    await setSessionCookie(request, session.token, session.expiresAt);
  });
});
