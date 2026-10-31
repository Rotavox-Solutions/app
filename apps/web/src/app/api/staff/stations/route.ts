import { createStation, switchStation, type Playout } from "@rotavox/schema";
import { db } from "@/lib/db";
import { userRoute } from "@/lib/auth";
import { changesetResponse, readJson } from "@/lib/changeset-http";

/** Set up a station: { name, timezone, playout }. The staff member then works on it. */
export const POST = userRoute(
  async (request, ctx) => {
    const body = await readJson(request);
    return changesetResponse(async () => {
      const station = await createStation(db, {
        name: String(body.name ?? ""),
        timezone: String(body.timezone ?? ""),
        playout: String(body.playout ?? "") as Playout,
      });
      await switchStation(db, ctx, station.id);
      return station;
    });
  },
  { staff: true },
);
