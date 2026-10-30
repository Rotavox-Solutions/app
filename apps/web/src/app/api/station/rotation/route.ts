import { NextResponse } from "next/server";
import { ChangesetError, GridSaveError, MAX_CYCLE_WEEKS, setRotation, stations } from "@rotavox/schema";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";
import { changesetResponse, readJson } from "@/lib/changeset-http";
import { epochForAiringWeek } from "@/lib/rotation";

/**
 * Change the rotation: { cycleWeeks, airingWeek (1-based), expectedUpdatedAt (the grid's), note? }.
 * The epoch is resolved here so "airing" matches what the engine will read.
 */
export const PUT = stationRoute("edit_format", async (request, { stationId, station, user }) => {
  const body = await readJson(request);
  const weeks = body.cycleWeeks;
  const airing = body.airingWeek;
  const expected = typeof body.expectedUpdatedAt === "string" ? new Date(body.expectedUpdatedAt) : null;
  if (
    !Number.isInteger(weeks) || (weeks as number) < 1 || (weeks as number) > MAX_CYCLE_WEEKS ||
    !Number.isInteger(airing) || (airing as number) < 1 || (airing as number) > (weeks as number) ||
    !expected || Number.isNaN(expected.getTime())
  ) {
    return NextResponse.json(
      { error: "invalid", message: `Choose 1 to ${MAX_CYCLE_WEEKS} weeks and which of them is airing.` },
      { status: 400 }
    );
  }
  const [row] = await db.select({ epoch: stations.formatCycleEpoch }).from(stations).where(eq(stations.id, stationId));
  const epoch = epochForAiringWeek(row?.epoch ?? null, weeks as number, (airing as number) - 1, station.timezone);
  try {
    return NextResponse.json(
      await setRotation(db, stationId, { cycleWeeks: weeks as number, epoch }, {
        expectedUpdatedAt: expected,
        userId: user.id,
        note: typeof body.note === "string" ? body.note : null,
      })
    );
  } catch (err) {
    if (err instanceof ChangesetError || err instanceof GridSaveError) return changesetResponse(() => Promise.reject(err));
    throw err;
  }
});
