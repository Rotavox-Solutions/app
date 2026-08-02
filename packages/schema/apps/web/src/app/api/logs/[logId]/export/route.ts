import { exportLog, type ExportFormat } from "@/lib/log-export";

/**
 * Tier-0 deliverable: the approved log as a file the station ingests itself.
 * GET /api/logs/{id}/export?format=m3u|csv
 */
export async function GET(request: Request, { params }: { params: Promise<{ logId: string }> }) {
  const { logId } = await params;
  const raw = new URL(request.url).searchParams.get("format") ?? "m3u";
  if (raw !== "m3u" && raw !== "csv") {
    return Response.json({ error: "format must be m3u or csv" }, { status: 400 });
  }
  const result = await exportLog(logId, raw as ExportFormat);
  if (!result) return Response.json({ error: "not_found" }, { status: 404 });

  return new Response(result.body, {
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
