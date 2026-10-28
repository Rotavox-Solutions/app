// Which commit each piece of Rotavox runs, so the staff console can tell a Runner that's
// behind the cloud from one that's current, and the Runner knows what to update to.
// The cloud's revision is baked into its build (next.config.ts, from release.sh); a
// Runner sends its own in the X-Rotavox-Runner header as "<version>+<revision>".

/** A git commit id, full or abbreviated. Anything else is refused before it reaches a shell. */
export const REVISION_PATTERN = /^[0-9a-f]{7,40}$/;

/** Two revisions name the same commit when one is a prefix of the other (short and full forms). */
export function sameRevision(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const n = Math.min(a.length, b.length);
  return n >= 7 && a.slice(0, n) === b.slice(0, n);
}

export const shortRevision = (r: string): string => r.slice(0, 7);

/** The X-Rotavox-Runner header's value, "0.6.0+1a2b3c4d5e6f"; a Runner before 0.6.0 sends only the version. */
export function formatRunnerVersion(version: string, revision: string | null): string {
  return revision ? `${version}+${revision.slice(0, 12)}` : version;
}

export function parseRunnerVersion(
  header: string | null | undefined,
): { version: string; revision: string | null } | null {
  if (!header) return null;
  const [version, revision] = header.split("+", 2);
  return { version, revision: revision && REVISION_PATTERN.test(revision) ? revision : null };
}

/** The commit the cloud runs, or null in a dev build outside git. */
export function serverRevision(): string | null {
  const r = process.env.ROTAVOX_REVISION;
  return r && REVISION_PATTERN.test(r) ? r : null;
}
