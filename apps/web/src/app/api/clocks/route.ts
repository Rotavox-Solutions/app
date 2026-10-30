import { createClock } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";
import { changesetResponse, readJson } from "@/lib/changeset-http";

/** A new clock: { name, copyFromClockId? }. */
export const POST = stationRoute("edit_format", async (request, { stationId }) => {
  const body = await readJson(request);
  return changesetResponse(() =>
    createClock(db, stationId, {
      name: typeof body.name === "string" ? body.name : "",
      copyFromClockId: typeof body.copyFromClockId === "string" ? body.copyFromClockId : null,
    })
  );
});
