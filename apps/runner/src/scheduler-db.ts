import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@rotavox/schema";
import { PG_CONNECTION_OPTIONS } from "@rotavox/schema";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} (see apps/runner/.env.example)`);
  }
  return value;
}

export const pgClient = postgres(requireEnv("DATABASE_URL"), PG_CONNECTION_OPTIONS);
export const schedulerDb = drizzle(pgClient, { schema });

/** uuid of this Runner's row in the Scheduler's `stations` table. */
export const stationId = requireEnv("SCHEDULER_STATION_ID");
