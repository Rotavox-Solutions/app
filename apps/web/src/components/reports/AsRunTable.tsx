import type { AsRunRow } from "@/lib/queries";

function fmtHour(date: Date): string {
  return new Date(date).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fmtTime(date: Date | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function deltaColor(delta: number | null): string {
  if (delta === null) return "text-neutral-600";
  const abs = Math.abs(delta);
  if (abs <= 10) return "text-emerald-400";
  if (abs <= 60) return "text-amber-400";
  return "text-red-400";
}

export function AsRunTable({ rows }: { rows: AsRunRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">No TOH-locked elements found in the selected range.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-neutral-800 text-neutral-400">
          <th className="py-2 pr-2 font-medium">Hour</th>
          <th className="py-2 pr-2 font-medium">Scheduled</th>
          <th className="py-2 pr-2 font-medium">Actual</th>
          <th className="py-2 pr-2 font-medium">Delta</th>
          <th className="py-2 font-medium">Element</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-neutral-900">
            <td className="py-1.5 pr-2 text-neutral-300">{fmtHour(row.hour)}</td>
            <td className="py-1.5 pr-2 text-neutral-400">{fmtTime(row.projectedAirAt)}</td>
            <td className="py-1.5 pr-2 text-neutral-400">{fmtTime(row.airedAt)}</td>
            <td className={`py-1.5 pr-2 font-medium ${deltaColor(row.deltaSeconds)}`}>
              {row.deltaSeconds === null ? "—" : `${row.deltaSeconds > 0 ? "+" : ""}${row.deltaSeconds}s`}
            </td>
            <td className="py-1.5 text-neutral-100">
              {row.artist ? `${row.artist} — ${row.title}` : `rdj:${row.rdjSongId ?? "?"}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
