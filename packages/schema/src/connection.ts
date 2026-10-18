/**
 * Connection options every Postgres and MariaDB client in this repo must pass.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every timestamp column in `schema.ts` is `timestamp` — naive, no timezone — and the
 * convention is that they hold UTC. Nothing enforced that convention, so what a naive
 * value *means* depended on who was reading it:
 *
 *   - Postgres rendered it in the server session's TimeZone (America/Los_Angeles).
 *   - The JS driver converted naive <-> Date using the CLIENT's local zone, so the dev
 *     box (America/Chicago) and the Windows broadcast box disagreed with each other and
 *     with psql — on the same row.
 *
 * On 2026-09-30 that cost about thirty minutes of live schedule. A truncation of
 * `log_items` was computed as "cut at 04:00Z", but the cut literal was built against the
 * session's local rendering rather than the column's actual UTC, so it landed ~6.5 hours
 * in the past and deleted the un-aired remainder of a live log. The same ambiguity is the
 * leading hypothesis for the open `aired_at` mis-stamping issue, where rows sit more than
 * an hour from their slot and one was stamped nine days early; `reconcile-history.ts`
 * already carries a comment about "a stable, systematic skew (DST/timezone config on that
 * box)".
 *
 * Pinning the session to UTC makes the stored value and every reading of it agree,
 * whatever the host's clock is set to. It is NOT the complete fix — the columns should
 * become `timestamptz` — but that is a migration against a live station's database, and
 * this removes the host dependency today without one.
 *
 * Set at CONNECTION time, like the test-database guard in apps/web/src/lib/db.ts, because
 * it is the one place every entry point must pass through. A convention that relies on
 * each caller remembering is not a convention.
 */

/**
 * Options for `postgres(url, ...)` (postgres.js).
 *
 * `connection.TimeZone` is sent as a startup parameter, so it applies to the session
 * before any query runs — including `now()`, every `::text` cast, and any naive literal
 * the server has to interpret.
 */
export const PG_CONNECTION_OPTIONS = {
  connection: { TimeZone: "UTC" },
} as const;

/**
 * Options for `mysql.createPool(...)` (mysql2), used for RadioDJ's MariaDB.
 *
 * `timezone: "Z"` tells the driver to read and write DATETIME values as UTC rather than
 * converting through the Node process's local zone. RadioDJ writes `date_played` and
 * friends in the broadcast box's local time, so this does not make those columns UTC —
 * it makes the driver stop applying a second, invisible shift on top.
 */
export const MYSQL_CONNECTION_OPTIONS = {
  timezone: "Z",
} as const;

/**
 * Bind a UTC instant to a naive `timestamp` column safely.
 *
 * PINNING THE SESSION IS NOT ENOUGH. postgres.js type-infers a bare string like
 * `"2026-10-01 04:00:00"` as needing conversion, and converts it through the CLIENT
 * process's zone before it reaches the server — so the session's TimeZone never gets a
 * say. Measured on a host in America/Chicago, against a UTC-pinned session:
 *
 *   sql`... ${"2026-10-01 04:00:00"}::timestamp`   -> 2026-10-01 09:00:00   SHIFTED
 *   sql`... ${"2026-10-01T04:00:00Z"}::timestamp`  -> 2026-10-01 04:00:00   ok
 *   sql`... ${new Date("...Z")}::timestamp`        -> 2026-10-01 04:00:00   ok
 *
 * That five-hour gap is the second half of the 2026-09-30 incident: the same predicate
 * written as a bound parameter and as an inline literal disagreed by 105 rows, and the
 * bound form silently targeted the wrong ones.
 *
 * The rule is therefore: **never bind a naive timestamp string.** Pass the result of this
 * helper, which yields an unambiguous instant the driver cannot reinterpret.
 *
 * @param value A `Date`, or a string. A string WITHOUT an explicit `Z`/offset is read as
 *              UTC — which is the convention every timestamp column in this schema holds.
 */
export function utcTimestamp(value: string | Date): Date {
  if (value instanceof Date) return value;
  const hasZone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value.trim());
  const iso = hasZone ? value.trim() : `${value.trim().replace(" ", "T")}Z`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`utcTimestamp: could not parse ${JSON.stringify(value)} as a timestamp.`);
  }
  return parsed;
}
