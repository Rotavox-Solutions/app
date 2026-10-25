import { renameUser } from "@rotavox/schema";
import { db } from "@/lib/db";
import { accountResponse, userRoute } from "@/lib/auth";
import { readJson } from "@/lib/changeset-http";

/** Update your own details: { name }. */
export const PATCH = userRoute(async (request, ctx) => {
  const body = await readJson(request);
  return accountResponse(() => renameUser(db, ctx.user.id, String(body.name ?? "")));
});
