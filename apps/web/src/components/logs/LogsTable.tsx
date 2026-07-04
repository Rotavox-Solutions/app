import type { LogListRow } from "@/lib/queries";
import { StatusBadge, ViolationBadge } from "./ViolationBadge";

function fmt(date: Date | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function LogsTable({ logs }: { logs: LogListRow[] }) {
  if (logs.length === 0) {
    return <p className="text-sm text-neutral-500">No logs yet — generate one to get started.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-neutral-800 text-neutral-400">
          <th className="py-2 font-medium">Status</th>
          <th className="py-2 font-medium">Horizon</th>
          <th className="py-2 font-medium">Generated</th>
          <th className="py-2 font-medium">Items</th>
          <th className="py-2 font-medium">Violations</th>
        </tr>
      </thead>
      <tbody>
        {logs.map((log) => (
          <tr key={log.id} className="border-b border-neutral-900 hover:bg-neutral-900/50">
            <td className="py-2">
              <a href={`/logs/${log.id}`} className="flex items-center gap-2">
                <StatusBadge status={log.status} />
              </a>
            </td>
            <td className="py-2">
              <a href={`/logs/${log.id}`} className="text-neutral-200 hover:underline">
                {fmt(log.startsAt)} – {fmt(log.endsAt)}
              </a>
            </td>
            <td className="py-2 text-neutral-400">{fmt(log.generatedAt)}</td>
            <td className="py-2 text-neutral-400">{log.itemCount}</td>
            <td className="py-2">
              <ViolationBadge count={log.violationCount} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
