import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PG_CONNECTION_OPTIONS, utcTimestamp } from "@rotavox/schema";

/**
 * Every timestamp column in the schema is naive and holds UTC by convention. Nothing
 * enforced that convention until PG_CONNECTION_OPTIONS, and the gap was not theoretical:
 * on 2026-09-30 a `log_items` truncation computed as "cut at 04:00Z" landed ~6.5 hours in
 * the past, because the cut literal was built against the session's local rendering
 * rather than the column's actual UTC, and it deleted the un-aired remainder of a live
 * log.
 *
 * What's tested here is that a naive timestamp means the same thing no matter what the
 * host's clock is set to. The decisive case is the last one: it sets TZ to a non-UTC zone
 * BEFORE connecting, which is exactly the dev-box-vs-broadcast-box difference that made
 * one row read as three different times.
 */

const URL = process.env.DATABASE_URL!;
const clients: postgres.Sql[] = [];
const connect = (opts: postgres.Options<{}> = {}) => {
  const c = postgres(URL, { max: 1, ...PG_CONNECTION_OPTIONS, ...opts });
  clients.push(c);
  return c;
};

afterAll(async () => {
  await Promise.all(clients.map((c) => c.end({ timeout: 5 })));
});

describe("naive timestamps are UTC regardless of host timezone", () => {
  it("pins the session TimeZone to UTC", async () => {
    const sql = connect();
    const [{ TimeZone }] = await sql`show timezone`;
    expect(TimeZone).toBe("UTC");
  });

  it("makes now() agree with the naive rendering, so a cut literal lands where intended", async () => {
    const sql = connect();
    // The 2026-09-30 failure in one assertion: `now()` and the naive form of `now()` must
    // describe the same instant. When the session is not UTC they differ by the offset,
    // and any `WHERE naive_col >= <literal built from now()>` silently targets the wrong
    // rows — in that incident, six and a half hours of them.
    const [row] = await sql`
      select abs(extract(epoch from (now() - (now() at time zone 'UTC')))) as drift_seconds
    `;
    expect(Number(row.drift_seconds)).toBe(0);
  });

  it("round-trips a naive timestamp unchanged when the client is NOT in UTC", async () => {
    const original = process.env.TZ;
    process.env.TZ = "America/Chicago"; // the dev box; the broadcast box differs again
    try {
      const sql = connect();
      const literal = "2026-10-01 04:00:00";
      const [row] = await sql`select ${sql.unsafe(`timestamp '${literal}'`)}::text as t`;
      // Without the pin, a client in a non-UTC zone can shift this on the way out.
      expect(row.t).toBe(literal);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("shifts a BARE string parameter — the trap the session pin does not close", async () => {
    // Documented deliberately as a failing-by-design behaviour, not an aspiration. The
    // session is UTC and this still shifts, because postgres.js converts the parameter
    // through the client's zone before the server sees it. If this assertion ever starts
    // failing, the driver changed and utcTimestamp() may no longer be needed.
    const sql = connect();
    const cut = "2026-10-01 04:00:00";
    const [bare] = await sql`select (${cut}::timestamp)::text as t`;
    const [inline] = await sql`select (${sql.unsafe(`timestamp '${cut}'`)})::text as t`;

    const hostIsUtc = Intl.DateTimeFormat().resolvedOptions().timeZone === "UTC";
    if (hostIsUtc) expect(bare.t).toBe(inline.t);
    else expect(bare.t).not.toBe(inline.t); // shifted by the host offset
  });

  it("binds identically to a SQL literal when passed through utcTimestamp()", async () => {
    // The second half of the 2026-09-30 failure, now fixed. The same predicate written as
    // a bound parameter and as an inline literal disagreed by 105 rows, and the bound form
    // silently targeted the wrong ones. Any changeset or truncation that builds a
    // timestamp predicate must bind through utcTimestamp().
    const sql = connect();
    const cut = "2026-10-01 04:00:00";
    const [bound] = await sql`select (${utcTimestamp(cut)}::timestamp)::text as t`;
    const [inline] = await sql`select (${sql.unsafe(`timestamp '${cut}'`)})::text as t`;
    expect(bound.t).toBe(inline.t);
    expect(bound.t).toBe(cut);
  });

  it("treats a zone-less string as UTC and preserves an explicit offset", () => {
    expect(utcTimestamp("2026-10-01 04:00:00").toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(utcTimestamp("2026-10-01T04:00:00Z").toISOString()).toBe("2026-10-01T04:00:00.000Z");
    // An explicit offset is honoured rather than overridden: 00:00-04 is 04:00Z.
    expect(utcTimestamp("2026-10-01T00:00:00-04:00").toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(() => utcTimestamp("not a timestamp")).toThrow(/could not parse/);
  });
});
