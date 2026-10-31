import { listLogs } from "@/lib/queries";
import { LogsTable } from "@/components/logs/LogsTable";
import { GenerateControl } from "@/components/logs/GenerateControl";
import { allowed, requireStation } from "@/lib/auth";

// Live ops view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function LogsPage() {
  const ctx = await requireStation();
  const { stationId } = ctx;
  const logs = await listLogs(stationId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Logs</h1>
        {allowed(ctx, "edit_logs") && <GenerateControl />}
      </div>
      <LogsTable logs={logs} timezone={ctx.station.timezone} />
    </div>
  );
}
