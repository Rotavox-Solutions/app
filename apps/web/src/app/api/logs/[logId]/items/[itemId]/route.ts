import { NextResponse } from "next/server";
import { setLocked, EditRejectedError } from "@/lib/log-edits";
import { stationRoute } from "@/lib/auth";

export const PATCH = stationRoute<{ logId: string; itemId: string }>(
  "edit_logs",
  async (request, { stationId }, { logId, itemId }) => {
    const body = await request.json().catch(() => ({}));
    if (typeof body.locked !== "boolean") {
      return NextResponse.json({ error: "locked (boolean) is required" }, { status: 400 });
    }

    try {
      const result = await setLocked(stationId, logId, itemId, body.locked);
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof EditRejectedError) {
        return NextResponse.json({ error: err.reason }, { status: err.reason === "not_found" ? 404 : 400 });
      }
      throw err;
    }
  },
);
