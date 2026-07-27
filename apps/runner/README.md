# apps/runner — RadioDJ adapter (§4)

Introspects RadioDJ's live schema and REST command set rather than hardcoding either
(spec's non-negotiable invariant #1). `schema-map.json` / `rest-capabilities.json` are
the persisted results — the M1+ Runner (pace/reconcile/sync loops, §7) reads these
instead of duplicating this discovery logic.

The M0 gate (§4c — native song-ID injection updates RadioDJ's own history/counters)
has passed on the real rig. The throwaway spike script that proved it has been removed;
`introspect-schema.ts` and `probe-rest.ts` remain as the reusable discovery tools,
rerun whenever the RadioDJ install changes.

## Setup

1. Copy `.env.example` to `.env` and fill in real RadioDJ MariaDB + REST plugin details.
2. `npm install`

## Run

```
npm run introspect  # §4a — writes schema-map.json
npm run probe-rest   # §4b — writes rest-capabilities.json
npm run pace         # §7  — the pace loop; owns AutoDJ while a log is current
npm run watchdog     # M4.5 — independent AutoDJ fail-safe; run as a SEPARATE process
```

## Fail-safe AutoDJ (M4.5)

Invariant: AutoDJ-off is valid only while a healthy pacer is actively driving the
queue. Anything that breaks that (process death, hang, or an outage once the API
cutover lands) must fail toward AutoDJ-on — dumber rotation beats silence.

- `pace.ts` writes a heartbeat file every tick and hands playout back to AutoDJ on
  `SIGINT`/`SIGTERM` and on startup if it finds no current log with AutoDJ already off.
- `watchdog.ts` is a separate, dependency-light process (no Postgres/MariaDB — only
  RadioDJ's REST plugin) that polls that heartbeat and force-enables AutoDJ if it goes
  stale. It must run as its own process/service so a wedged or killed Runner can't take
  it down too — see `deploy/systemd/` for the two independent unit files. Neither
  `SIGTERM` nor a graceful handler can save you from `kill -9`, a crash, or an OOM
  kill — that's exactly what the watchdog is for.
