import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
