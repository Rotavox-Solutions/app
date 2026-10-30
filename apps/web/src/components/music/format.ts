import type { CategoryOption } from "@/lib/music-edits";

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

/** Where a song sits, in a PD's words: its pool, or its state when that is what matters. */
export function fmtPlacement(p: { state: string; categoryId: string | null }, names: Map<string, string>): string {
  const pool = p.categoryId ? names.get(p.categoryId) ?? "?" : null;
  if (p.state === "active") return pool ?? "no pool";
  if (p.state === "resting") return pool ? `resting from ${pool}` : "resting";
  return p.state;
}

export function fmtWhenShort(at: Date, timeZone: string): string {
  return at.toLocaleString("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Pools grouped the way the Categories page is: music first, by parent, then imaging. */
export function groupOptions(options: CategoryOption[]): [string, CategoryOption[]][] {
  const groups = new Map<string, CategoryOption[]>();
  for (const o of options) {
    const key = o.kind === "music" ? o.group ?? "Music" : "Imaging & other";
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  return [...groups];
}
