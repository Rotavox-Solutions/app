// One time axis: everything here derives from instants passed in by the caller.
// No zero-arg Date construction / Date.now() anywhere in this package.

const HOUR_MS = 3_600_000;

const WEEKDAY_TO_DOW: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timezone, f);
  }
  return f;
}

interface LocalParts {
  dayOfWeek: number;
  hour: number;
  /** Station-local calendar-hour bucket, e.g. "2026-07-02T14" — used by max_per_hour. */
  hourKey: string;
}

export function localParts(at: Date, timezone: string): LocalParts {
  const parts = formatter(timezone).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dayOfWeek = WEEKDAY_TO_DOW[get("weekday")];
  const hour = Number(get("hour"));
  return {
    dayOfWeek,
    hour,
    hourKey: `${get("year")}-${get("month")}-${get("day")}T${get("hour")}`,
  };
}

export function assertHourAligned(d: Date, label: string): void {
  if (d.getTime() % HOUR_MS !== 0) {
    throw new Error(`${label} must be aligned to the top of an hour (got ${d.toISOString()})`);
  }
}

/** UTC hour starts in [start, end). */
export function* iterateHours(start: Date, end: Date): Generator<Date> {
  for (let t = start.getTime(); t < end.getTime(); t += HOUR_MS) {
    yield new Date(t);
  }
}

export { HOUR_MS };
