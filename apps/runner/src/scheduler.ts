import "dotenv/config";
import { readFileSync } from "node:fs";
import {
  decodeWire,
  encodeWire,
  RUNNER_API_VERSION,
  type RunnerOpArgs,
  type RunnerOpName,
  type RunnerOpResult,
} from "@rotavox/schema";

/**
 * The Runner's one way to reach Rotavox (ADR-0004). Everything it reads from or writes to
 * the scheduler goes through `call`, as a named operation of the Runner API.
 *
 * - **API mode** (ROTAVOX_API_URL and ROTAVOX_RUNNER_KEY set): HTTPS to the web app. The
 *   key names the station; no database credentials live on the box.
 * - **Direct mode** (neither set): the operations run in this process against
 *   DATABASE_URL, as the Runner always has. Kept so a box can switch to the API and back
 *   by editing .env and restarting. It encodes and decodes the same wire format, so the
 *   two modes can't differ in what they return.
 */
export interface SchedulerClient {
  readonly mode: "api" | "direct";
  call<K extends RunnerOpName>(
    op: K,
    ...args: RunnerOpArgs<K> extends undefined ? [] : [RunnerOpArgs<K>]
  ): Promise<RunnerOpResult<K>>;
  close(): Promise<void>;
}

/** Per call. The pacer's loops retry on the next tick, so a slow call must fail rather than hang a tick. */
const API_TIMEOUT_MS = 10_000;

export const RUNNER_VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
})();

export class SchedulerApiError extends Error {
  constructor(
    readonly op: string,
    readonly status: number,
    message: string,
  ) {
    super(`Rotavox API ${op}: ${message} (HTTP ${status})`);
    this.name = "SchedulerApiError";
  }
}

export function apiClient(baseUrl: string, key: string, fetchImpl: typeof fetch = fetch): SchedulerClient {
  const base = baseUrl.replace(/\/$/, "");
  return {
    mode: "api",
    async call(op, ...args) {
      let res: Response;
      try {
        res = await fetchImpl(`${base}/api/runner/v${RUNNER_API_VERSION}/${op}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
            "x-rotavox-runner": RUNNER_VERSION,
          },
          body: encodeWire(args[0] ?? {}),
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        });
      } catch (err) {
        throw new SchedulerApiError(op, 0, `unreachable (${(err as Error).message})`);
      }
      const text = await res.text();
      if (!res.ok) {
        let message = text.slice(0, 300);
        try {
          message = JSON.parse(text).message ?? message;
        } catch {}
        throw new SchedulerApiError(op, res.status, message);
      }
      return decodeWire(text);
    },
    async close() {},
  };
}

async function directClient(): Promise<SchedulerClient> {
  // Loaded only in direct mode, so an API-mode Runner never needs DATABASE_URL.
  const { schedulerDb, pgClient, stationId } = await import("./scheduler-db.js");
  const { runRunnerOp } = await import("@rotavox/schema");
  return {
    mode: "direct",
    async call(op, ...args) {
      return decodeWire(await runRunnerOp(schedulerDb, stationId, op, encodeWire(args[0] ?? {})));
    },
    close: () => pgClient.end(),
  };
}

let client: Promise<SchedulerClient> | null = null;

/** The process-wide client, chosen from the environment on first use. */
export function scheduler(): Promise<SchedulerClient> {
  client ??= (async () => {
    const url = process.env.ROTAVOX_API_URL;
    const key = process.env.ROTAVOX_RUNNER_KEY;
    if (url && key) return apiClient(url, key);
    if (url || key) {
      throw new Error(
        "Set both ROTAVOX_API_URL and ROTAVOX_RUNNER_KEY to use the Rotavox API, or neither (see apps/runner/.env.example).",
      );
    }
    return directClient();
  })();
  return client;
}

/** Shorthand for `(await scheduler()).call(...)`. */
export async function api<K extends RunnerOpName>(
  op: K,
  ...args: RunnerOpArgs<K> extends undefined ? [] : [RunnerOpArgs<K>]
): Promise<RunnerOpResult<K>> {
  return (await scheduler()).call(op, ...args);
}

/** The station this Runner serves: from its key in API mode, SCHEDULER_STATION_ID in direct mode. */
let identity: Promise<{ id: string; name: string; timezone: string }> | null = null;
export function stationIdentity() {
  identity ??= api("whoami").then(
    (r) => r.station,
    (err) => {
      identity = null; // an outage at the first ask mustn't be remembered as the answer
      throw err;
    },
  );
  return identity;
}

export async function closeScheduler(): Promise<void> {
  if (client) await (await client).close();
}
