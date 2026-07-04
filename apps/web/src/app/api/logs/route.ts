import { NextResponse } from "next/server";
import { listLogs } from "@/lib/queries";
import { stationId } from "@/lib/station";

export async function GET() {
  const rows = await listLogs(stationId);
  return NextResponse.json(rows);
}
