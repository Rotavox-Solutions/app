import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@rotavox/schema";
import { PG_CONNECTION_OPTIONS } from "@rotavox/schema";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} (see apps/web/.env.example)`);
  }
  return value;
}

/**
 * A test process may only ever reach a test database. Enforced HERE, at connection time,
 * because this is the one place every entry point must pass through.
 *
 * This guard already existed as a vitest `setupFile` in apps/web. On 2026-08-05 it was
 * bypassed and the production scheduler database was TRUNCATEd to nothing: running
 * `npx vitest run` from the REPO ROOT rather than from apps/web never loads apps/web's
 * vitest config, so the setupFile never ran, so nothing checked DATABASE_URL — and
 * test/helpers/db.ts truncates every table in the schema. Categories, songs, pools,
 * clocks, the grid, every log and all of play_history, gone in one command.
 *
 * A guard that depends on how the runner was invoked is not a guard. Vitest sets
 * VITEST=true in every worker regardless of config, cwd or invocation path, so checking
 * it at the point of connection cannot be routed around.
 */
if (process.env.VITEST && !/_test(\?|$)/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error(
    `Refusing to connect: this is a test process (VITEST is set) but DATABASE_URL does not name ` +
      `a _test database. Tests TRUNCATE every table, and on 2026-08-05 that destroyed production. ` +
      `Run tests from apps/web so .env.test loads, or set DATABASE_URL to a _test database. ` +
      `Got: ${(process.env.DATABASE_URL ?? "(unset)").replace(/:\/\/[^@]*@/, "://***@")}`
  );
}

// Next.js reloads route/module code per request in dev; without caching the
// client on globalThis, every reload would open a fresh connection pool and
// exhaust Postgres max_connections within a normal dev session.
declare global {
  var __rotavoxPgClient: ReturnType<typeof postgres> | undefined;
  var __rotavoxDb: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

export const pgClient = globalThis.__rotavoxPgClient ?? postgres(requireEnv("DATABASE_URL"), PG_CONNECTION_OPTIONS);
export const db = globalThis.__rotavoxDb ?? drizzle(pgClient, { schema });

if (process.env.NODE_ENV !== "production") {
  globalThis.__rotavoxPgClient = pgClient;
  globalThis.__rotavoxDb = db;
}
