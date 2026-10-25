import { NextResponse } from "next/server";
import { approveLog, EditRejectedError } from "@/lib/log-edits";
import { stationRoute } from "@/lib/auth";

export const POST = stationRoute<{ logId: string }>("edit_logs", async (_request, { stationId }, { logId }) => {
  try {
    const result = await approveLog(stationId, logId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EditRejectedError) {
      return NextResponse.json({ error: err.reason }, { status: err.reason === "not_found" ? 404 : 400 });
    }
    throw err;
  }
});
