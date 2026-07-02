import "dotenv/config";
import { writeFileSync } from "node:fs";
import { restCall, getNowPlaying, getQueue } from "./rest.js";

const REQUIRED_NP_FIELDS = ["ID", "DatePlayed", "ArtistPlayed", "CountPlayed"];

// Commands that mutate the live queue/library state. Probing them here (with a
// throwaway arg) would double-trigger side effects on the real rig before the §4c
// spike is ready to observe and assert on them — so they're deliberately not called.
const UNPROBED_MUTATING_COMMANDS = ["LoadTrackToBottom", "LoadTrackToTop", "RemovePlaylistTrack", "ClearPlaylist"];

/** Recursively collects all object keys found anywhere in a parsed XML object. */
function collectKeys(obj: unknown, keys: Set<string> = new Set()): Set<string> {
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      keys.add(k);
      collectKeys(v, keys);
    }
  }
  return keys;
}

async function main() {
  const result: Record<string, unknown> = { confirmedCommands: {}, npFields: {}, pFields: {} };

  // Safe, read-only.
  try {
    const statusQueue = await restCall("StatusQueue");
    console.log(`StatusQueue -> ${statusQueue}`);
    (result.confirmedCommands as Record<string, unknown>)["StatusQueue"] = { ok: true, response: statusQueue };
  } catch (err) {
    console.error("StatusQueue failed:", err);
    (result.confirmedCommands as Record<string, unknown>)["StatusQueue"] = { ok: false, error: String(err) };
  }

  // Desired state for the whole M0 exercise (RDJ's own rotation must be off) and
  // non-destructive to call — safe to confirm here rather than deferring to §4c.
  try {
    const enableAutoDj = await restCall("EnableAutoDJ", 0);
    console.log(`EnableAutoDJ=0 -> ${enableAutoDj}`);
    (result.confirmedCommands as Record<string, unknown>)["EnableAutoDJ"] = { ok: true, response: enableAutoDj };
  } catch (err) {
    console.error("EnableAutoDJ failed:", err);
    (result.confirmedCommands as Record<string, unknown>)["EnableAutoDJ"] = { ok: false, error: String(err) };
  }

  for (const cmd of UNPROBED_MUTATING_COMMANDS) {
    (result.confirmedCommands as Record<string, unknown>)[cmd] = {
      ok: null,
      note: "not probed here (mutates live queue) — verified by the §4c spike",
    };
  }

  const np = await getNowPlaying();
  const npKeys = [...collectKeys(np)];
  console.log("\n/np fields found:", npKeys.join(", "));
  for (const field of REQUIRED_NP_FIELDS) {
    const found = npKeys.includes(field);
    console.log(`  ${found ? "OK" : "MISSING"}: ${field}`);
    (result.npFields as Record<string, boolean>)[field] = found;
  }

  const p = await getQueue();
  const pKeys = [...collectKeys(p)];
  console.log("\n/p fields found:", pKeys.join(", "));
  for (const field of REQUIRED_NP_FIELDS) {
    const found = pKeys.includes(field);
    console.log(`  ${found ? "OK" : "MISSING"}: ${field}`);
    (result.pFields as Record<string, boolean>)[field] = found;
  }

  writeFileSync("rest-capabilities.json", JSON.stringify(result, null, 2));
  console.log("\nWrote rest-capabilities.json");

  const missingNp = REQUIRED_NP_FIELDS.filter((f) => !(result.npFields as Record<string, boolean>)[f]);
  if (missingNp.length > 0) {
    console.error(`\nSetup error: /np is missing required field(s): ${missingNp.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
