# The TOP — format, schedule, orchestration and infra proposal

- **Date:** 2026-10-11 · **Status:** PROPOSAL, nothing applied
- **Scope:** The TOP only. The BOLT is parked on native AutoDJ (§4). Infra changes in §5 land
  on The TOP first and reach The BOLT later, as a separate rollout.
- **Starting point:** a new Windows server with fresh RadioDJ v3 + MariaDB, and a fresh
  PostgreSQL for Rotavox. Any prior knowledge of The TOP's format is disregarded.
- **Follows:** `FORMAT-WORKFLOW.md` phases 0–3 (this is a *build*, not an operating-cycle
  change), `ADR-0001`, `DEPLOY.md`, `CHANGESET-CONTRACT.md`.

---

## 1. Positioning (Phase 0)

| | Proposal |
|---|---|
| Format | **Mainstream CHR / Top 40**, US-based, with a deliberate international lane |
| Current intensity | ~59% currents + 12% international + 21% recurrents + 9% gold (§3) |
| Anchor timezone | **America/New_York.** ET + CT is ~3/4 of the US population; PT listeners hear the grid three hours late, which suits a CHR day shape |
| Content policy | **Radio edits / clean only** in every pool. The BOLT never had a stated policy (reset-notes #3); decide this one before import, not during it |
| Chart panel, ladder | Mediabase Top 40/CHR (airplay, primary for promote/demote) · Billboard Pop Airplay (corroborating) · Billboard Hot 100 + Spotify US (consumption, **entry signal only**) |
| Chart panel, `I` | UK Official Singles Top 40 · ARIA (AU) · Canadian Hot 100 · Billboard Global 200 *excl. US* · Spotify Global |

### Why `I` is a pool here, when it was a flag for The BOLT

`sheets/2026-09-27-wpr-open-decisions.md` #7 rejected an `I` pool for The BOLT, because there
"international" only described a record — it didn't say how often to play it. For The TOP it does:
**"two international hits an hour" is a promise the station makes on air**, so it needs its own
slot budget. That's exactly what a pool encodes.

**Entry and exit rules for `I`:**
- **Enters `I`:** top 20 on ≥2 non-US panel charts, and **not** inside Mediabase Top 40's top 40.
- **Leaves `I` → the ladder:** once it charts top 30 on Mediabase Top 40, the US is playing it,
  so it promotes to B or A by the normal floors and stops counting as international.
- **Leaves `I` → bench/rest:** falls off the non-US panel for 2 consecutive weeks.

`I` therefore holds the hits the US hasn't caught up to yet. That's the differentiator, and it
plays the same role for The TOP that §0b.3 plays for The BOLT.

---

## 2. Ladder — categories and target depths (Phase 1a/1c)

**Library pools — scheduled.** Turnover = hours to play the whole pool once. Drift = hours a
song's airtime moves per cycle, relative to a whole day (≥5h wanted, so a song doesn't keep
landing in the same listening window).

| Pool | Parent | Holds | Slots/wk | **Depth** | Turnover | Plays/song/wk | Drift |
|---|---|---|---|---|---|---|---|
| **A** | Currents | Power: Mediabase top ~10 | 587 | **11** | 3.1h | 53 | n/a (>7/day) |
| **B** | Currents | Secondary: ~11–25, rising | 504 | **15** | 5.0h | 34 | 5.0h |
| **C** | Currents | Tertiary: 26–40 + descending powers | 336 | **18** | 9.0h | 19 | 9.0h |
| **N** | Currents | New adds, not yet charting | 251 | **14** | 9.4h | 18 | 9.4h |
| **I** | International | Non-US hits, not yet US top 40 | 336 | **17** | 8.5h | 20 | 8.5h |
| **R1** | Recurrents | Hot recurrent, 0–18 mo off chart | 336 | **30** | 15h | 11 | 9.0h |
| **R2** | Recurrents | 18 mo – ~3.5 yr | 253 | **50** | 33h | 5.1 | 9.2h |
| **G1** | Gold | Power gold, 2017–2022 | 168 | **105** | 105h | 1.6 | 9.0h |
| **G2** | Gold | Gold, 2010–2016 | 85 | **80** | 158h | 1.1 | 9.9h |

Computed by `scratchpad/top-depth.mjs` over the §3 grid. A at 12 would put it at exactly 7.0
plays/day (an integer, which the M4 drift rule avoids), so it's 11. **Total scheduled depth: 340.**

**Library pools — not scheduled:**

| Pool | Purpose |
|---|---|
| **F** | Fit pool: only for closing positions (exact hour fit). ~60 recognisable 2010s–2020s hits with a **deliberately wide length spread**. Variety in lengths is what makes the fit land (`fit.ts` header). Sits outside the depth solve, as F does for The BOLT. |
| **W** | Bench. Exits from B/C/N/I that don't earn recurrent status. |
| **ZN / ZI** | Rested from N or I (`Z[x]` convention, ADR §3.7). Never mapped into a scheduled category. |

**Imaging categories (RadioDJ parent "Sweepers", plus Station IDs and Promos):**

| Category | Use | Starting depth |
|---|---|---|
| TOH IDs | Legal ID at :00 | 8 |
| Sweepers | General, into any current | 20 |
| Liners | Dry station-name liners | 20 |
| New-Music Sweepers | Placed ahead of N | 8 |
| Worldwide Sweepers | Placed ahead of I ("the hits the rest of the world is playing first") | 8 |
| Station Promos | Promo slot | 8 |

**Total library to source: ~400 music + ~70 imaging.** Before sourcing, take a census of what
survived on disk (the audio files survive a corrupted database; only the metadata was lost).

**Gold era note.** Mainstream CHR gold is shallow by design: no 2000s, no 90s. If a throwback
feature is wanted later (e.g. weekend 2000s), add a G3 pool and a clock variant for it. Keep it
out of the first build.

---

## 3. Schedule — clocks and grid (simple to begin)

**Two clocks, one-week cycle, no rotation variants.**

| | Clock **TOP-D** (Day) | Clock **TOP-N** (Night/Weekend) |
|---|---|---|
| Airs | Mon–Fri 06–18 · Sat–Sun 09–17 (83 h/wk) | All other hours (85 h/wk) |
| Music positions | 17 + 3 closing candidates (F) | 17 + 3 closing candidates (F) |
| A / B / C / N | 4 / 3 / 2 / 2 | 3 / 3 / 2 / 1 |
| I | 2 | 2 |
| R1 / R2 | 2 / 1 | 2 / 2 |
| G1 / G2 | 1 / – | 1 / 1 |
| Mix (cur / I / rec / gold) | 65 / 12 / 18 / 6 | 53 / 12 / 24 / 12 |

**Week mix:** currents 59% · international 12% · recurrents 21% · gold 9%. Squarely
mainstream CHR.

**Running order (illustrative).** The real order should come from the `clock-order.mjs` spread
logic, so imaging lands contextually and categories don't cluster.

```
TOP-D   :00 TOH ID
         1 A    2 R1   3 B    4 C    ── Sweeper
         5 A    6 I◂Worldwide   7 G1   8 N◂New-Music   ── Liner
         9 B   10 A   11 R2  12 C    ── Promo
        13 I◂Worldwide  14 N  15 B   16 A   17 R1   + F×3 candidates (spread)

TOP-N   :00 TOH ID
         1 A    2 R2   3 B    4 C    ── Sweeper
         5 I◂Worldwide   6 G1   7 A    8 R1   ── Liner
         9 N◂New-Music  10 B   11 R2  12 C    ── Promo
        13 A   14 G2  15 I◂Worldwide  16 B   17 R1   + F×3 candidates (spread)
```

**17 positions is provisional.** It's sized for a ~3:10 average effective length (cue-point
segue, not file length). If the census shows ~2:55, the hour comes out ~4 minutes short and the
fit leans on F every hour. Re-size from the census with `tools/hour-length.mjs`, then gate with
`tools/dry-run-log.mts` before approving anything.

**Rules (starting set):**

| Rule | Scope | Params | Hardness |
|---|---|---|---|
| artist_separation | global | 60 min | hard |
| title_separation | global | 180 min | hard |
| max_per_hour | I | 2 | hard |
| horizontal_separation | A | 1h window, 4 days | hard |
| horizontal_separation | B, C, N, I, R1 | 1h window, 10 days | hard |
| tempo_clash | global | maxJump 2 | soft 0.2 |
| era_spread | global | — | soft 0.15 |

**CHR-specific gap:** artist separation keys on the raw artist string (`normKey` =
trim + lowercase). "Sabrina Carpenter" and "Sabrina Carpenter & Ed Sheeran" therefore don't
separate, and CHR is feature-heavy. See §5.7.

**Grid evolution, once it's on air.** Add dayparts only after a few weeks of play history and
listener data:
1. Overnight (00–05) gets a recurrent-heavier variant.
2. A/B orderings of each clock alternate by hour, so A doesn't sit at the same minute every hour.
3. A weekend shape.

None of this is needed for first air.

---

## 4. Orchestration — Rotavox runs The TOP, The BOLT goes back to AutoDJ

### 4a. Park The BOLT (old box, reversible)

1. Check that The BOLT's **native AutoDJ rotation** in RadioDJ is sane before handing back. It
   will sound worse than Rotavox (ADR §3.5, selection is unsynced by design), but it must not be
   broken.
2. Stop **RotavoxRunner** with the graceful path (the pacer hands back to AutoDJ), not a
   `taskkill`. Confirm AutoDJ is on and the queue is self-filling.
3. Stop **RotavoxWatchdog** *after* that. If it's left running against a stopped pacer it only
   re-forces AutoDJ, which is harmless, but a stopped service is clearer.
4. Set both services to **Manual** start, so a reboot can't resurrect a pacer with no
   approved log.
5. Snapshot: `pg_dump` The BOLT's Postgres to off-box storage, and archive `apps/runner/.env`.
   Tag the repo at the commit The BOLT last ran (e.g. `bolt-parked-2026-10`), so resuming is a
   checkout plus a restart, not an archaeology project.

Nothing in The BOLT's code, seeds, changesets or sheets is deleted or moved.

### 4b. Stand up The TOP (new box)

The station gets a **new uuid** in its own Postgres. The two stations never share a database
for now (§5.4).

| # | Step | Note |
|---|---|---|
| 1 | Infra baseline | §5.1–5.6, *before* RadioDJ holds anything worth losing |
| 2 | RadioDJ | REST plugin on with auth key · **AutoDJ off** · **hourly Clear Playlist events deleted** · min-queue self-fill off |
| 3 | Create RadioDJ subcategories | Names exactly as §2: `A B C N I R1 R2 G1 G2 F W ZN ZI` under Music. The imaging names under Sweepers / Station IDs / Promos, with song_type set correctly |
| 4 | Import library → census | Enabled depth per pool, effective-duration mean and spread. **This is the input the whole of §2–3 is re-checked against** |
| 5 | Migrate Postgres; create station row | `The TOP`, `America/New_York`, `assume_log_aired=false` (tier 2 has a real as-played feed) |
| 6 | Runner `.env` → `introspect`, `probe-rest` | Fresh install: regenerate both artifacts. `schema-map.json` `missing` must be `[]` |
| 7 | `sync-library` | Must run before seeding (DEPLOY trap 1) |
| 8 | Seed The TOP | From a new format module (`tools/top-format.mjs`) through the seed generator, parameterised by station (§5.3). Seed asserts must pass: every music category non-empty, every position resolves |
| 9 | Dry-run | `tools/dry-run-log.mts`. Hour-length gate, fallback rate, unfilled positions |
| 10 | Generate → review → approve | Log Cockpit at `/logs` |
| 11 | Pacer + watchdog as services | Then **deliberately kill the pacer** and confirm AutoDJ returns within ~20s. This fail-safe has never been field-tested (DEPLOY gaps) |
| 12 | Airbench | Listen to it |
| 13 | Weekly cycle | Chart panel → changesets with The TOP's `station_id` → apply → re-sync → generate |

**Cold start:** a fresh RadioDJ has no history, so separation against past plays starts empty
(DEPLOY §8). The first day leans on separation within the log itself. Generate and approve
**one day at a time** for the first week rather than a week ahead.

### 4c. Repo shape

Work on a branch off the current one (`fit-in-generation` has uncommitted timezone work in
`connection.ts` that this build depends on, so commit that first). The TOP's material:

```
tools/top-format.mjs                      grid, shapes, imaging, depth targets (sibling of m4-format.mjs)
packages/schema/seed/top-seed.sql         generated, never hand-edited
formats/thetop/LIBRARY-CONTRACT.md        category ↔ RadioDJ subcategory record for the new rig
sheets/2026-10-11-thetop-launch-proposal.md   this file
```

---

## 5. Infra changes — make them now, on an empty database

Ranked. Items 1–4 are much cheaper now than later, because The TOP's database holds no data
yet. Every one of them is a data migration later, on The BOLT's live database.

**5.1 Backups and storage integrity (do first; this is why we're here).**
- Nightly `mariadb-dump --single-transaction` of RadioDJ, plus `pg_dump` of Rotavox, copied
  **off-box**. Run a restore drill once before go-live; an untested backup isn't a backup.
- Check `information_schema.TABLES.ENGINE` for RadioDJ's tables. If any are **MyISAM**, convert
  them to InnoDB. MyISAM is the classic corrupt-on-unclean-shutdown engine and the likeliest way
  the old database got "corrupted beyond repair". Keep InnoDB's durability defaults
  (`innodb_flush_log_at_trx_commit=1`, doublewrite on).
- UPS with graceful shutdown, and a controlled Windows Update reboot window.

**5.2 `timestamp` → `timestamptz`, in the first migration.** `connection.ts` documents why: naive
columns cost ~30 minutes of live schedule on 2026-09-30, and are the leading suspect in the
`aired_at` mis-stamping. Its own comment says the session pin "is NOT the complete fix". On an
empty database the fix is free. For The BOLT later it's `ALTER … TYPE timestamptz USING col AT
TIME ZONE 'UTC'`, mechanical because the columns already hold UTC. Keep `PG_CONNECTION_OPTIONS`
as well.

**5.3 Bind categories by subcategory *name*, not ID.**
- Sync RadioDJ's `subcategory` (id, name, parent) into a station-scoped mirror table.
- The seed joins on name, so a reinstall that renumbers IDs no longer silently re-routes pools.
  That removes DEPLOY trap 2, the one failure where "nothing catches it".
- In the same change, stop hardcoding the station uuid in seeds. The generator takes the station
  as an argument, and `seed.ts` substitutes it. A second station makes the literal untenable.
- Regression check: regenerate the M4 seed and confirm The BOLT's output is unchanged apart from
  the parameter.

**5.4 One Postgres per box, localhost-only, for now.** Co-locating the Runner, Watchdog, Log
Cockpit and Postgres on the RadioDJ box removes the high-latency tunnel path entirely. The schema
is already multi-station (`station_id` everywhere), so consolidating into a central SaaS database
later is a data move, not a redesign. Don't consolidate during a launch.

**5.5 Set the server clock to UTC.** RadioDJ stamps `history` in box-local time. On **2026-11-01**
(three weeks out) US DST ends, and an ET box writes 01:00–02:00 twice. As-played rows in that
hour can't be told apart. The repo already carries a "systematic skew (DST/timezone config on
that box)" note in `reconcile-history.ts`.
- With AutoDJ off and RadioDJ's rotation events deleted, nothing on the box needs local wall
  time. Rotavox already converts through `stations.timezone`.
- Cost: RadioDJ's UI shows UTC. If that's unacceptable, the alternative is an explicit
  `RADIODJ_TIMEZONE` in the Runner plus DST-aware reconciliation, which is a code change.

**5.6 Windows services, committed.** Replace hand-run NSSM with a committed install script
(NSSM or WinSW config) for Runner, Watchdog and the web app. Set `AppStopMethodConsole` so a
stop takes the graceful hand-back path. Set an absolute `RUNNER_HEARTBEAT_PATH`. Closes the first
DEPLOY gap and makes §4a/§4b reproducible.

**5.7 Featured-artist-aware separation (engine).** Split credits on `feat. / ft. / & / x / with
/ ,` into multiple separation keys, so a feature separates against both artists.
- Ship it **as a rule param** (`splitCredits: true`), default off. The BOLT's behaviour is then
  byte-identical until it opts in.
- A pure engine change, unit-testable without a rig.

**5.8 Remote access to the Log Cockpit.** Use Tailscale (or Cloudflare Tunnel + Access) instead
of exposing ports. It also removes the "grant the read-only MariaDB user from `'%'`" workaround
the Azure VM-pool tunnel forced.

**Explicitly not proposed now:**
- The Runner going through the SaaS API instead of straight to Postgres (fine while co-located).
- An authoring UI for clocks and rules.
- Lifecycle-as-rules (ADR §3.7).

All three are real, and none blocks The TOP.

---

## 6. Decisions needed from the PD

1. **Anchor timezone** ET (proposed), and **server clock UTC** (§5.5).
2. **Clean/radio-edit-only** policy (§1).
3. **`I`** definition and **2/hr** (§1, §2). Too many, too few?
4. **Gold floor** at 2010 (no 2000s) for first air.
5. **Library state:** did the audio files survive, and roughly how many usable tracks per era?
   This decides whether §2's depths are a sourcing brief or just a reclassification.
6. Approve the infra set **5.1–5.6** for the build (5.7 and 5.8 can trail).
