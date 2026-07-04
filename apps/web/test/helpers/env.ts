// Vitest setupFile — runs before the test file's own import graph resolves, so
// this must load .env.test before anything imports src/lib/db.ts (whose
// module-level `postgres(...)` call reads DATABASE_URL at import time).
//
// One-time manual setup (no existing pattern in this repo for DB-touching
// tests — see M4a plan): `CREATE DATABASE rotavox_test;` then run the
// packages/schema migration against it (same path the dev DB uses):
//   DATABASE_URL=postgresql://rotavox:rotavox@localhost:5432/rotavox_test \
//     npm run migrate -w packages/schema
import { config } from "dotenv";

config({ path: ".env.test", override: true });

if (!process.env.DATABASE_URL?.includes("_test")) {
  throw new Error(
    "DATABASE_URL doesn't look like a test database (expected a '_test' suffix) — refusing to run tests " +
      "that TRUNCATE tables against what might be a real database. Check apps/web/.env.test."
  );
}
