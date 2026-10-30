import { NextResponse } from "next/server";
import { validateClockDraft, type ClockDraft } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";
import { readJson } from "@/lib/changeset-http";
import { PREVIEW_MAX_HOURS, previewClock } from "@/lib/clock-preview";

/**
 * Generate the next hours with the saved clock and with a draft of it, in memory:
 * { draft, hours? }. Writes nothing. POST only because a draft is too big for a URL.
 */
export const POST = stationRoute<{ clockId: string }>("edit_format", async (request, { stationId }, { clockId }) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clockId)) {
    return NextResponse.json({ error: "not_found", message: "No such clock at this station." }, { status: 404 });
  }
  const body = await readJson(request);
  const draft = body.draft as ClockDraft | undefined;
  if (!draft || typeof draft !== "object") {
    return NextResponse.json({ error: "invalid", message: "Send the clock to preview." }, { status: 400 });
  }
  const hours = Number.isInteger(body.hours) ? Math.min(Math.max(body.hours as number, 1), PREVIEW_MAX_HOURS) : 6;
  const problems = await validateClockDraft(db, stationId, draft, clockId);
  if (problems.length) {
    return NextResponse.json({ error: "invalid", message: problems[0], problems }, { status: 400 });
  }
  const preview = await previewClock(stationId, clockId, draft, hours);
  if (!preview) return NextResponse.json({ error: "not_found", message: "No such clock at this station." }, { status: 404 });
  return NextResponse.json(preview);
});
