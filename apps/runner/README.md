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
```
