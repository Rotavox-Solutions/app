import { NextResponse } from "next/server";
import { generateNextHours, HorizonConflictError } from "@/lib/generation";
import { stationRoute } from "@/lib/auth";

export const POST = stationRoute("edit_logs", async (request, { stationId }) => {
  const body = await request.json().catch(() => ({}));
  const hours = typeof body.hours === "number" ? body.hours : 24;
  const start = typeof body.start === "string" ? new Date(body.start) : undefined;

  try {
    const result = await generateNextHours(stationId, hours, { start });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof HorizonConflictError) {
      return NextResponse.json({ error: "horizon_conflict", conflictingLogId: err.conflictingLogId }, { status: 409 });
    }
    throw err;
  }
});
