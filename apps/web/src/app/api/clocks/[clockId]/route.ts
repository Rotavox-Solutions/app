import { NextResponse } from "next/server";
import { ChangesetError, ClockSaveError, deleteClock, saveClock, type ClockDraft } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";
import { changesetResponse, readJson } from "@/lib/changeset-http";

/** Save a clock whole: { draft, expectedUpdatedAt, note? }. Refused with every problem listed if it doesn't validate. */
export const PUT = stationRoute<{ clockId: string }>("edit_format", async (request, { stationId, user }, { clockId }) => {
  const body = await readJson(request);
  const draft = body.draft as ClockDraft | undefined;
  const expected = typeof body.expectedUpdatedAt === "string" ? new Date(body.expectedUpdatedAt) : null;
  if (!draft || typeof draft !== "object" || !expected || Number.isNaN(expected.getTime())) {
    return NextResponse.json({ error: "invalid", message: "Send the clock and the version you loaded." }, { status: 400 });
  }
  try {
    const result = await saveClock(db, stationId, clockId, draft, {
      expectedUpdatedAt: expected,
      userId: user.id,
      note: typeof body.note === "string" ? body.note : null,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ClockSaveError) {
      return NextResponse.json({ error: "invalid", message: err.message, problems: err.problems }, { status: 400 });
    }
    if (err instanceof ChangesetError) return changesetResponse(() => Promise.reject(err));
    throw err;
  }
});

/** Delete a clock the week grid doesn't play. */
export const DELETE = stationRoute<{ clockId: string }>("edit_format", async (_request, { stationId }, { clockId }) =>
  changesetResponse(() => deleteClock(db, stationId, clockId))
);
