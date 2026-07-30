import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

// Runs a plain-SQL seed file against DATABASE_URL — a cross-platform replacement
// for `psql -f` (no psql client needed; mirrors migrate.ts's connection). The seed
// must be client-agnostic SQL (no psql \meta), which the m3 seed generator emits.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Missing required env var DATABASE_URL (see packages/schema/.env.example)");
}

// Default to the current format seed; override by passing a path (relative to
// packages/schema, since that's the workspace CWD, or absolute).
const file = process.argv[2] ?? "seed/m3-clubfm-seed.sql";
const sqlText = readFileSync(file, "utf8");

const client = postgres(databaseUrl, { max: 1 });
try {
  // .simple() uses the simple query protocol, which allows the multiple
  // statements (and the BEGIN/COMMIT) the seed file contains.
  await client.unsafe(sqlText).simple();
  console.log(`Seed applied: ${file}`);
} finally {
  await client.end();
}
