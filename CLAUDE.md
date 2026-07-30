# Rotavox — CLUBFM Music Scheduler

Replaces RadioDJ's AutoDJ with an external, log-based music scheduler: a rules/scoring
engine builds a reviewable log, which is paced into RadioDJ by song ID so playout stays
native (history/counters update as if RadioDJ chose the track itself).

Full detail: `clubfm-scheduler-phase-one-spec.md` (repo root). Read it before doing
non-trivial work here — this file only covers what changes how you build.

## Architecture (three components — only the Runner touches the station)

```
Scheduler (SaaS)  --log-->  Log Runner  --inject by songID (REST)-->  RadioDJ v3
Next.js + Postgres          local agent, Win box                      REST plugin + MariaDB
                             <--library sync + as-played (songID)--
```

## Stack & repo layout (spec §3)

- App: Next.js (App Router) + TypeScript, Tailwind. Scheduler DB: Postgres via Drizzle.
- Runner: Node + TypeScript Windows service; talks to RadioDJ's MariaDB via `mysql2`
  and to the REST plugin over HTTP.
- Engine: plain TypeScript, pure functions, no I/O — independently unit-testable.

```
/apps
  /web      → Next.js SaaS (UI + API the Runner calls)
  /runner   → Node service on the broadcast box
/packages
  /engine   → scheduling engine (pure TS, no I/O)
  /schema   → Drizzle schema + shared types
```

## Non-negotiable invariants

1. **Introspect, don't hardcode.** RadioDJ's schema and REST command set are discovered
   at runtime (`INFORMATION_SCHEMA.COLUMNS`, live capability probe) — never assume
   column names or a fixed command list. Versions drift.
2. **Inject by song ID only**, via the REST plugin (`LoadTrackToBottom`/`LoadTrackToTop`).
   Never m3u or file paths — RadioDJ only links playout to history/counters when the
   played item carries a song ID.
3. **`station_id` on every table** in the Scheduler's Postgres schema, from day one.
4. **All RadioDJ contact goes through the Runner.** The web app never connects to
   RadioDJ (DB or REST) directly.
5. **M0 is a gate.** The §4c integration spike must pass on the real rig before any
   work proceeds past it. Nothing in §5+ starts until it's green.
