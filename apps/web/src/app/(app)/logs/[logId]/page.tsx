import { notFound } from "next/navigation";
import { getLogDetail } from "@/lib/queries";
import { LogTimeline } from "@/components/logs/LogTimeline";
import { allowed, requireStation } from "@/lib/auth";

// Live ops view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

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
        <h1 className="text-xl font-semibold">
          {new Date(detail.log.startsAt).toLocaleString()} – {new Date(detail.log.endsAt).toLocaleString()}
        </h1>
      </div>
      <LogTimeline
        readOnly={!allowed(ctx, "edit_logs")}
        logId={detail.log.id}
        logStatus={detail.log.status as "draft" | "approved"}
        displayStatus={detail.displayStatus}
        items={detail.items}
      />
    </div>
  );
}
