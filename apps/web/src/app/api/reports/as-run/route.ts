import { NextResponse } from "next/server";
import { getAsRunReport } from "@/lib/queries";
import { stationId } from "@/lib/station";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const rows = await getAsRunReport(stationId, {
    from: fromParam ? new Date(fromParam) : undefined,
    to: toParam ? new Date(toParam) : undefined,
  });
  return NextResponse.json(rows);
}
