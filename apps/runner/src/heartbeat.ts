import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Shared by pace.ts (writer) and watchdog.ts (reader) — the watchdog is deliberately
// decoupled from Postgres/MariaDB (see plan §2), so this is a plain local file, not a
// DB row. Overridable so a service unit can pin it to a stable path.
export const HEARTBEAT_PATH = process.env.RUNNER_HEARTBEAT_PATH ?? path.join(process.cwd(), "runner.heartbeat");

const RENAME_RETRIES = 5;
const RENAME_RETRY_DELAY_MS = 50;
// Windows refuses to rename over a file another process holds open — the watchdog's
// read, or an AV scanner, which on the broadcast box held it through four consecutive
// 5s ticks and let the heartbeat go stale under a healthy pacer (a false failover).
const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * Atomic write-then-rename so a concurrent reader (the watchdog) never sees a torn
 * write. If the rename keeps hitting a Windows sharing violation, overwrite in place
 * instead: a torn read parses as non-finite and the watchdog skips that poll, whereas
 * a missed write is indistinguishable from a dead pacer.
 */
export async function writeHeartbeat(): Promise<void> {
  const tmpPath = `${HEARTBEAT_PATH}.tmp`;
  const stamp = String(Date.now());
  await writeFile(tmpPath, stamp);
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmpPath, HEARTBEAT_PATH);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (!TRANSIENT_RENAME_CODES.has(code)) throw err;
      if (attempt >= RENAME_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS));
    }
  }
  await writeFile(HEARTBEAT_PATH, stamp);
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
