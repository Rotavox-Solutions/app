# Rebuilding from scratch

Written after losing a broadcast box. Ordered, because two of the steps only work in
one order and the failure mode of getting it wrong is silent — see the two traps below.

Assumes the target layout: **Runner on the Windows RadioDJ box**, Postgres reachable
from it, web app wherever convenient.

## What survives a box loss

Everything in git, including two things that look machine-specific but are tracked:
`apps/runner/schema-map.json` and `apps/runner/rest-capabilities.json`.

**Not** in git, and gone with the box:

| Lost | Rebuild from |
|---|---|
| `apps/runner/.env` | `.env.example` — RadioDJ MariaDB creds, REST port + auth key |
| Postgres (whole DB) | migrations + station row + M2 seed + a full re-sync (below) |
| `sync_state` watermarks | reset to zero; both jobs re-read from the beginning, which is safe |
| `runner.heartbeat` | recreated on the pacer's first tick |

A full re-reconcile is idempotent: `play_history` is uniquely keyed on
`(station_id, rdj_history_id)` and reconciliation inserts `ON CONFLICT DO NOTHING`,
so re-reading RadioDJ's entire `history` cannot double-count plays. A full library
re-sync is likewise an upsert with an explicit set-allowlist, so it will not clobber
Scheduler-owned extended metadata.

---

## The two traps

**1. Library sync must run before the M2 seed.** The seed's `song_categories` insert
(`seed/m2-clubfm-seed.sql`) is a `SELECT ... FROM songs` — it derives pool membership
from rows the sync creates. Seed first and every category comes out empty, generation
has nothing to pick from, and the relaxation ladder bottoms out on every position.

**2. After a RadioDJ reinstall, the seed's subcategory IDs are stale.** Membership is
matched on hardcoded `rdj_subcategory_id` values captured from the old install:

```
A1=24  A2=50  B=25,26  C=27  N=28  Discovery=33
Gold 2020s=35  G10=51  G00=31  G90=3  Sweepers=8  TOH IDs=52
```

A reinstall reassigns those. If the new IDs merely don't match, pools come out empty
and the sanity counts at the end of the seed catch it. If they happen to match
*different* pools, nothing catches it — you get a log that looks fine and airs a
current where a 90s gold belongs. **Re-derive them before seeding** (step 6).

Song IDs themselves also change on a reinstall. That's fine here only because Postgres
is being rebuilt too — a surviving mirror keyed to old `songs.ID` values would have
been worse than useless.

---

## Steps

### 1. RadioDJ (Windows box)

- Enable the REST plugin: copy it out of RadioDJ's *disabled plugins* folder, set an
  auth key and port.
- **AutoDJ off.** The Runner owns the queue.
- **Disable RadioDJ's own hourly "Clear Playlist" rotation events.** Left on, they wipe
  the Runner's queue at every `:00`. This is station config, not code, and it is the
  single easiest thing to forget on a fresh install.
- Confirm min-queue settings won't self-fill against the pusher.

### 2. Node + repo

Node 20+. Clone the repo to the box, then from the repo root:

```
npm install
```

### 3. Postgres

Bring up an instance the Runner and web app can both reach. The repo's
`docker-compose.yml` is the dev shape (`postgres:16-alpine`, db/user/pass all
`rotavox`); on a Windows broadcast box a native service or a separate host is usually
saner than Docker.

The compose file creates the role and database for you. **A native install does not** —
it gives you only the `postgres` superuser, so create them, and grant on the schema:

```
psql -U postgres -c "CREATE ROLE rotavox WITH LOGIN PASSWORD 'rotavox';"
psql -U postgres -c "CREATE DATABASE rotavox OWNER rotavox;"
psql -U postgres -d rotavox -c "GRANT ALL ON SCHEMA public TO rotavox;"
psql -U postgres -d rotavox -c "ALTER SCHEMA public OWNER TO rotavox;"
```

Since PG15 a non-owner role has no `CREATE` on `public` by default, so without those
last two the migration authenticates fine and then fails on the first `CREATE TABLE`
with `permission denied for schema public` (42501). Note the `-d rotavox`: the grant is
per-database, and running it without that silently grants on the wrong one.

```
npm run migrate --workspace=@rotavox/schema
```

Needs `DATABASE_URL` in the environment (see `packages/schema/.env.example`). It
creates the `pgcrypto` extension and applies both migrations.

Each component reads the `.env` in its own directory — `packages/schema/.env` here,
`apps/runner/.env` in step 5, `apps/web/.env` in step 9. `DATABASE_URL` has to be
correct in all three.

### 4. Station row

There is no seed for this and the M2 seed hardcodes the uuid, so it must be recreated
**at exactly this value** or the seed's every `station_id` reference dangles:

```sql
INSERT INTO stations (id, name, timezone)
VALUES ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'The BOLT', 'America/New_York');
```

Adjust name/timezone to taste; keep the uuid. (Or pick a new uuid and update
`\set sid` at the top of the seed — but then update `SCHEDULER_STATION_ID` everywhere
too.)

### 5. Runner `.env` + re-introspection

Copy `apps/runner/.env.example` to `apps/runner/.env` and fill in: RadioDJ MariaDB
host/user/password/db, REST port + auth key, `DATABASE_URL`, and
`SCHEDULER_STATION_ID` set to the uuid from step 4.

Because RadioDJ was reinstalled, regenerate both introspection artifacts rather than
trusting the committed ones:

```
npm run introspect   --workspace=@rotavox/runner   # rewrites schema-map.json
npm run probe-rest   --workspace=@rotavox/runner   # rewrites rest-capabilities.json
```

Check `schema-map.json`'s `"missing": []` is still empty. A non-empty list means the
engine reads a field this install doesn't expose — stop and resolve it there.

### 6. Sync the library, then re-derive the category mapping

```
npm run sync-library --workspace=@rotavox/runner
```

Then read the new install's subcategory IDs (RadioDJ's MariaDB, table names per
`schema-map.json`):

```sql
SELECT s.ID AS subcat_id, c.name AS category, s.name AS subcategory
FROM subcategory s
JOIN category c ON c.ID = s.parentid
ORDER BY c.name, s.name;
```

**The seed already carries the mapping for the 2026-07 rebuild**, so for this rebuild
you only need to confirm the query's output still matches the header comment in
`packages/schema/seed/m2-clubfm-seed.sql`. If it doesn't — or the next time RadioDJ is
reinstalled — update the ID literals in that file's `song_categories` block and its
comment header, and commit it. That file is the record of the current rig.

### 7. Seed the format

```
psql "$DATABASE_URL" -f packages/schema/seed/m2-clubfm-seed.sql
```

The seed ends with two verification queries.

Counts, expected: **23 categories, 21 clock positions, 168 format_grid rows, 6 rules.**

Then a per-pool breakdown, which is the one that actually catches a bad mapping — a
single total hides one category having mapped to a subcategory ID that doesn't exist
here. **Every category the clock references must be non-zero**: `A1 A2 B C N
Recurrents G10 G00 G90 Discovery Sweepers` and `TOH IDs`. (`F H W Z ZN GDEEP` are
seeded but unscheduled, so zero there is only worth noticing, not fixing.)

That query also breaks membership down by `song_type`, because a pool can be mapped
correctly and still schedule nothing: the engine filters on type independently of
category — `category` positions take type 0, `sweeper` positions take 1 or 2. So the
music pools need a non-zero `type_music`, and `Sweepers`/`TOH IDs` need a non-zero
`type_imaging`. If `TOH IDs` shows its tracks under `type_other`, the top-of-hour
position will silently never fill.

### 8. Backfill play history

```
npm run reconcile --workspace=@rotavox/runner
```

On a reinstalled RadioDJ this may find little or nothing — a fresh install has no play
history. That is survivable but worth knowing: separation against *past* plays starts
cold, so the first hours lean entirely on within-log separation (which the engine does
enforce) and on `last_scheduled_at`. Rotation quality tightens as history accumulates.

### 9. Generate and approve a log

The web app owns generation as of M4a. With `DATABASE_URL` and `SCHEDULER_STATION_ID`
set (`apps/web/.env.example`):

```
npm run dev --workspace=@rotavox/web
```

Generate a log at `/logs`, review violations in the cockpit, approve it. The Runner
only paces logs in `approved` status.

### 10. Start the pacer and the watchdog

Two processes, always. The watchdog is what re-enables AutoDJ if the pacer dies, hangs,
or is killed — running the pacer alone means a crash is dead air.

```
npm run pace     --workspace=@rotavox/runner
npm run watchdog --workspace=@rotavox/runner
```

Set `RUNNER_HEARTBEAT_PATH` in `.env` to an absolute path if the two run with different
working directories, or the watchdog will look for a heartbeat that isn't there —
and a heartbeat it cannot read is treated as "unknown, skip", not "stale", so it will
sit quiet forever instead of failing safe. Verify once, deliberately: kill the pacer
with `taskkill /F` and confirm AutoDJ comes back on within ~20 seconds.

### 11. Install as services

`apps/runner/deploy/systemd/` covers Linux only and does **not** apply to a Windows
box. There is no Windows service definition in the repo yet — see Gaps below. Until
there is, NSSM by hand, as two independent services:

```
nssm install RotavoxRunner   "C:\Program Files\nodejs\node.exe"
nssm set     RotavoxRunner   AppDirectory C:\rotavox-app\apps\runner
nssm set     RotavoxRunner   AppParameters "node_modules\tsx\dist\cli.mjs src\pace.ts"

nssm install RotavoxWatchdog "C:\Program Files\nodejs\node.exe"
nssm set     RotavoxWatchdog AppDirectory C:\rotavox-app\apps\runner
nssm set     RotavoxWatchdog AppParameters "node_modules\tsx\dist\cli.mjs src\watchdog.ts"
```

Keep them independent — no dependency between the two services. The watchdog's whole
job is to keep working when the runner doesn't, and coupling their lifecycles defeats
it. Note that NSSM stops services with a kill by default, which skips the pacer's
graceful hand-back to AutoDJ; the watchdog covers that gap, but configure
`AppStopMethodConsole` if you want the clean path.

---

## Gaps

- **No Windows service definition.** The committed systemd units target Linux; the
  actual deployment is Windows. NSSM by hand works (step 11) but isn't reproducible.
- **The M4.5 fail-safe has never run on a rig.** Unit-tested, not field-tested.
- **The Runner talks to Postgres directly** rather than through the SaaS API that spec
  §7 describes. Fine co-located; blocks the SaaS story.
- **No authoring UI** for categories, clocks, format grid, or rules (§8 items 1–4).
  Until those exist, the format lives in `m2-clubfm-seed.sql` and every change is a
  SQL edit — including the step-6 remapping above.
