import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";

/**
 * The commit this build is of, for the staff console and for Runners updating to it
 * (packages/schema/src/revisions.ts). The cloud VM builds from a git archive with no
 * .git, so release.sh passes it in; a dev build asks git.
 */
function revision(): string {
  if (process.env.ROTAVOX_REVISION) return process.env.ROTAVOX_REVISION;
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  env: { ROTAVOX_REVISION: revision() },
  // @rotavox/engine and @rotavox/schema are consumed as raw TS source (their
  // package.json "main" points at src/index.ts) and use NodeNext-style relative
  // imports ending in .js that resolve to .ts files — correct for tsc, but
  // webpack has no such mapping by default. This teaches it one, scoped to
  // apps/web's bundling only; the packages themselves are untouched.
  webpack(config) {
    config.resolve.extensionAlias = {
      ".js": [".js", ".ts", ".tsx"],
    };
    return config;
  },
};

export default nextConfig;
