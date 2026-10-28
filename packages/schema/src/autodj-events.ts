// The AutoDJ fail-safe's hour plan (ADR-0001 §3.5): weekly RadioDJ "Load Rotation"
// events that switch AutoDJ to the rotation mirroring each hour's clock. The plan is kept
// in station-local time, because that's what the format grid means. RadioDJ's box runs
// on UTC and its events repeat weekly with no notion of DST, so the events have to be
// rewritten at the station's current offset whenever that offset changes. Rotavox notices
// the change (runner-ops nextJob) and the Runner rewrites them (project_autodj_events).
// Pure functions here, so both sides agree on the arithmetic.

/** One plan entry: load `rot` at station-local `hour` on each of `days` (0 = Sunday). */
export interface LocalEvent {
  hour: number;
  rot: string;
  days: number[];
}

/** The same entry at a fixed UTC offset: what RadioDJ is given. */
export interface UtcEvent {
  hour: number;
  rot: string;
  days: number[];
}

/** sync_state key holding the offset (minutes east of UTC) the events were last written at. */
export const AUTODJ_EVENTS_SYNC_KEY = "autodj_events_offset";

/** Minutes east of UTC in `timezone` at `at`: -420 for Los Angeles in summer, -480 in winter. */
export function utcOffsetMinutes(at: Date, timezone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name ?? "");
  if (!m) throw new Error(`can't read the UTC offset of ${timezone} (got ${name})`);
  if (!m[1]) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * The plan at one UTC offset. A local hour that lands on the other side of midnight in
 * UTC moves to the neighbouring day. Whole-hour offsets only: a RadioDJ event fires on
 * the hour, so a half-hour zone can't be mirrored hour for hour.
 */
export function planUtcEvents(events: LocalEvent[], offsetMinutes: number): UtcEvent[] {
  if (offsetMinutes % 60 !== 0) throw new Error(`UTC offset ${offsetMinutes} min isn't a whole number of hours`);
  const shift = -offsetMinutes / 60;
  return events.map((e) => {
    const total = e.hour + shift;
    const hour = ((total % 24) + 24) % 24;
    const dayShift = Math.floor(total / 24);
    const days = e.days.map((d) => (((d + dayShift) % 7) + 7) % 7).sort((a, b) => a - b);
    return { hour, rot: e.rot, days };
  });
}

/** The event's name in RadioDJ, which is also how a rewrite finds it again. */
export function utcEventName(e: UtcEvent): string {
  return `${e.rot} ${String(e.hour).padStart(2, "0")}:00 UTC`;
}

/** "UTC-8", "UTC+5:30", for summaries a PD reads. */
export function formatOffset(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "UTC";
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  return `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, "0")}` : ""}`;
}
