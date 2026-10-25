import { createReset, RESET_HOURS } from "@rotavox/schema";
import { db } from "@/lib/db";
import { accountResponse, linkFor, userRoute } from "@/lib/auth";
import { readJson } from "@/lib/changeset-http";

/**
 * A password-reset link for someone locked out: { userId }. Staff only, since the link
 * opens that person's account at every station they work for.
 */
export const POST = userRoute(
  async (request, ctx) => {
    const body = await readJson(request);
    return accountResponse(async () => {
      const { token } = await createReset(db, { userId: String(body.userId ?? ""), createdBy: ctx.user.id });
      return { link: linkFor(request, `/reset/${token}`), hours: RESET_HOURS };
    });
  },
  { staff: true },
);
