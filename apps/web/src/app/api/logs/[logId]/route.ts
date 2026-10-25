import { NextResponse } from "next/server";
import { getLogDetail } from "@/lib/queries";
import { stationRoute } from "@/lib/auth";

export const GET = stationRoute<{ logId: string }>("view", async (_request, { stationId }, { logId }) => {
  const detail = await getLogDetail(stationId, logId);
  if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(detail);
});
