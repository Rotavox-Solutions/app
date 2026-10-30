import { NextResponse } from "next/server";
import { validateRules, type RuleDraft } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";
import { readJson } from "@/lib/changeset-http";
import { PREVIEW_MAX_HOURS } from "@/lib/clock-preview";
import { previewRules } from "@/lib/rules-preview";

/** Generate the next hours with the saved rules and a draft of them, in memory: { rules, hours? }. Writes nothing. */
export const POST = stationRoute("edit_format", async (request, { stationId }) => {
  const body = await readJson(request);
  if (!Array.isArray(body.rules)) {
    return NextResponse.json({ error: "invalid", message: "Send the rules to preview." }, { status: 400 });
  }
  const drafts = body.rules as RuleDraft[];
  const hours = Number.isInteger(body.hours) ? Math.min(Math.max(body.hours as number, 1), PREVIEW_MAX_HOURS) : 24;
  const problems = await validateRules(db, stationId, drafts);
  if (problems.length) return NextResponse.json({ error: "invalid", message: problems[0], problems }, { status: 400 });
  return NextResponse.json(await previewRules(stationId, drafts, hours));
});
