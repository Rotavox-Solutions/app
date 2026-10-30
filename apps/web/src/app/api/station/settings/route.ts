import { setStationName } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";
import { changesetResponse, readJson } from "@/lib/changeset-http";

/** Rename the station: { name }. */
export const PUT = stationRoute("manage_station", async (request, { stationId }) => {
  const body = await readJson(request);
  return changesetResponse(() => setStationName(db, stationId, typeof body.name === "string" ? body.name : ""));
});
