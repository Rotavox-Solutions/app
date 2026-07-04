import { NextResponse } from "next/server";
import { applyReplace, EditRejectedError } from "@/lib/log-edits";

export async function POST(request: Request, { params }: { params: Promise<{ logId: string; itemId: string }> }) {
  const { logId, itemId } = await params;
  const body = await request.json().catch(() => ({}));
  if (typeof body.songId !== "string") {
    return NextResponse.json({ error: "songId is required" }, { status: 400 });
  }

  try {
    const result = await applyReplace(logId, itemId, body.songId);
    return NextResponse.json({ item: result.item, logStatus: result.log.status });
  } catch (err) {
    if (err instanceof EditRejectedError) {
      return NextResponse.json({ error: err.reason }, { status: err.reason === "not_found" ? 404 : 400 });
    }
    throw err;
  }
}
