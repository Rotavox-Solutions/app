// Runner keys (ADR-0004): the credential a station's Runner presents to the Runner API.
// Separate from people's sessions: a key can do exactly what the Runner needs at one
// station and nothing a person can, and revoking it never signs anyone out.
import { and, desc, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { runnerKeys } from "./schema.js";
import { hashToken, newToken } from "./accounts.js";

type Db = PostgresJsDatabase<typeof schema>;

/** Prefix so a key is recognisable in a config file, and in a leak scanner. */
export const RUNNER_KEY_PREFIX = "rvx_runner_";
// last_used_at is for the Station page; writing it on every call is waste.
const TOUCH_AFTER_MS = 60_000;

export type RunnerKeyRow = typeof runnerKeys.$inferSelect;

/** Makes a key for a station's Runner. The secret is returned once and never stored. */
export async function createRunnerKey(
  db: Db,
  opts: { stationId: string; label: string; createdBy: string | null },
): Promise<{ key: string; row: RunnerKeyRow }> {
  const label = opts.label.trim() || "Runner";
  const { token } = newToken();
  const key = RUNNER_KEY_PREFIX + token;
  const [row] = await db
    .insert(runnerKeys)
    .values({ stationId: opts.stationId, tokenHash: hashToken(key), label, createdBy: opts.createdBy })
    .returning();
  return { key, row };
}

/** The station a presented key belongs to, or null for an unknown or revoked one. */
export async function resolveRunnerKey(
  db: Db,
  key: string,
  opts: { version?: string | null; now?: Date } = {},
): Promise<{ keyId: string; stationId: string } | null> {
  if (!key.startsWith(RUNNER_KEY_PREFIX)) return null;
  const [row] = await db
    .select()
    .from(runnerKeys)
    .where(and(eq(runnerKeys.tokenHash, hashToken(key)), isNull(runnerKeys.revokedAt)));
  if (!row) return null;
  const now = opts.now ?? new Date();
  const version = opts.version ?? null;
  if (
    !row.lastUsedAt ||
    now.getTime() - row.lastUsedAt.getTime() > TOUCH_AFTER_MS ||
    (version && version !== row.lastVersion)
  ) {
    await db
      .update(runnerKeys)
      .set({ lastUsedAt: now, lastVersion: version ?? row.lastVersion })
      .where(eq(runnerKeys.id, row.id));
  }
  return { keyId: row.id, stationId: row.stationId };
}

export async function listRunnerKeys(db: Db, stationId: string) {
  return db
    .select({
      id: runnerKeys.id,
      label: runnerKeys.label,
      createdAt: runnerKeys.createdAt,
      lastUsedAt: runnerKeys.lastUsedAt,
      lastVersion: runnerKeys.lastVersion,
      createdBy: schema.users.name,
    })
    .from(runnerKeys)
    .leftJoin(schema.users, eq(schema.users.id, runnerKeys.createdBy))
    .where(and(eq(runnerKeys.stationId, stationId), isNull(runnerKeys.revokedAt)))
    .orderBy(desc(runnerKeys.createdAt));
}

export async function revokeRunnerKey(
  db: Db,
  stationId: string,
  keyId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(runnerKeys)
    .set({ revokedAt: now })
    .where(and(eq(runnerKeys.id, keyId), eq(runnerKeys.stationId, stationId), isNull(runnerKeys.revokedAt)))
    .returning({ id: runnerKeys.id });
  return rows.length > 0;
}
