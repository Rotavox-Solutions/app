import { NextResponse } from "next/server";
import { EditRejectedError, regenerateLogHours } from "@/lib/log-edits";
import { HorizonConflictError } from "@/lib/generation";
import { stationRoute } from "@/lib/auth";

/** Replaces a log, or the remaining hours of an airing one, with a freshly generated log. */
export const POST = stationRoute<{ logId: string }>("edit_logs", async (_request, { stationId }, { logId }) => {
  try {
    return NextResponse.json(await regenerateLogHours(stationId, logId), { status: 201 });
  } catch (err) {
    if (err instanceof EditRejectedError) {
      return NextResponse.json({ error: err.reason }, { status: err.reason === "not_found" ? 404 : 409 });
    }
    if (err instanceof HorizonConflictError) {
      return NextResponse.json({ error: "horizon_conflict", conflictingLogId: err.conflictingLogId }, { status: 409 });
    }
    throw err;
  }
});
