import "dotenv/config";
import { XMLParser } from "fast-xml-parser";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} (see apps/runner/.env.example)`);
  }
  return value;
}

function baseUrl(): string {
  const host = requireEnv("RADIODJ_REST_HOST");
  const port = requireEnv("RADIODJ_REST_PORT");
  return `http://${host}:${port}`;
}

function authKey(): string {
  return requireEnv("RADIODJ_REST_AUTH_KEY");
}

const xmlParser = new XMLParser({ ignoreAttributes: false });

// RadioDJ v3.x's actual REST surface, confirmed live (§4b) — the spec's documented
// /opt, /np, /p paths are from an older plugin version and don't exist here.
// /RDJnpjson returns HTTP 400 on this install; /RDJnp (XML) is what actually works
// and carries ID/DatePlayed/ArtistPlayed/CountPlayed, so that's what's used below.
const ENDPOINTS = {
  command: "/RDJCommand",
  state: "/RDJState",
  nowPlaying: "/RDJnp",
  queue: "/RDJp",
  queueItem: "/RDJpitem",
};

// /RDJCommand wraps its response in a WCF `<string xmlns="...">VALUE</string>`
// envelope — unwrap it so callers get the plain value RadioDJ actually returned.
function unwrapStringEnvelope(body: string): string {
  const match = body.match(/^<string[^>]*>([\s\S]*)<\/string>$/);
  return match ? match[1] : body;
}

const FETCH_TIMEOUT_MS = 15_000;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3_000;

// The long §4c poll loop runs for many minutes over a real network link — a single
// dropped connection shouldn't abort the whole observation. Retries only transient
// network failures (timeouts, connection resets), not HTTP error responses.
async function fetchWithRetry(url: URL): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

/** Calls a RadioDJ REST plugin command via /RDJCommand. Returns the plain response value. */
export async function restCall(command: string, arg?: string | number): Promise<string> {
  const url = new URL(`${baseUrl()}${ENDPOINTS.command}`);
  url.searchParams.set("auth", authKey());
  url.searchParams.set("command", command);
  if (arg !== undefined) url.searchParams.set("arg", String(arg));

  const res = await fetchWithRetry(url);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`REST command ${command} failed: HTTP ${res.status} — ${body}`);
  }
  return unwrapStringEnvelope(body);
}

/** Fetches /RDJnp and parses the now-playing XML into a plain object. */
export async function getNowPlaying(): Promise<unknown> {
  const url = new URL(`${baseUrl()}${ENDPOINTS.nowPlaying}`);
  url.searchParams.set("auth", authKey());
  const res = await fetchWithRetry(url);
  const xml = await res.text();
  return xmlParser.parse(xml);
}

/** Fetches /RDJp (queue) and parses the XML into a plain object. */
export async function getQueue(): Promise<unknown> {
  const url = new URL(`${baseUrl()}${ENDPOINTS.queue}`);
  url.searchParams.set("auth", authKey());
  const res = await fetchWithRetry(url);
  const xml = await res.text();
  return xmlParser.parse(xml);
}
