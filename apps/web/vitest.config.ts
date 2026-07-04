import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/helpers/env.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Every test file shares one truncate-and-reseed database (see helpers/db.ts) —
    // running files in parallel lets one file's beforeEach TRUNCATE wipe rows another
    // file's in-flight test just inserted. Serialize file execution to match the
    // harness's actual isolation model.
    fileParallelism: false,
  },
});
