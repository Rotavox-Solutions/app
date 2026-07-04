import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@rotavox/schema";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} (see apps/web/.env.example)`);
  }
  return value;
}

// Next.js reloads route/module code per request in dev; without caching the
// client on globalThis, every reload would open a fresh connection pool and
// exhaust Postgres max_connections within a normal dev session.
declare global {
  var __rotavoxPgClient: ReturnType<typeof postgres> | undefined;
  var __rotavoxDb: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

export const pgClient = globalThis.__rotavoxPgClient ?? postgres(requireEnv("DATABASE_URL"));
export const db = globalThis.__rotavoxDb ?? drizzle(pgClient, { schema });

if (process.env.NODE_ENV !== "production") {
  globalThis.__rotavoxPgClient = pgClient;
  globalThis.__rotavoxDb = db;
}
