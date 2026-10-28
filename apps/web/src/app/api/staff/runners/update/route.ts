import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { enqueueJob, stations } from "@rotavox/schema";
import { db } from "@/lib/db";
import { userRoute } from "@/lib/auth";
import { readJson } from "@/lib/changeset-http";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Asks a station's Runner to update itself to the commit Rotavox runs: { stationId }.
 * Staff only. The station is named in the request, unlike station routes, because the
 * staff console works across stations.
 */
export const POST = userRoute(
  async (request, ctx) => {
    const body = await readJson(request);
    const stationId = String(body.stationId ?? "");
    const [station] = UUID.test(stationId)
      ? await db.select({ id: stations.id }).from(stations).where(eq(stations.id, stationId))
      : [];
    if (!station) return NextResponse.json({ error: "not_found", message: "No such station." }, { status: 404 });
    const job = await enqueueJob(db, station.id, "update_runner", "ui", ctx.user.id);
    return NextResponse.json({ jobId: job.id, status: job.status });
  },
  { staff: true },
);
