import { listLogs } from "@/lib/queries";
import { stationId } from "@/lib/station";
import { LogsTable } from "@/components/logs/LogsTable";
import { GenerateControl } from "@/components/logs/GenerateControl";

// Live ops view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function LogsPage() {
  const logs = await listLogs(stationId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Logs</h1>
        <GenerateControl />
      </div>
      <LogsTable logs={logs} />
    </div>
  );
}
