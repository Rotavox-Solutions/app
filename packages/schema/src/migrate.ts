import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Missing required env var DATABASE_URL (see packages/schema/.env.example)");
}

const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);

// uuid columns use gen_random_uuid() (pgcrypto) as their default.
await client`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");

await client.end();
