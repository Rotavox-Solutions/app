import { NextResponse } from "next/server";
import { getLogDetail } from "@/lib/queries";

export async function GET(_request: Request, { params }: { params: Promise<{ logId: string }> }) {
  const { logId } = await params;
  const detail = await getLogDetail(logId);
  if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(detail);
}
