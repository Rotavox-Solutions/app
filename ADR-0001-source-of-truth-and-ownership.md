# ADR-0001 — Source of Truth & Ownership Boundaries

- **Status:** Accepted
- **Date:** 2026-07-31
- **Context:** Rotavox / CLUBFM (station: The BOLT), post-M3 clockset, pre-airbench
- **Supersedes:** nothing
- **Related:** `clubfm-scheduler-phase-one-spec.md` (§1 non-goals, §5 schema, §6 clocks)

---

## 1. Context

Phase one shipped a working scheduler without ever writing down *who owns which
facts*. That was fine while Rotavox only read from RadioDJ. It stopped being fine
on 2026-07-30, when a music-direction decision (reclassifying 312 songs out of the
W bench into currents/recurrents/gold) had to be executed as hand-written `UPDATE`
statements against live MariaDB, with a hand-written rollback script. The decision
was Rotavox's; the data it changed was RadioDJ's; nothing in the system recorded
that the two had to agree.

The same ambiguity shows up in the clockset. `packages/schema/seed/m3-clubfm-seed.sql`
binds scheduler categories to RadioDJ subcategory IDs (lines 53–76) and was *sized*
against live pool depths — but nothing enforces or even records that coupling. A
subcategory renumbered in RadioDJ yields a silently empty scheduler category.

This ADR establishes the ownership line, the sync policy for each domain, and what
is deliberately left unsynced.

### 1a. What is actually true today (verified, not assumed)

Recorded so future readers don't re-derive it:

- **The Runner writes nothing to RadioDJ's database.** The only write path in the
  entire system is REST `LoadTrackToBottom` / `LoadTrackToTop` (`apps/runner/src/rest.ts`).
- **It reads:** `songs` (artist, title, album, path, duration, subcategory, genre,
  enabled, song_type, date_modified), `subcategory.parentid` (to resolve category —
  RadioDJ has no `category_id` on songs), and `history`
  (`apps/runner/src/sync-library.ts`, `apps/runner/src/reconcile-history.ts`).
- **It ignores RadioDJ's own rotations, events, and category-rule tables entirely.**
  This is correct and is now policy (§3.5).
- **Rules are already a first-class input.** `rules(scope, scope_ref, rule_type,
  params, hardness, weight)` is resolved by the engine for `artist_separation`,
  `title_separation`, `album_separation`, `tempo_clash`, `max_per_hour`, daypart
  constraints, and `era_spread` — scoped global or per-category, hard or soft with
  weights (`packages/engine/src/rules.ts`). What is missing is an authoring UI, not
  the capability.
- **Extended song metadata is already Scheduler-owned in schema.** `era`, `tempo`,
  `energy`, `mood`, `sound_codes[]`, `hook_ms`, `intro_ms`, `outro_ms` are
  deliberately excluded from the sync upsert set so a re-sync cannot clobber them
  (`packages/schema/src/schema.ts:54-65`, `apps/runner/src/sync-library.ts:88-109`).
  Nothing populates them yet, so `tempo_clash` and `era_spread` currently score
  against nulls.
- **Clocksets are not authored by Rotavox.** `apps/web` exposes logs, log detail,
  as-run reporting, and song search. No route touches `clocks`, `clock_positions`,
  `format_grid`, `categories`, or `rules`. The format is authored by hand-editing a
  SQL seed.

---

## 2. Decision

**Rotavox owns intent. The playout system owns inventory and playout.**

Every rule below follows from that line. It is also the line that preserves
system-agnosticism: intent is portable, inventory and playout are what a playout
adapter abstracts.

### Ownership matrix

| Domain | SoT today | SoT target | Sync policy |
|---|---|---|---|
| Song existence, path, duration, enabled | RadioDJ | RadioDJ | Rotavox caches; watermarked incremental pull |
| **Pool assignment** (A1 / R2 / G1990 / W …) | RadioDJ | **Rotavox** | Migrates — see §3.2 |
| Musical codes (tempo, key, energy, sound codes, hooks) | Rotavox (unpopulated) | Rotavox | Derived by Rotavox; never read back from RadioDJ |
| Clocks, clock positions, format grid, dayparts | Rotavox | Rotavox | Never leaves Rotavox |
| Separation & rotation rules | Rotavox | Rotavox | Never leaves Rotavox |
| Log / running order | Rotavox | Rotavox | Injected by song ID only |
| Playout, play history, counters | RadioDJ | RadioDJ | Rotavox reads history back |
| Fallback rotation | RadioDJ | RadioDJ | **Deliberately unsynced** — see §3.5 |

---

## 3. Rationale, domain by domain

### 3.1 Library composition stays RadioDJ's

Which files exist, where they live, how long they are, whether they're enabled —
these are inventory facts owned by the system that ingests and plays the audio.
Rotavox caches them. This is already how the Runner behaves and it needs no change.

### 3.2 Pool assignment moves to Rotavox

Deciding that a song is a recurrent rather than a current is a *scheduling
judgment* — the core of the music-director role. It lives in RadioDJ today only
because RadioDJ's AutoDJ needed it there to function.

Leaving it there has a concrete, already-realized cost: music direction cannot be
version-controlled, reviewed, or rolled back, and each change is a bespoke script
against a live production database.

**Migration path** (deliberately staged, so the format can ship first):

1. *Today* — RadioDJ is SoT. Rotavox mirrors `id_subcat` and derives `song_categories`
   at seed time. Changes are applied to RadioDJ out-of-band.
2. *Next* — Rotavox becomes the authoring surface. Music-direction changes are
   authored as **changesets** (§4), reviewed, and applied by the Runner.
   RadioDJ remains SoT-of-record; Rotavox is authoritative for *proposed* state.
3. *Then* — flip. Rotavox holds pool assignment; the Runner pushes it down so
   RadioDJ's fallback rotation stays sane. RadioDJ becomes a projection.

### 3.3 Writeback is an adapter capability, not a RadioDJ exception

Pushing pool assignment into the playout system looks like a system-agnosticism
violation. It isn't, if modeled correctly.

Express it as a capability on the playout adapter — `setPoolAssignment(songId, pool)`
— alongside the existing `loadTrackToBottom` / `loadTrackToTop`. Systems with a
bucket concept implement it; systems without simply don't, and Rotavox keeps pool
assignment purely internal for those. The genuinely RadioDJ-specific part is only
the subcategory-ID mapping, which already lives in exactly one place.

This is consistent with invariant #4: *all* RadioDJ contact still goes through the
Runner. It does relax invariant #1's spirit — the Runner will write, not just read —
so writeback must use the same runtime schema introspection, never hardcoded column
names, and must be explicitly opt-in per station.

### 3.4 Musical codes are derived by Rotavox, not read from RadioDJ

RadioDJ's BPM/tempo fields are inconsistently populated and often hand-entered.
The schema already commits to Rotavox owning this data; the sync already refuses to
overwrite it.

Analysis (BPM, key, energy, loudness) is a batch job over `songs.path`. The Runner
is the only component with filesystem access, so it belongs there as an **offline
pass** that writes results to the Scheduler — never in the injection hot path.

Until it exists, `tempo_clash` and `era_spread` are scoring against nulls and are
effectively inert. This is a known, accepted gap, not a bug.

### 3.5 Rules flow in neither direction; the fallback keeps its own truth

**Do not mirror RadioDJ's rules into Rotavox, and do not push Rotavox's rules down.**
Two engines evaluating rotation rules over the same library is nondeterminism that
cannot be debugged under air pressure. Rotavox's log is the final word; RadioDJ's
rules could only ever fight it.

The one exception is the fallback: RadioDJ needs a dumb, wide-gold rotation that
fires when the queue runs dry (Runner crashed, network partition, log exhausted).

**That fallback is deliberately not synced.** A safety system must not depend on the
thing it backstops. Configure it once against a deep gold pool, document it, and
accept that it sounds worse than the scheduled format. Its divergence from Rotavox's
intent is the point.

### 3.6 Rotavox does not become the playout system

Not soon, and possibly not ever. Playout is hard-realtime, 24/7, and
liability-bearing — audio devices, crossfades, silence detection, dead-air watchdogs
— and it is the least differentiated layer in the stack. The scheduling brain is
where the value is.

Keep the adapter boundary clean so the door stays open. Revisit only if RadioDJ
becomes the binding constraint.

---

## 4. Changesets: the missing artifact

Music direction is currently formulated in conversation and executed as one-off
scripts. It needs to be a versioned, reviewable artifact.

A **changeset** is a declarative, station-scoped description of intended library
state changes — pool moves, enable/disable, adds, drops — that is:

- authored outside the live system (conversation, UI, or file),
- committed to the repo and reviewable as a diff,
- validated against the current mirror before application,
- applied by the Runner (never by ad-hoc scripts), and
- reversible, with the inverse derivable from the changeset plus the pre-state.

This generalizes the 2026-07-30 W reclassification, which had all five properties
informally and none of them structurally. It is the prerequisite for §3.2 step 2.

---

## 5. PD / MD accountability

| Role | Owns | Today | Target |
|---|---|---|---|
| **MD** — library curation, pool assignment, adds/drops, rotation depth | the *contents* of each pool | RadioDJ + manual SQL | Rotavox, via changesets |
| **PD** — clocks, dayparts, format grid, separation policy, imaging placement | the *shape* of the hour | Rotavox (SQL seed only) | Rotavox, via authoring UI |

Rotavox is expected to absorb both roles' tooling over time. It absorbs the PD
tooling first, because it already owns that data and only lacks a UI.

---

## 6. Consequences

**Accepted:**

- The Runner gains a write path to RadioDJ (§3.3), relaxing the read-only posture.
  Mitigated by: runtime introspection, per-station opt-in, changeset review.
- Soft rules stay inert until audio analysis lands (§3.4).
- The fallback will diverge from the scheduled format, by design (§3.5).
- Clock authoring stays in SQL until the UI exists; the seed file remains the SoT
  for format shape and must be treated as production configuration.

**Required follow-on work**, in priority order:

1. **Changesets as a first-class artifact** (§4) — highest leverage; unblocks §3.2.
2. **Pool-assignment writeback** as an adapter capability (§3.3) — makes changesets
   round-trip instead of dead-ending in MariaDB.
3. **Clock / rule authoring UI** — lifts format authorship out of hand-edited SQL.
4. **Offline audio-analysis pass** (§3.4) — makes the soft rules meaningful.

**Immediate, independent of the above:** record the library↔clockset contract. The
seed's subcategory-ID map (`m3-clubfm-seed.sql:53-76`) and the pool depths it was
sized against should be captured as a committed snapshot and diffed against live
before each re-seed. The absence of this check is what allowed subcategory 34
(Gold Backsells, 26 items) to be mapped into no scheduler category under the M2
seed, silently keeping that imaging off the air.

---

## 7. Open questions

- **ZN (subcategory 39, 148 items)** — unmapped in both M2 and M3 seeds. Intent
  unknown; needs a music-direction decision, not an engineering one.
- **Sonic Logos (32) and Heritage Backsells (35)** — empty at last read, unmapped.
  Harmless today, silently so. Map them when populated.
- **Sequencing:** whether pool-assignment writeback lands before or after the M3
  deploy. Before makes the W reclassification reproducible; after gets the format
  on air sooner.
