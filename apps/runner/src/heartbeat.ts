import { readFile } from "node:fs/promises";
import path from "node:path";
import { replaceFile } from "./files.js";

// Shared by pace.ts (writer) and watchdog.ts (reader) — the watchdog is deliberately
// decoupled from Postgres/MariaDB (see plan §2), so this is a plain local file, not a
// DB row. Overridable so a service unit can pin it to a stable path.
export const HEARTBEAT_PATH = process.env.RUNNER_HEARTBEAT_PATH ?? path.join(process.cwd(), "runner.heartbeat");

/** Written every pace-loop iteration; see files.ts for why the write is shaped as it is. */
export async function writeHeartbeat(): Promise<void> {
  await replaceFile(HEARTBEAT_PATH, String(Date.now()));
}

/**
 * Returns the heartbeat's age in ms, or `null` if unreadable/corrupt. `null` must be
 * treated as "unknown, skip this poll" by callers, not as "stale" — a read can
 * transiently race the writer's rename.
 */
export async function heartbeatAgeMs(): Promise<number | null> {
  try {
    const raw = await readFile(HEARTBEAT_PATH, "utf8");
    const writtenAt = Number(raw);
    if (!Number.isFinite(writtenAt)) return null;
    return Date.now() - writtenAt;
  } catch {
    return null;
  }
}
