import { getAsRunReport } from "@/lib/queries";
import { stationId } from "@/lib/station";
import { AsRunTable } from "@/components/reports/AsRunTable";

// Live ops view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function AsRunReportPage() {
  const rows = await getAsRunReport(stationId);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">As-Run Report — Legal ID / TOH elements</h1>
      <p className="text-sm text-neutral-500">
        Scheduled vs. actual air time for each hour&apos;s top-of-hour element. Reporting only — no compliance
        guarantee (that&apos;s M5).
      </p>
      <AsRunTable rows={rows} />
    </div>
  );
}
