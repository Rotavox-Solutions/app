import { rename, writeFile } from "node:fs/promises";

const RENAME_RETRIES = 5;
const RENAME_RETRY_DELAY_MS = 50;
// Windows refuses to rename over a file another process holds open — the watchdog's
// read, or an AV scanner, which on the broadcast box held the heartbeat through four
// consecutive 5s ticks and let it go stale under a healthy pacer (a false failover).
const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * Atomic write-then-rename so a concurrent reader never sees a torn write. If the rename
 * keeps hitting a Windows sharing violation, overwrite in place instead: every reader of
 * these files treats one it can't parse as unknown, whereas a missed write is
 * indistinguishable from a dead pacer.
 */
export async function replaceFile(path: string, contents: string): Promise<void> {
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, contents);
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmpPath, path);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (!TRANSIENT_RENAME_CODES.has(code)) throw err;
      if (attempt >= RENAME_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS));
    }
  }
  await writeFile(path, contents);
}
