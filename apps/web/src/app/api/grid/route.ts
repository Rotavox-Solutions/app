import { NextResponse } from "next/server";
import { ChangesetError, GridSaveError, saveGrid, type GridCell } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";
import { changesetResponse, readJson } from "@/lib/changeset-http";

/** Save the week grid whole: { cells, expectedUpdatedAt, note? }. */
export const PUT = stationRoute("edit_format", async (request, { stationId, user }) => {
  const body = await readJson(request);
  const expected = typeof body.expectedUpdatedAt === "string" ? new Date(body.expectedUpdatedAt) : null;
  if (!Array.isArray(body.cells) || !expected || Number.isNaN(expected.getTime())) {
    return NextResponse.json({ error: "invalid", message: "Send the grid and the version you loaded." }, { status: 400 });
  }
  try {
    const result = await saveGrid(db, stationId, body.cells as GridCell[], {
      expectedUpdatedAt: expected,
      userId: user.id,
      note: typeof body.note === "string" ? body.note : null,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof GridSaveError) {
      return NextResponse.json({ error: "invalid", message: err.message, problems: err.problems }, { status: 400 });
    }
    if (err instanceof ChangesetError) return changesetResponse(() => Promise.reject(err));
    throw err;
  }
});
