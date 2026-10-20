/** Turnover as a PD says it: hours under two days, days beyond. */
export function fmtTurnover(hours: number | null): string {
  if (hours == null) return "—";
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`;
  const days = hours / 24;
  return `${days < 10 ? days.toFixed(1) : Math.round(days)}d`;
}

export function fmtSlots(slots: number): string {
  return Number.isInteger(slots) ? String(slots) : slots.toFixed(1);
}

export function fmtAgo(at: Date | null, now: Date = new Date()): string {
  if (!at) return "never";
  const mins = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = mins / 60;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
