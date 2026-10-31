import { setPlayout, type Playout } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";
import { changesetResponse, readJson } from "@/lib/changeset-http";

/** Change how the station's logs reach air: { playout: "radiodj" | "file" }. Rotavox staff only. */
export const PUT = stationRoute("staff", async (request, { stationId }) => {
  const body = await readJson(request);
  return changesetResponse(() => setPlayout(db, stationId, String(body.playout ?? "") as Playout));
});
