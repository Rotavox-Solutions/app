# CLUBFM Music Scheduler — Phase One Build Spec

> Working codename: `scheduler` (product name TBD — placeholder throughout).
> Target automation: **RadioDJ v3.0.0.1** (MariaDB/MySQL backend, .NET, REST plugin).
> Model: **log-based**. The Scheduler pre-resolves a full log; a local Runner paces it into RadioDJ via REST, by song ID, so playout is treated as native.

This document is the construction blueprint for phase one. It defines *what* to build and *how the pieces relate*, not line-by-line code. Build order is in §9. The single most important early task is §4 (verify native injection on the real rig) — do that before writing any UI.

---

## 1. Objective & non-goals

### Objective
Replace RadioDJ's built-in AutoDJ/rotation entirely with an external, Powergold-style music scheduler that:
- lets us define **format clocks** (hour templates of positions, each calling a category),
- fills each position with a **rules + scoring engine** (separation, daypart, flow, goals) rather than a naive category-with-a-timer,
- produces a **reviewable, editable log** that can be inspected and corrected *before it airs*, and
- feeds that log to RadioDJ such that RadioDJ updates play history/counters natively (by song ID, never by m3u/file path).

### Why native injection matters (the load-bearing fact)
RadioDJ's separation memory is three columns on `songs` (`date_played`, `artist_played`, `count_played`) plus the live `queuelist`. Those update at playout **only when the played item carries a song ID**. An m3u load passes a file path with no ID → nothing links to the library, counters don't move, the track is invisible to separation. Injecting a specific library track **by ID via the REST plugin** (`LoadTrackToBottom&arg=<songID>`) makes RadioDJ treat it exactly as if its own engine had chosen it. That is the entire reason this project uses REST injection instead of playlist files.

### Non-goals for phase one
- **No audio processing.** Stereo Tool, codec tiers, LUFS normalization stay in the existing pipeline. RadioDJ still owns playout, crossfade, and cue points.
- **No rich tagging/ingestion UI.** Library metadata is imported/synced from RadioDJ; deep tagging tools are phase two.
- **No public request system, listener analytics, or reporting dashboards** beyond a basic as-played view.
- **No management of RadioDJ hardware, live shows, or its native events/scheduler.** The Scheduler owns music + imaging log generation and injection; RadioDJ's own event system can still run hard-scheduled network breaks (see §6, fixed positions).
- **Not a multi-station product yet** — but the schema is station-scoped from day one (§5) so it can become one without a rewrite.

---

## 2. Architecture — the log-based loop

Three components. Only the Runner touches the running station.

```
 Scheduler (SaaS)            Log Runner                 RadioDJ v3
 Next.js + Postgres          local agent, Win box       REST plugin + MariaDB
 ─────────────────           ──────────────────         ──────────────────
 - library mirror (by ID)    - pull log from SaaS        - AutoDJ DISABLED
 - categories                - pace into RDJ via REST    - plays what it's told
 - format clocks             - watch StatusQueue         - updates history natively
 - rules engine              - read history + schema
 - log generator      ──log──►  (sync + reconcile)  ──inject by songID (REST)──►
                             ◄──────────────────── library sync + as-played (songID) ─┘
```

**Data flow:**
1. Scheduler generates a fully-resolved log for a horizon (default: rolling 24h) and stores it (§5, `logs` / `log_items`).
2. Runner pulls the current log and paces items into RadioDJ with `LoadTrackToBottom&arg=<songID>`, keeping the queue a few tracks deep (`StatusQueue`).
3. RadioDJ (AutoDJ off) plays each injected track and updates its own `history` + counters natively.
4. Runner reads RadioDJ's `history` (and `/np` over time) and pushes **as-played** back to the Scheduler; it also periodically syncs the **library** (new/changed songs) up to the Scheduler.
5. Scheduler uses as-played as the authoritative separation state for the next generation pass.

**The single shared key is the RadioDJ `songs.ID`.** Every mirrored song row stores it; injection and reconciliation both key on it.

**Two deliberate calls:**
- The Scheduler owns its **own** library + play-history mirror in Postgres. It does *not* schedule against RadioDJ's live DB. This makes scheduling reproducible/auditable with no live tunnel to the broadcast box, and lets us extend metadata far past RadioDJ's schema.
- All RadioDJ contact (DB reads + REST writes) is funneled through the **one local Runner**. The SaaS never connects to RadioDJ directly. This is the adapter boundary that future-proofs against RadioDJ Pro / a platform switch.

---

## 3. Tech stack (opinionated)

| Concern | Choice | Notes |
|---|---|---|
| App framework | **Next.js (App Router) + TypeScript** | Matches existing stack. Server Actions / Route Handlers for the API the Runner calls. |
| Styling | **Tailwind** | Existing stack. |
| Scheduler DB | **Postgres** | Managed (Neon/Supabase) or local. Authoritative programming truth. |
| ORM | **Drizzle** | SQL-first, typed, light runtime — fits SQL fluency and gives control over the candidate queries. (Prisma is the fallback if preferred.) |
| RadioDJ DB access | **`mysql2`** (in the Runner only) | Reads RadioDJ's MariaDB for schema introspection, history, library sync. |
| Log Runner | **Node + TypeScript service** | Stack cohesion. Runs as a Windows service (NSSM or `node-windows`) on the broadcast box. |
| RadioDJ control | **REST plugin HTTP calls** | `http://127.0.0.1:<port>/opt?auth=<key>&command=<cmd>&arg=<n>` and `/np`, `/p`. |
| Scheduling engine | Plain TypeScript module | Pure functions over the mirror; independently unit-testable. |

Repo shape (single monorepo, two deployables):
```
/apps
  /web      → Next.js SaaS (UI + API the Runner calls)
  /runner   → Node service on the broadcast box
/packages
  /engine   → scheduling engine (pure TS, no I/O) — shared, unit-tested
  /schema   → Drizzle schema + shared types
```

---

## 4. Step 0 — RadioDJ v3 adapter: introspect, don't hardcode

**Do this first.** Do not assume column names or the REST command list from documentation — the schema shifts across versions and v3 is new. Ground the build in the actual rig.

### 4a. Schema introspection
In the Runner, on startup and on demand:
- Connect to RadioDJ's MariaDB (read-only credentials).
- Query `INFORMATION_SCHEMA.COLUMNS` for the `songs`, `queuelist`, `history`, `categories`, `subcategory` (names may differ) tables.
- Produce a **column map** (canonical name → actual column) covering at minimum: song id, artist, title, album, path, duration, category/subcategory id, genre id, weight, enabled, song_type, `date_played`, `artist_played`, `count_played`, cue/marker fields, and the new v3 fields (e.g. Label).
- Persist the map. All RadioDJ reads go through it. If a canonical field is missing, surface a clear setup error rather than failing silently.

### 4b. REST capability probe
- Enable the REST plugin in RadioDJ (copy from the *disabled plugins* folder, set auth key + port).
- Probe the endpoint for the commands phase one needs and record which are present:
  - `EnableAutoDJ` (disable RDJ rotation)
  - `LoadTrackToBottom` / `LoadTrackToTop` (inject by song ID)
  - `StatusQueue` (queue depth)
  - `RemovePlaylistTrack`, `ClearPlaylist` (queue management)
  - `/np` (now playing), `/p` (queue) — parse the XML, confirm it exposes per-track `ID`, `DatePlayed`, `ArtistPlayed`, `CountPlayed`.
- Store the confirmed command surface; the Runner uses only confirmed commands.

### 4c. The integration spike (acceptance gate for the whole approach)
A throwaway script proving native injection end to end on the real rig:
1. Read 3–5 valid song IDs from the mirror/RadioDJ.
2. `EnableAutoDJ=0`.
3. Push them with `LoadTrackToBottom`.
4. Poll `StatusQueue` and `/np` as they play.
5. **Assert** that after each plays, its `date_played` / `artist_played` / `count_played` advance and a `history` row is written.

If 4c passes, the architecture is proven and everything downstream is just building. If it fails, we learn on day one. **Do not proceed to §5+ UI work until 4c passes.**

Known quirk to design around: `LoadTrackToTop` misbehaves when queue size is exactly 1. The Runner must never let the queue drain to a single track (keep depth ≥ 3, prefer `LoadTrackToBottom`).

---

## 5. Data model — Scheduler (Postgres)

Starting schema. `station_id` on every table. IDs are the Scheduler's own UUIDs; `rdj_song_id` is the foreign key into RadioDJ.

**`stations`** — id, name, timezone, rdj_connection_ref (how the Runner reaches this station's RDJ), created_at.

**`songs`** (mirror + extended metadata) —
`id`, `station_id`, **`rdj_song_id`** (unique per station), artist, title, album, duration_ms, path, `rdj_category_id`, `rdj_genre_id`, enabled, song_type (0 music / 1 jingle / 2 sweeper / 3 voiceover …),
extended fields the engine needs and RDJ lacks: `era` (e.g. 90s/00s/10s/current), `tempo` (1–5 or bpm bucket), `energy` (1–5), `mood` (enum/tags), `sound_codes` (text[]), `hook_ms` (marker), `intro_ms`, `outro_ms`,
scheduling state: `last_scheduled_at`, `times_scheduled`, `target_turnover_hours` (per category default, overridable per song).
Synced up from RadioDJ by the Runner (core fields) + editable in the UI (extended fields).

**`categories`** — id, station_id, name, kind (`music` | `imaging` | `voicetrack`), parent_id (nullable, for sub-pools like Gold→Gold-90s), default_target_turnover_hours, default rules overrides. Maps loosely to RDJ subcategories but is the Scheduler's own tree.

**`song_categories`** — song_id, category_id (a song can belong to multiple pools). Or single-category if you prefer strict; multi is more flexible for gold/recurrent overlap.

**`clocks`** (format clocks / hour templates) — id, station_id, name, length_minutes (usually 60), notes.

**`clock_positions`** — id, clock_id, `sort_order`, `position_type` (`category` | `fixed_event` | `sweeper` | `voicetrack`), `category_id` (nullable), `target_offset_seconds` (soft placement within the hour, e.g. :07), constraints JSON (era/tempo/mood/energy targets, sound-code include/exclude), `fixed_ref` (for fixed events, e.g. a network newscast marker).

**`format_grid`** — id, station_id, `day_of_week` (0–6 or a daypart model), `hour` (0–23), `clock_id`. Which clock airs each hour of each day. (Phase one: day-of-week × hour grid is enough; richer daypart calendars later.)

**`rules`** — id, station_id, scope (`global` | `category` | `position`), scope_ref, rule_type (`artist_separation` | `title_separation` | `album_separation` | `tempo_clash` | `era_spread` | `daypart_restrict` | `max_per_hour` …), params JSON (e.g. `{ minMinutes: 90 }`), hardness (`hard` | `soft`), weight (for soft rules' scoring).

**`dayparts`** (optional in phase one) — id, station_id, name, day/hour ranges. Referenced by `daypart_restrict` rules and by song eligibility.

**`logs`** — id, station_id, `starts_at`, `ends_at`, status (`draft` | `approved` | `airing` | `aired`), generated_at, generator_version, seed (for reproducibility).

**`log_items`** — id, log_id, `sort_order`, `projected_air_at`, `element_type` (`music` | `sweeper` | `voicetrack` | `fixed_event`), `song_id` (nullable), `rdj_song_id` (denormalized for the Runner), `clock_position_id` (provenance), `violations` JSON (rules relaxed to place this item), `pushed_at` (set by Runner when injected), `aired_at` (set from reconciliation).

**`play_history`** (authoritative separation state) — id, station_id, `song_id`, `rdj_song_id`, artist, `aired_at`, source (`reconciled` | `assumed`). Written from the Runner's read of RadioDJ `history`. The engine reads this for separation.

> Note: RDJ's own `date_played`/`artist_played` still update on playout (harmless, and a useful cross-check), but `play_history` in Postgres — fed by reconciliation — is the Scheduler's truth.

---

## 6. The scheduling engine (the heart)

Pure TypeScript in `/packages/engine`. Input: the mirror + clocks + grid + rules + current separation state. Output: an ordered `log_items` list with projected air times and any violations. No I/O; fully unit-testable with fixtures.

### Generation loop
```
generateLog(station, horizonStart, horizonEnd):
  ctx = new SeparationState(loadPlayHistory(station, lookback))  // recent aired items
  items = []
  for each hour in [horizonStart .. horizonEnd]:
    clock = formatGrid.clockFor(hour.dayOfWeek, hour.hour)
    for each position in clock.positions (in sort_order):
      if position.type == 'fixed_event':
        item = placeFixedEvent(position, hour)          // network news, hard IDs
      else:
        item = fillPosition(position, ctx, previousItem(items))
      item.projected_air_at = runningClockTime(items, hour)
      ctx.record(item)                                   // artist/title/song now "used" at this time
      items.push(item)
  return items
```

`SeparationState` tracks projected air times of each **artist**, **title**, and **song id** across *both* recent history and the log being built — so separation is enforced against not-yet-aired scheduled items, not just past plays. This is the thing RDJ's interval-only model can't do and is why it hits daypart lock.

### `fillPosition` — candidate selection + scoring
```
fillPosition(position, ctx, prevItem):
  pool = position.category
  candidates = query mirror where:
      station match, category in (pool ∪ pool.children), enabled,
      song_type matches position kind,
      daypart-eligible for this hour
  // HARD filters (exclude if failed):
  candidates = candidates.filter(c =>
      ctx.restOk(c.artist, 'artist_separation') &&
      ctx.restOk(c.title,  'title_separation')  &&
      passesHardRules(c, position, ctx))
  if candidates.empty:
      return relax(position, ctx, prevItem)   // see ladder below
  // SCORE survivors:
  scored = candidates.map(c => ({ c, score: scoreCandidate(c, position, prevItem, ctx) }))
  // search depth: pick from top-K with seeded jitter (avoid deterministic loops)
  return weightedPickFromTopK(scored, K=engineConfig.searchDepth, seed=log.seed)
```

`scoreCandidate` (soft signals, tunable weights):
```
score =
    w_rest  * restScore(c)                    // longer since last_scheduled, normalized to target turnover → higher
  + w_flow  * flowScore(c, prevItem)          // tempo/energy transition quality vs previous element
  + w_era   * eraSpreadScore(c, ctx.recentEras)
  + w_mood  * moodFitScore(c, position.moodTarget)
  + w_sound * soundCodeFitScore(c, position.constraints)
  - penalty(nearSeparation, overScheduled, marginalDaypart)
  + seededJitter(c, log.seed)                 // controlled randomness
```

### Rule relaxation ladder (when no candidate passes hard filters)
Apply in order, stop at first success, and **record every relaxation in `log_items.violations`** so the log editor can flag it:
1. Drop secondary hard rules (album separation, tempo clash).
2. Shrink artist separation window by a configured %.
3. Shrink title separation window by a configured %.
4. Widen to the position's configured fallback category.
5. Last resort: least-recently-scheduled eligible track in the pool; flag hard violation.

### Configurable knobs (per station, sane defaults)
`searchDepth` (top-K), separation windows per rule, scoring weights, turnover targets per category, relaxation percentages, jitter magnitude.

---

## 7. The Log Runner (local agent)

Node/TS Windows service on the broadcast box. The only component that talks to RadioDJ. Three jobs: **pace**, **reconcile**, **sync**.

### Startup
- Load/refresh the schema column map and REST capability set (§4).
- Confirm `EnableAutoDJ=0` (assert RDJ rotation is off; the Runner owns the queue).

### Pace loop (the core)
```
every ~5s:
  depth = StatusQueue()
  if depth < MIN_DEPTH (default 3):
     next = nextUnpushedLogItem(currentLog, cursor)
     if next:
        LoadTrackToBottom(next.rdj_song_id)
        mark next.pushed_at = now; advance cursor
  // never let depth hit exactly 1 → MIN_DEPTH ≥ 3 guards the LoadTrackToTop bug
```
- The Runner pulls the current approved log from the SaaS API and tracks a cursor of pushed items.
- Fixed events (network news) that RadioDJ handles via its own event system are marked in the log as `fixed_event` and *skipped by the pusher* (RDJ injects them) but still occupy a projected slot for timing; OR pushed as a specific imaging/track ID if we own them. Decide per element; the model supports both.

### Reconcile loop
```
periodically (and on track change via /np):
  rows = read new RadioDJ `history` rows since last watermark
  for each row: POST as-played {rdj_song_id, artist, aired_at} to SaaS
  update log_items.aired_at by matching
```
This feeds `play_history` (the engine's separation truth) and lets the UI show as-played vs planned.

### Library sync
```
periodically (e.g. hourly) or on demand:
  read new/changed rows from RadioDJ `songs` (by id / modified marker)
  upsert into SaaS mirror (core fields only; never overwrite Scheduler-owned extended metadata)
```

### Drift handling (phase one: minimal, with a hook)
- The Runner reports actual air times; the SaaS compares to `projected_air_at`.
- Phase one executes the log in order regardless of small drift. Provide an API hook `regenerateTail(log, fromCursor)` so a later refinement can re-resolve the un-aired remainder when reality diverges (a long live segment, a dropped track). Don't build full re-resolution now; leave the seam.

---

## 8. UI surface (dependency order)

Build in this order — each depends on the prior. This is the "reproduce RDJ scheduling, and then some" surface.

1. **Library & category management.** Browse the synced library; edit extended metadata (era, tempo, energy, mood, sound codes, hooks, turnover targets); create/edit the category tree and assign songs to pools. Everything else needs categories to exist.
2. **Clock editor (the centerpiece).** Visual hour template: add/reorder positions, set each position's category, target offset within the hour, and constraints (era/tempo/mood/energy/sound-code targets). This is the thing RDJ does worst and the core product value.
3. **Format grid.** Day-of-week × hour matrix assigning a clock to each hour. Copy/paste rows, bulk-assign.
4. **Rules configuration.** Global/category/position rules: separation windows, tempo/era/daypart rules, max-per-hour; hardness and soft-rule weights.
5. **Log editor.** Generate a log for a horizon; view it as a timeline; **surface violations** (relaxations recorded in §6) prominently; allow manual swaps/locks (pin a specific current at a specific time), regenerate; approve for air. Approval flips `logs.status` to `approved` for the Runner to pick up.
6. **As-played view.** Planned vs actual timeline, using reconciled `play_history`. Basic — planned/aired diff, recent rotation, artist/title spacing sanity.

---

## 9. Build milestones (sequence)

- **M0 — Integration proof (§4).** Schema introspection + REST probe + spike (4c). **Gate: 4c passes on the real rig.** Nothing else starts until this is green.
- **M1 — Data model + sync (§5, §7 library sync + reconcile).** Postgres schema; Runner syncs library up and as-played up. Verify the mirror matches RadioDJ and history flows in.
- **M2 — Engine, headless (§6).** Clocks + grid + rules + generation loop, driven by fixtures and the real mirror. Output: a generated log inspectable as data (no UI). Unit tests on separation, scoring, relaxation.
- **M3 — Runner pace loop (§7).** Approved logs actually play out on RadioDJ via injection, queue stays topped, as-played reconciles against the plan. **This is the first end-to-end air.**
- **M4 — UI (§8).** In the §8 order. M4 makes it operable; M0–M3 make it *work*.

Phase one is complete when a clock- and rule-driven, human-reviewed log airs on The BOLT via native injection, with as-played reconciliation closing the loop — i.e. RDJ's AutoDJ is fully obsoleted.

---

## 10. Open items to verify on the live rig

- Exact v3 column names for the canonical fields in §4a (esp. cue/marker fields and the new Label field) — resolved by introspection, but confirm the map covers everything the engine reads.
- Confirm the REST plugin ships with / runs against v3.0.0.1 and the §4b commands respond. If any needed command is missing in v3, note it — a couple of commands have alternative forms across plugin versions.
- Confirm `history` table structure and the best watermark column for incremental reconciliation reads.
- Confirm how RadioDJ v3 treats a track injected by ID w.r.t. cue points/crossfade (should be native — verify audibly).
- Decide fixed-event ownership: let RadioDJ's event system fire network news, or have the Runner inject those IDs too. Affects §7 pusher logic.
- RadioDJ config: set it to AutoDJ-off / assisted appropriately so it never self-fills against the Runner; confirm min-queue settings don't fight the pusher.
