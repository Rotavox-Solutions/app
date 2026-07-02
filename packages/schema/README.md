# @rotavox/schema

Drizzle schema + shared types for the Scheduler's Postgres data model (spec §5).
Consumed by `apps/runner` (and later `apps/web`) — this package holds table
definitions only, not a live DB connection.

## Migrate

1. Copy `.env.example` to `.env`, set `DATABASE_URL`.
2. `npm run generate` — writes SQL migrations to `./drizzle` from `src/schema.ts`.
3. `npm run migrate` — applies them (also ensures the `pgcrypto` extension exists,
   needed for `uuid` primary key defaults).
