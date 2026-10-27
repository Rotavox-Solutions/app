import { NextResponse } from "next/server";
import { getLogDetail } from "@/lib/queries";
import { deleteLogHours, EditRejectedError } from "@/lib/log-edits";
import { stationRoute } from "@/lib/auth";

export const GET = stationRoute<{ logId: string }>("view", async (_request, { stationId }, { logId }) => {
  const detail = await getLogDetail(stationId, logId);
  if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(detail);
});

/** Deletes a log, or the remaining hours of an approved one already reaching the Runner. */
export const DELETE = stationRoute<{ logId: string }>("edit_logs", async (_request, { stationId }, { logId }) => {
  try {
    return NextResponse.json(await deleteLogHours(stationId, logId));
  } catch (err) {
    if (err instanceof EditRejectedError) {
      return NextResponse.json({ error: err.reason }, { status: err.reason === "not_found" ? 404 : 409 });
    }
    throw err;
  }
});
