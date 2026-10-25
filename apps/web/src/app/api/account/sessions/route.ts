import { endAllSessions } from "@rotavox/schema";
import { db } from "@/lib/db";
import { accountResponse, userRoute } from "@/lib/auth";

/** Sign out every browser but this one. */
export const DELETE = userRoute(async (_request, ctx) =>
  accountResponse(() => endAllSessions(db, ctx.user.id, ctx.sessionId)),
);
