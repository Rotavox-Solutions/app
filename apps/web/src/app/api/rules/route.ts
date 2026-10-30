import { NextResponse } from "next/server";
import { ChangesetError, RulesSaveError, saveRules, type RuleDraft } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";
import { changesetResponse, readJson } from "@/lib/changeset-http";

/** Save the station's rules whole: { rules, expectedUpdatedAt, note? }. */
export const PUT = stationRoute("edit_format", async (request, { stationId, user }) => {
  const body = await readJson(request);
  const expected = typeof body.expectedUpdatedAt === "string" ? new Date(body.expectedUpdatedAt) : null;
  if (!Array.isArray(body.rules) || !expected || Number.isNaN(expected.getTime())) {
    return NextResponse.json({ error: "invalid", message: "Send the rules and the version you loaded." }, { status: 400 });
  }
  try {
    const result = await saveRules(db, stationId, body.rules as RuleDraft[], {
      expectedUpdatedAt: expected,
      userId: user.id,
      note: typeof body.note === "string" ? body.note : null,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RulesSaveError) {
      return NextResponse.json({ error: "invalid", message: err.message, problems: err.problems }, { status: 400 });
    }
    if (err instanceof ChangesetError) return changesetResponse(() => Promise.reject(err));
    throw err;
  }
});
