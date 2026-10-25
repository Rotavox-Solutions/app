import { changePassword, endAllSessions } from "@rotavox/schema";
import { db } from "@/lib/db";
import { accountResponse, userRoute } from "@/lib/auth";
import { readJson } from "@/lib/changeset-http";

/** Change your password: { current, next }. Every other browser is signed out. */
export const POST = userRoute(async (request, ctx) => {
  const body = await readJson(request);
  return accountResponse(async () => {
    await changePassword(db, ctx.user.id, String(body.current ?? ""), String(body.next ?? ""));
    await endAllSessions(db, ctx.user.id, ctx.sessionId);
  });
});
