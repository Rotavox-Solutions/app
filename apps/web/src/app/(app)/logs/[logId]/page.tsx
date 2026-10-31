import { notFound } from "next/navigation";
import { getLogDetail } from "@/lib/queries";
import { LogTimeline } from "@/components/logs/LogTimeline";
import { allowed, requireStation } from "@/lib/auth";

// Live ops view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

/** The hour in the station's own time zone, whatever the server's is: "Sat, Oct 31, 2:00 PM – 3:00 PM". */
function fmtHour(start: Date, end: Date, timeZone: string): string {
  const day = { timeZone, weekday: "short", month: "short", day: "numeric" } as const;
  const time = { timeZone, hour: "numeric", minute: "2-digit" } as const;
  const sameDay = start.toLocaleDateString("en-US", day) === end.toLocaleDateString("en-US", day);
  return `${start.toLocaleString("en-US", { ...day, ...time })} – ${
    sameDay ? end.toLocaleTimeString("en-US", time) : end.toLocaleString("en-US", { ...day, ...time })
  }`;
}

export default async function LogDetailPage({ params }: { params: Promise<{ logId: string }> }) {
  const ctx = await requireStation();
  const { stationId } = ctx;
  const { logId } = await params;
  const detail = await getLogDetail(stationId, logId);
  if (!detail) notFound();

  return (
    <div className="space-y-4">
      <div>
        <a href="/logs" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Logs
        </a>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold">
            {fmtHour(new Date(detail.log.startsAt), new Date(detail.log.endsAt), ctx.station.timezone)}
          </h1>
          <span className="flex items-center gap-2 text-sm">
            <span className="text-neutral-500">{detail.log.status === "draft" ? "Download draft:" : "Download:"}</span>
            <a
              href={`/api/logs/${detail.log.id}/export?format=csv`}
              className="rounded border border-neutral-700 px-3 py-1 text-neutral-200 hover:bg-neutral-900"
              title="One row per item in air order, with station-local times, for playout systems that import a schedule"
            >
              CSV
            </a>
            <a
              href={`/api/logs/${detail.log.id}/export?format=m3u`}
              className="rounded border border-neutral-700 px-3 py-1 text-neutral-200 hover:bg-neutral-900"
              title="A playlist of file paths, for playout systems that load a playlist"
            >
              M3U
            </a>
          </span>
        </div>
      </div>
      <LogTimeline
        timezone={ctx.station.timezone}
        readOnly={!allowed(ctx, "edit_logs")}
        logId={detail.log.id}
        logStatus={detail.log.status as "draft" | "approved"}
        displayStatus={detail.displayStatus}
        items={detail.items}
      />
    </div>
  );
}
