import { NextResponse } from "next/server";
import { applySwap, EditRejectedError } from "@/lib/log-edits";
import { stationRoute } from "@/lib/auth";

export const POST = stationRoute<{ logId: string }>("edit_logs", async (request, { stationId }, { logId }) => {
  const body = await request.json().catch(() => ({}));
  if (typeof body.itemIdA !== "string" || typeof body.itemIdB !== "string") {
    return NextResponse.json({ error: "itemIdA and itemIdB are required" }, { status: 400 });
  }

  try {
    const result = await applySwap(stationId, logId, body.itemIdA, body.itemIdB);
    return NextResponse.json({ items: result.items, logStatus: result.log.status });
  } catch (err) {
    if (err instanceof EditRejectedError) {
      return NextResponse.json({ error: err.reason }, { status: err.reason === "not_found" ? 404 : 400 });
    }
    throw err;
  }
});
