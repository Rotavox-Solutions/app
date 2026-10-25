# Changeset Data Contract v1

- **Status:** Draft for settlement
- **Date:** 2026-07-31 · amended 2026-10-17 (`set_tags`)
- **Implements:** `ADR-0001-source-of-truth-and-ownership.md` §4 (changesets), §3.2
  (pool assignment), §3.3 (writeback as adapter capability), §3.7 (lifecycle)

---

## 1. Purpose and scope

A **changeset** is the reviewable, reversible unit by which music-direction decisions
reach the library. It replaces ad-hoc `UPDATE` scripts against live RadioDJ.

**This is a v1 for the current iteration.** Per ADR §3.7, changesets are the unit of
*application*, not authorship — the target state is that standing lifecycle rules
generate them. v1 supports hand-authored move lists only, but reserves the provenance
fields a rule engine will need (§6), so v2 is additive rather than a rewrite.

### Control flow this contract serves

```
settle category composition + rules
  → [CC]      produce category sheet          (§4)
  → [non-CC]  return changeset                (§3)
  → [CC]      validate, apply, emit inverse   (§5)
  → [PD]      approve, or circle back
  → [PD]      generate + approve log
  → pacer executes
```

### What a changeset is not

- Not a clock or rule change. Those are Rotavox-owned (ADR §2) and edited in the seed
  or, later, the authoring UI.
- Not a log edit. Log corrections happen in the log UI and do not alter the library.
- Not a metadata enrichment channel. Derived year/BPM/key arrive via the §3.4 offline
  pass with their own provenance, not through hand-authored changesets. `set_tags`
  (§3, added 2026-10-17) is **hygiene, not enrichment**: it corrects artist and title
  strings that are visibly wrong, such as Promo Only key/BPM suffixes, `AC; DC` or band-member
  lists. It never asserts a fact the library didn't already carry.

---

## 2. Target and identity

**Target:** RadioDJ's `songs` table on the live rig. Per ADR §3.2 the migration is
staged, and stage 1 has RadioDJ as source of truth for pool assignment — so v1 writes
there and the scheduler mirror follows by re-sync. When §3.2 stage 3 lands, the same
contract retargets to Rotavox with RadioDJ becoming a projection; the file format does
not change.

**Identity is `rdj_song_id` (RadioDJ `songs.ID`), always.** Artist and title appear in
the format for human review only and are **never** used for matching. A changeset that
resolved songs by tag would silently move the wrong record whenever tags drift — and
per ADR §3.4 this library's tags are known-unreliable.

**Application path:** the Runner, per invariant #4. Column names resolved through
runtime introspection (`schema-map.json`), never hardcoded — invariant #1 and ADR §3.3.

---

## 3. Changeset format

JSON. One file per changeset, committed to the repo under `changesets/`.

Changesets authored in the Rotavox UI (ADR-0002 §3) live in Postgres. The Runner's
`project-changesets` command converts each applied one into this format under
`changesets/rotavox/`, with `basis.sheet_id` set to `rotavox:<changeset id>`. It applies
them through the same validation and inverse path as hand-authored files.

```jsonc
{
  "changeset_version": 1,
  "id": "2026-07-31-currents-depth",        // unique; becomes the filename stem
  "station_id": "6a42a599-acfc-404f-a524-9fb9b65d36f3",
  "authored_at": "2026-07-31",
  "intent": "Deepen A1/A2 from rested-N stock; retire three duplicates.",

  "basis": {
    "sheet_id": "2026-07-31-full",          // category sheet this was authored from
    "sheet_captured_at": "2026-07-31T13:24:45-06:00"
  },

  "moves": [
    {
      "rdj_song_id": 4471,
      "artist": "Spiritbox",                 // review only — never matched on
      "title": "Soft Spine",
      "from_subcat": 39,                     // precondition; apply fails on mismatch
      "to_subcat": 24,
      "reason": "Rested 8mo, charted 2025, fills R1 depth"
    }
  ],

  "set_enabled": [
    {
      "rdj_song_id": 2210,
      "artist": "…",
      "title": "…",
      "from_enabled": true,
      "to_enabled": false,
      "reason": "Duplicate of 1884, lower bitrate"
    }
  ],

  "set_tags": [
    {
      "rdj_song_id": 998,
      "artist": "Rome, Dirty Heads",        // EXACT live value — the precondition
      "title": "Slow & Easy 10A 92",
      "to_title": "Slow & Easy",             // to_artist / to_title: either or both
      "reason": "Strip Promo Only key/BPM suffix"
    }
  ]
}
```

**All operation arrays are optional**; an empty or absent array is valid. They are
kept separate rather than unified behind an `op` discriminator because a uniform row
shape is materially less error-prone to author as text.

### Field rules

| Field | Required | Notes |
|---|---|---|
| `changeset_version` | yes | Must be `1`. Guards against silent format drift. |
| `id` | yes | Kebab-case, date-prefixed, unique. Filename stem. |
| `station_id` | yes | Must match the target station. |
| `intent` | yes | Prose. Why this exists — the thing a diff cannot show. |
| `basis.sheet_id` | yes | Ties decisions to the evidence they were made on. |
| `moves[].from_subcat` | yes | **Precondition.** See §5. |
| `moves[].reason` | yes | Per row. Forces per-song justification, and is what makes the changeset reviewable rather than merely auditable. |
| `artist` / `title` | yes | Review only. Mismatch against live is a hard failure (§5). **In `set_tags` they are the from-state** and must match live byte for byte (see below). |
| `set_tags[].to_artist` / `to_title` | at least one | The new value. Must be non-empty, have no leading or trailing whitespace, and differ from the from-state. A case-only change counts as a change. |

### `set_tags` (added 2026-10-17)

Corrects a song's artist and/or title in RadioDJ. Where it differs from the other ops:

- **The precondition is exact.** Elsewhere, artist and title are compared after `normalizeTag`
  (case and whitespace folded), because they are only there for review. Here they *are* the
  field being written. A normalized compare would let `Awolnation`→`AWOLNATION` pass
  against a row someone had already re-cased, and the inverse would then restore a
  value that was never live. The apply-time `UPDATE` re-asserts the precondition with `BINARY`,
  because RadioDJ's collation is case-insensitive.
- **`--allow-tag-drift` does not apply.** Drift on a tag that is about to be overwritten
  means someone else edited that same field. Overwriting it would silently discard their edit.
- **It writes RadioDJ's `songs` row, not the audio file's ID3 tags.** Anything that
  re-reads tags from the file (re-import, "update from file") reverts the fix. Fix the file
  too if it will be re-imported.
- **It invalidates the tag preconditions of every earlier changeset and inverse** that names the
  song. Replaying or rolling one of them back afterwards needs `--allow-tag-drift`, which is the
  legitimate-correction case that flag exists for.
- An inverse only carries `set_tags` when its changeset had them, so inverses of move-only
  changesets stay readable by an applier that predates this op.

`reason` being mandatory is deliberate. The 2026-07-30 W pass produced 312 moves whose
rationale existed only in agent transcripts; a year from now, "why is this in R2" has
no answer. The field costs the author one line and preserves the decision.

---

## 4. Category sheet format

What CC produces and non-CC authors against. Because the authoring side has no
database access, the sheet must be self-sufficient — every fact needed for a decision
present in the text.

**Two parts in one file: a header block, then TSV rows.**

### 4a. Header — the decision context

- **Pool depths**: total and *enabled* per pool. Enabled is the real depth; the engine
  filters on it (`packages/engine/src/candidates.ts:28`).
- **Weekly demand per category**, computed from `clock_positions` × `format_grid` —
  how many slots the format actually calls for each pool per week.
- **Supply vs demand ratio** per pool, and the configured turnover target. This is the
  number that makes the sheet actionable: a pool with 7 songs against 140 weekly slots
  is the repetition complaint, stated arithmetically.
- **Rules in force**, from the `rules` table — separations, max-per-hour, dayparts.
- **Known-bad data warnings** — currently: year untrusted everywhere; BPM absent on
  ~99% of gold (ADR §3.4).

### 4b. Rows — one per song

```
rdj_song_id  artist  title  subcat_id  subcat  enabled  duration_s  year*  bpm*  date_added  last_played  play_count
```

`year*` and `bpm*` carry a trailing marker because they are untrusted (§3.4) — present
so the author can see what RadioDJ believes, flagged so it is not mistaken for fact.

**Scope per sheet** should be stated in the header and kept to the pools under
consideration. A full-library sheet is ~1,450 rows; a currents-depth sheet drawn from
N, ZN, R1 and W is a few hundred. Prefer the narrow sheet — it keeps decisions
reviewable and the authoring context focused.

---

## 5. Validation and application

Applied by a Runner subcommand. **Never** by ad-hoc scripts.

### Preflight — all checks pass before any write

1. `changeset_version` is 1; `station_id` matches the target.
2. Every `rdj_song_id` exists in live `songs`.
3. Every `from_subcat` matches live. **Any mismatch aborts the entire changeset** —
   it means live drifted since the sheet was cut, so every decision in the file was
   made against stale evidence, not just the mismatched row.
4. Every `artist`/`title` matches live. Hard failure by default; `--allow-tag-drift`
   downgrades to a warning for cases where tags were legitimately corrected in between.
5. Every `to_subcat` exists in `subcategory`.
6. No `rdj_song_id` appears more than once across all operation arrays.
7. Every `reason` is non-empty.
8. Every `set_tags` from-state (`artist`, `title`) equals live exactly. This is never
   downgraded by `--allow-tag-drift`.

### Apply

- **Single transaction, all-or-nothing.** A partially applied changeset is the worst
  outcome — it leaves the library in a state matching no reviewed artifact.
- **Emits an inverse changeset before committing**, written to
  `changesets/inverse/<id>.json`. Derivable because every operation carries its `from`
  state. This is the rollback artifact, and it exists whether or not anyone expects to
  need it.
- **Writes a run record**: changeset id, timestamp, operation count, live DB identity.
- **Requires explicit operator confirmation.** Applying writes to the live broadcast
  library; it is never implied by validation succeeding.

### After apply

Re-sync the mirror (`sync-library`) so the scheduler's Postgres reflects the new
`id_subcat` (and, after `set_tags`, the new artist/title, which feed separation rules)
before any log generation. A log generated between apply and re-sync uses
stale pool membership.

---

## 6. Reserved for v2

Fields a rule-generated changeset will need, specified now so v1 files stay readable
by a v2 applier:

- `generated_by`: `{ "rule_id": …, "engine_version": … }` on the changeset, and
  optionally per operation — distinguishing rule output from hand authorship.
- `lifecycle`: naming the transition a move represents (`rest`, `promote`, `demote`,
  `bench`, `unbench`) rather than only its endpoints. Per ADR §3.7 the transition is
  the meaningful unit; `Z[x]`'s pool-of-origin becomes a modeled field here.
- `effective_at`: scheduled rather than immediate application.

v1 appliers must reject unknown top-level keys rather than ignoring them, so a v2 file
fails loudly against a v1 applier instead of applying a subset.

---

## 7. Open for settlement

1. **Sheet scope for this iteration** — full library, or the currents-depth slice
   (N, ZN, R1, W)? Recommend the slice; it's the actual complaint.
2. **Gold tier precision.** Recommend coarse-only gold decisions this pass (in/out,
   H vs not) and deferring G1990/G2000/G2010 placement to the MusicBrainz redating,
   so judgment isn't spent on assignments the corrected years will overturn.
3. **Rest exit path** (ADR §7) — still open, and it determines whether ZN→R moves in
   this iteration are one-off judgments or the first instance of a standing rule.
