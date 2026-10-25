import { NextResponse } from "next/server";
import { getAsRunReport } from "@/lib/queries";
import { stationRoute } from "@/lib/auth";

export const GET = stationRoute("view", async (request, { stationId }) => {
  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const rows = await getAsRunReport(stationId, {
    from: fromParam ? new Date(fromParam) : undefined,
    to: toParam ? new Date(toParam) : undefined,
  });
  return NextResponse.json(rows);
});
