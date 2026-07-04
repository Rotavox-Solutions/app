import { NextResponse } from "next/server";
import { applySwap, EditRejectedError } from "@/lib/log-edits";

export async function POST(request: Request, { params }: { params: Promise<{ logId: string }> }) {
  const { logId } = await params;
  const body = await request.json().catch(() => ({}));
  if (typeof body.itemIdA !== "string" || typeof body.itemIdB !== "string") {
    return NextResponse.json({ error: "itemIdA and itemIdB are required" }, { status: 400 });
  }

  try {
    const result = await applySwap(logId, body.itemIdA, body.itemIdB);
    return NextResponse.json({ items: result.items, logStatus: result.log.status });
  } catch (err) {
    if (err instanceof EditRejectedError) {
      return NextResponse.json({ error: err.reason }, { status: err.reason === "not_found" ? 404 : 400 });
    }
    throw err;
  }
}
