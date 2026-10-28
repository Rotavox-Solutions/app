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
| The log copy | `logWindow`, `recordItemTimes` (§6) |
| Library | `libraryWatermark`, `libraryMirror`, `upsertSongs`, `markLibrarySynced`, `disableOrphans` |
| As-played | `historyWatermark`, `recordHistory` |
| Jobs | `failInterruptedJobs`, `nextJob`, `finishJob`, `pruneJobs` |
| RadioDJ writes | `pendingProjections`, `finishProjection`, `mirrorChangeset` |

The pacing queries first moved here one for one, unchanged in meaning. Step 3 replaced
them with the log copy (§6): the pacer now makes those decisions from its own copy and
asks Rotavox nothing mid-hour. The library, history, job and projection operations are
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

- Moving the web app and database off the box (step 4). Until then the API URL on the
  BOLT box is `http://127.0.0.1:3000`.
- Retiring direct mode, `DATABASE_URL` and `SCHEDULER_STATION_ID` from the Runner.

## 6. The Runner's copy of the logs (step 3, 2026-10-26)

Before this, every pacing decision was a call to Rotavox. If Rotavox couldn't be reached,
the pacer kept writing its heartbeat, so the watchdog saw nothing wrong, while it stopped
pushing. RadioDJ's queue then ran dry in 10–15 minutes and the station went silent.

Now the pacer works from a copy it keeps on the box, in `runner-state.json`
(`apps/runner/src/log-store.ts`):

- **What it holds:** the station's approved logs from an hour ago to 26 hours ahead
  (`logWindow`). Each item comes with what pacing decides from: its timing duration
  and whether it is TOH-locked. The copy is refreshed every 30 seconds. A log that hasn't
  changed costs one row: its digest matches, and its items aren't resent.
- **Who owns what:** the Runner is the only writer of `pushed_at` and `aired_at`, so its
  values win. Every change is made in the copy, saved to disk, then reported
  (`recordItemTimes`, as absolute values, so a resend is harmless). Rotavox owns
  everything else. A refresh takes the items' content, such as a PD's swap, and which
  logs are approved.
- **Edits arrive in time:** an item can't be edited within 15 minutes of air (the safety
  horizon), and the copy refreshes every 30 seconds, so the copy is always current
  before an item is pushed.
- **During an outage:** pacing carries on from the copy. Reports and reconciled
  RadioDJ history wait in the file, in order, through restarts, and are sent when
  Rotavox is back. The Runner logs the outage once, and the job loop says its jobs are
  waiting. If the outage outlasts the copy, no current log remains and the pacer hands
  playout to AutoDJ, as it does at the end of any log.
- **Known edges:**
  - Approving or un-approving a log during an outage reaches the Runner only when
    Rotavox is back. Until then it airs the last approved version it was given.
  - A copy saved for another station's key is discarded, along with its unsent reports.


## 7. Runners update themselves (step 5, 2026-10-28)

A Runner sends its commit with its version (`X-Rotavox-Runner: 0.6.0+<commit>`), and
`whoami` tells it the commit the cloud runs (baked into the web build by `release.sh`).
The staff console (`/staff`, Runners) lists every station's Runner with what it last
reported, and offers **Update** for one that's behind. That queues an `update_runner`
job, which only staff can ask for: it isn't in `JOB_KINDS`, so the station's jobs route
refuses it.

- **How it runs** (`apps/runner/src/self-update.ts`): the update restarts the Runner's
  own service, and NSSM stops whatever that service started, so the Runner can't run
  it. It writes `runner-update.json` and starts the `Rotavox Update` scheduled task
  (defined by `tools/install-services.ps1`, no trigger, runs as SYSTEM). The task runs
  `rotavox.ps1 self-update`: `update -Revision <commit> -NoRestart` in a child
  PowerShell, then writes `runner-update-result.json`, then restarts. The new Runner
  reports the job at startup, after checking it really runs that commit. If the update
  failed, the services aren't restarted, and the waiting Runner reports it.
- **Rotavox names the commit; GitHub supplies the code.** The box fetches from GitHub
  and only fast-forwards, to a commit on `main`. A downgrade, a diverged box, or a commit
  GitHub doesn't have is refused with nothing changed. So a compromised Rotavox can't
  hand a box code of its own. `cloud.sh deploy` refuses a commit that isn't on GitHub's
  `main` yet, so the cloud never names one a Runner can't fetch.
- **On air:** the restart hands playout to AutoDJ until the new Runner is back, as any
  Runner restart does: under a minute, or a few minutes when dependencies change.
- **Edges:** a Runner before 0.6.0 doesn't know the job or report its commit. It's
  updated on the box once, and the task needs `install-services.ps1` re-run, elevated,
  once per box. If the task never starts, the job fails after 2 minutes. If it hangs,
  the job fails after 30.
