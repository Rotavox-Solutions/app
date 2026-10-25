import { createSession, signIn } from "@rotavox/schema";
import { db } from "@/lib/db";
import { accountResponse, publicRoute, setSessionCookie } from "@/lib/auth";
import { readJson } from "@/lib/changeset-http";

/** Sign in: { email, password }. */
export const POST = publicRoute(async (request) => {
  const body = await readJson(request);
  return accountResponse(async () => {
    const user = await signIn(db, String(body.email ?? ""), String(body.password ?? ""));
    const { token, expiresAt } = await createSession(db, user.id);
    await setSessionCookie(request, token, expiresAt);
  });
});
