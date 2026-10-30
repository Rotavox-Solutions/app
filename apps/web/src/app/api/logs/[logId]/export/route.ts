import { NextResponse } from "next/server";
import { stationRoute } from "@/lib/auth";
import { exportLog, type ExportFormat } from "@/lib/log-export";

/**
 * Download a log for a station that loads logs into its own playout system (tier 0):
 * ?format=csv (default) or ?format=m3u.
 */
export const GET = stationRoute<{ logId: string }>("view", async (request, { stationId }, { logId }) => {
  const format = (new URL(request.url).searchParams.get("format") ?? "csv") as ExportFormat;
  if (format !== "csv" && format !== "m3u") {
    return NextResponse.json({ error: "invalid", message: "Choose csv or m3u." }, { status: 400 });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(logId)) {
    return NextResponse.json({ error: "not_found", message: "No such log at this station." }, { status: 404 });
  }
  const file = await exportLog(stationId, logId, format);
  if (!file) return NextResponse.json({ error: "not_found", message: "No such log at this station." }, { status: 404 });
  return new NextResponse(file.body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
