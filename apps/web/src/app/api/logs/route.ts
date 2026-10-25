import { NextResponse } from "next/server";
import { listLogs } from "@/lib/queries";
import { stationRoute } from "@/lib/auth";

export const GET = stationRoute("view", async (_request, { stationId }) =>
  NextResponse.json(await listLogs(stationId)),
);
