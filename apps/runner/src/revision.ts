import { readFileSync } from "node:fs";
import path from "node:path";

/** The checkout the Runner runs from: two levels up from apps/runner/src. */
export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * The git commit this checkout is at, read from .git directly rather than by running git:
 * the service account isn't the checkout's owner, so git itself would refuse the repo
 * ("dubious ownership") without extra configuration. Null when it can't be read.
 */
export function readRevision(root: string = REPO_ROOT): string | null {
  try {
    const gitDir = path.join(root, ".git");
    const head = readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
    const ref = /^ref: (.+)$/.exec(head)?.[1];
    if (!ref) return null;
    try {
      return readFileSync(path.join(gitDir, ref), "utf8").trim();
    } catch {
      // Not a loose ref; git packs refs it hasn't touched lately.
    }
    for (const line of readFileSync(path.join(gitDir, "packed-refs"), "utf8").split("\n")) {
      const [sha, name] = line.trim().split(" ");
      if (name === ref && /^[0-9a-f]{40}$/.test(sha)) return sha;
    }
    return null;
  } catch {
    return null;
  }
}
