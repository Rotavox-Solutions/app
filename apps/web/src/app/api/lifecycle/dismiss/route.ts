import { NextResponse } from "next/server";
import { SUGGESTION_RULES, type SuggestionRule } from "@rotavox/schema";
import { stationRoute } from "@/lib/auth";
import { readJson } from "@/lib/changeset-http";
import { DISMISS_DAYS, dismissSuggestion } from "@/lib/suggestions";

/** Set a suggested move aside for a while: { songId, rule }. */
export const POST = stationRoute("edit_music", async (request, { stationId, user }) => {
  const body = await readJson(request);
  const songId = typeof body.songId === "string" ? body.songId : "";
  const rule = body.rule as SuggestionRule;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(songId) || !SUGGESTION_RULES.includes(rule)) {
    return NextResponse.json({ error: "invalid", message: "Send a song and a rule." }, { status: 400 });
  }
  try {
    await dismissSuggestion(stationId, songId, rule, user.id);
  } catch {
    return NextResponse.json({ error: "not_found", message: "No such song at this station." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, days: DISMISS_DAYS });
});
