import { switchStation } from "@rotavox/schema";
import { db } from "@/lib/db";
import { accountResponse, userRoute } from "@/lib/auth";
import { readJson } from "@/lib/changeset-http";

/** Work on another station: { stationId }. */
export const POST = userRoute(async (request, ctx) => {
  const body = await readJson(request);
  return accountResponse(() => switchStation(db, ctx, String(body.stationId ?? "")));
});
