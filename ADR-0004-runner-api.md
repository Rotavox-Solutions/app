# ADR-0004 — The Runner Reaches Rotavox Through an API

- **Status:** Accepted 2026-10-25
- **Date:** 2026-10-25
- **Context:** Step 2 of moving the web app to the cloud. Until now the Runner read and
  wrote Rotavox's Postgres directly with `DATABASE_URL`. That only works while both sit
  on the broadcast box, and it gave the box credentials to every station's data.
- **Builds on:** ADR-0001 (the Runner is the RadioDJ adapter), ADR-0003 (accounts; this
  is the machine counterpart).

---

## 1. Decision

Everything the Runner reads from or writes to Rotavox is a named operation of the Runner
API: `POST /api/runner/v1/<op>`. It authenticates with a **Runner key** that names one
station. The operations live in `packages/schema/src/runner-ops.ts`. The web route only
authenticates and transports.

The Runner calls them through one client, `apps/runner/src/scheduler.ts`, which has two
transports:

- **API mode:** `ROTAVOX_API_URL` and `ROTAVOX_RUNNER_KEY` are set. HTTPS calls, a 10s
  timeout per call, and the Runner's version in an `X-Rotavox-Runner` header. The box
  needs no database credentials.
- **Direct mode:** neither is set. The same operation functions run in-process against
  `DATABASE_URL`, as before. Both modes encode and decode the same wire format, so
  they return the same thing. Direct mode exists so a box can move to the API, and back,
  by editing `.env` and restarting. It goes once every box has moved.

Setting only one of the two variables is a configuration error, and the Runner stops at
startup. That hands playout to AutoDJ through the watchdog, rather than leaving the Runner
running against the wrong Rotavox.

## 2. The operations

| Group | Operations |
|---|---|
| Identity | `whoami` |
| Pacing | `currentLog`, `nextUnpushedItem`, `isTohLocked`, `queueDrainInputs`, `fillerCandidates`, `hasPushed`, `unpushedItems`, `markPushed`, `resetAfterQueueClear`, `stampAired`, `backfillAired` |
| Library | `libraryWatermark`, `libraryMirror`, `upsertSongs`, `markLibrarySynced`, `disableOrphans` |
| As-played | `historyWatermark`, `recordHistory` |
| Jobs | `failInterruptedJobs`, `nextJob`, `finishJob`, `pruneJobs` |
| RadioDJ writes | `pendingProjections`, `finishProjection`, `mirrorChangeset` |

The pacing operations are the Runner's existing queries, moved over with unchanged
meaning. The decisions stay in the Runner: when to push, the TOH boundary, choosing the
filler. Moving queries rather than rewriting the pacer kept on-air behaviour identical in
this step. Step 3 replaces the per-tick pacing calls with a log the Runner keeps locally,
so an outage can't stop playout. The library, history, job and projection operations are
the lasting shape.

Two calls became single transactions on the Rotavox side, where they had been two:
- **`upsertSongs`** moves the sync watermark together with its batch.
- **`finishProjection`** marks the changeset written and updates the mirror's
  subcategories in one step.

`nextJob` also queues the routine work: a sync every 15 minutes, and pending RadioDJ
writes. That policy now lives on the server, not in each Runner.

## 3. Security

- **The key decides the station.** No operation takes a station id. Every log, item,
  job and changeset id the Runner sends is checked against the key's station, and one
  from another station is refused as not found. A test covers it.
- **Keys** are 256-bit random values with the prefix `rvx_runner_`, so they're easy
  to spot in a config file or a leak scan. Only their SHA-256 is stored. A key is made
  once, shown once, and revoked from Station › Library & Runner, which needs the station
  admin role. Revoking takes effect on the Runner's next call. Each key records its last
  use and the Runner version that used it.
- The Runner API is exempt from the sign-in middleware and checks its own key. Browser
  sessions can't call it, and Runner keys can't call anything else.
- **Wire format:** JSON, with every date as an ISO-8601 UTC string, turned back into a
  `Date` on arrival. This respects the 2026-09-30 rule never to bind a naive timestamp
  string.

## 4. Removed

The `import-membership` Runner command is gone. It ran against Postgres only, and the
Station page's import has replaced it (ADR-0002 §4; see the UI-not-CLI rule).

## 5. Not yet

- A local log buffer and write queue (step 3).
- Moving the web app and database off the box (step 4). Until then the API URL on the
  BOLT box is `http://127.0.0.1:3000`.
- Retiring direct mode, `DATABASE_URL` and `SCHEDULER_STATION_ID` from the Runner.
