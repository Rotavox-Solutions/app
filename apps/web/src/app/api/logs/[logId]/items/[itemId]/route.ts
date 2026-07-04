import { NextResponse } from "next/server";
import { setLocked, EditRejectedError } from "@/lib/log-edits";

export async function PATCH(request: Request, { params }: { params: Promise<{ logId: string; itemId: string }> }) {
  const { logId, itemId } = await params;
  const body = await request.json().catch(() => ({}));
  if (typeof body.locked !== "boolean") {
    return NextResponse.json({ error: "locked (boolean) is required" }, { status: 400 });
  }

  try {
    const result = await setLocked(logId, itemId, body.locked);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EditRejectedError) {
      return NextResponse.json({ error: err.reason }, { status: err.reason === "not_found" ? 404 : 400 });
    }
    throw err;
  }
}
