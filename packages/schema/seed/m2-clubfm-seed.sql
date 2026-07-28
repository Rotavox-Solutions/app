-- M2 seed: one real format clock + category tree + rules + format grid for The BOLT.
-- Hand-authored because the authoring UI is M4. Re-runnable: deletes this station's
-- prior scheduling config (INCLUDING generated logs/log_items — dev convenience) first.
--
-- Station uuid is the single seeded station from M1. If you re-seed the stations
-- table, update it here.
--
-- Category → RadioDJ subcategory mapping (re-derived after the 2026-07 RadioDJ
-- rebuild; supersedes the 2026-07-01 mapping, which the reinstall invalidated —
-- see DEPLOY.md step 6):
--   A1=4  A2=2  B=1,5  C=3  N=23  Discovery(X)=6
--   R1=24  R2=25  R3=26                          (Recurrents — see note below)
--   G90=27  G00=28  G10=29  GDEEP=37
--   Sweepers=8,9,32,33  TOH IDs=10
--   Unscheduled tiers: F=31  H=30  W=36  Z=38  ZN=39
--
-- NOTE — 'Gold 2020s' is gone. The rebuilt install has no 2020s gold tier, and the
-- old category's 30h turnover was recurrent rotation, not gold rotation (the real
-- gold tiers sit at 72-96h). It is replaced by 'Recurrents' over R1/R2/R3, which is
-- what that tier evidently became.
--
-- CLOCK REBALANCE — the inherited clock hit that tier five times an hour, which only
-- worked when it was a full gold pool. Here it is R1's 8 songs (R2/R3 are empty), and
-- five slots an hour against a 150-minute title separation is unsatisfiable by
-- pigeonhole: ~12.5 slots per window, 8 distinct songs. The ladder would have relaxed
-- on nearly every recurrent pick. So:
--   * Recurrents 5 positions -> 2 (sustainable on 8 songs)
--   * H (heritage, 80s and older, 100 songs) gains 2 positions. The old install had
--     no heritage tier, so the inherited clock had nowhere to put it and it sat
--     entirely unscheduled.
--   * G90 gains the remaining position (1 -> 2).
--   * The four fallbacks that pointed at Recurrents now point at G10 — falling back
--     into the pool that is itself the bottleneck defeats the purpose, and G10 is the
--     closest era to the currents those positions serve.
-- Music positions stay at 17 and the clock stays at 21.
--
-- WARNING — do NOT reuse a mapping across a RadioDJ reinstall. Under the old install
-- C=27, G90=3, N=28 and Discovery=33; in this one those same IDs are G1990, C,
-- G2000 and New-Music Sweepers respectively. Stale IDs don't fail loudly, they
-- silently fill pools from the wrong content.
--
-- Apply: psql "$DATABASE_URL" -f packages/schema/seed/m2-clubfm-seed.sql
-- Requires the library sync to have run first — song_categories is derived from
-- `songs`, so seeding an empty mirror yields empty pools.

BEGIN;

\set sid '6a42a599-acfc-404f-a524-9fb9b65d36f3'

DELETE FROM log_items WHERE log_id IN (SELECT id FROM logs WHERE station_id = :'sid');
DELETE FROM logs WHERE station_id = :'sid';
DELETE FROM format_grid WHERE station_id = :'sid';
DELETE FROM clock_positions WHERE clock_id IN (SELECT id FROM clocks WHERE station_id = :'sid');
DELETE FROM clocks WHERE station_id = :'sid';
DELETE FROM rules WHERE station_id = :'sid';
DELETE FROM song_categories WHERE category_id IN (SELECT id FROM categories WHERE station_id = :'sid');
DELETE FROM categories WHERE station_id = :'sid';

-- ── Categories ────────────────────────────────────────────────────────────────
-- Parents hold no membership of their own; the engine pools a position's category
-- subtree inclusively (packages/engine/src/rules.ts `subtree`), so a clock position
-- naming 'Recurrents' draws from R1 ∪ R2 ∪ R3.
INSERT INTO categories (station_id, name, kind, default_target_turnover_hours) VALUES
  (:'sid', 'Currents',   'music', NULL),
  (:'sid', 'Recurrents', 'music', NULL),
  (:'sid', 'Gold',       'music', NULL);

INSERT INTO categories (station_id, name, kind, parent_id, default_target_turnover_hours) VALUES
  (:'sid', 'A1', 'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Currents'), 3),
  (:'sid', 'A2', 'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Currents'), 5),
  (:'sid', 'B',  'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Currents'), 6),
  (:'sid', 'C',  'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Currents'), 8),
  (:'sid', 'N',  'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Currents'), 6),
  -- 4h, not the 30h carried over from the retired 'Gold 2020s': the tier is only
  -- R1's 8 songs (R2/R3 are empty on this install) against 2 positions an hour, so
  -- 30h was fiction and would have skewed restScore for every recurrent pick. Raise
  -- this back toward 30 — and restore the clock's other three Recurrent positions —
  -- if R1/R2/R3 are ever filled out on the RadioDJ side.
  (:'sid', 'R1', 'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Recurrents'), 4),
  (:'sid', 'R2', 'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Recurrents'), 4),
  (:'sid', 'R3', 'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Recurrents'), 4),
  (:'sid', 'G10',   'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Gold'), 72),
  (:'sid', 'G00',   'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Gold'), 72),
  (:'sid', 'G90',   'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Gold'), 96),
  (:'sid', 'GDEEP', 'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Gold'), NULL),
  -- Heritage (80s and older). A gold tier the old install had no equivalent of, so
  -- the inherited clock had nowhere to put it and its 100 songs sat unscheduled.
  -- 50h ≈ 100 songs across 2 positions an hour.
  (:'sid', 'H',     'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Gold'), 50);

INSERT INTO categories (station_id, name, kind, default_target_turnover_hours) VALUES
  (:'sid', 'Discovery', 'music',   12),
  (:'sid', 'Sweepers',  'imaging',  6),
  (:'sid', 'TOH IDs',   'imaging', 24);

-- Present so the pools exist and are pickable once the authoring UI lands; no clock
-- position references them, so nothing schedules them yet.
-- W is benched material and ZN is rested/killed new music — both are deliberately
-- out of rotation, so their size (911 and 148) is correct, not a mapping error.
INSERT INTO categories (station_id, name, kind, default_target_turnover_hours) VALUES
  (:'sid', 'F',  'music', NULL),
  (:'sid', 'W',  'music', NULL),
  (:'sid', 'Z',  'music', NULL),
  (:'sid', 'ZN', 'music', NULL);

-- ── Song membership (mirror rdj_subcategory_id → scheduler category) ─────────
INSERT INTO song_categories (song_id, category_id)
SELECT s.id, c.id FROM songs s
JOIN categories c ON c.station_id = s.station_id
WHERE s.station_id = :'sid' AND (
  (c.name = 'A1'        AND s.rdj_subcategory_id = 4)  OR
  (c.name = 'A2'        AND s.rdj_subcategory_id = 2)  OR
  (c.name = 'B'         AND s.rdj_subcategory_id IN (1, 5))  OR
  (c.name = 'C'         AND s.rdj_subcategory_id = 3)  OR
  (c.name = 'N'         AND s.rdj_subcategory_id = 23) OR
  (c.name = 'R1'        AND s.rdj_subcategory_id = 24) OR
  (c.name = 'R2'        AND s.rdj_subcategory_id = 25) OR
  (c.name = 'R3'        AND s.rdj_subcategory_id = 26) OR
  (c.name = 'G90'       AND s.rdj_subcategory_id = 27) OR
  (c.name = 'G00'       AND s.rdj_subcategory_id = 28) OR
  (c.name = 'G10'       AND s.rdj_subcategory_id = 29) OR
  (c.name = 'GDEEP'     AND s.rdj_subcategory_id = 37) OR
  (c.name = 'Discovery' AND s.rdj_subcategory_id = 6)  OR
  (c.name = 'Sweepers'  AND s.rdj_subcategory_id IN (8, 9, 32, 33)) OR
  (c.name = 'TOH IDs'   AND s.rdj_subcategory_id = 10) OR
  (c.name = 'F'         AND s.rdj_subcategory_id = 31) OR
  (c.name = 'H'         AND s.rdj_subcategory_id = 30) OR
  (c.name = 'W'         AND s.rdj_subcategory_id = 36) OR
  (c.name = 'Z'         AND s.rdj_subcategory_id = 38) OR
  (c.name = 'ZN'        AND s.rdj_subcategory_id = 39)
);

-- ── Clock: CHR Standard Hour (21 positions, ≈57 min; TOH re-sync absorbs slack) ─
INSERT INTO clocks (station_id, name, length_minutes, notes) VALUES
  (:'sid', 'CHR Standard Hour', 60, 'M2 seed clock — hand-authored, UI comes in M4');

INSERT INTO clock_positions (clock_id, sort_order, position_type, category_id, target_offset_seconds, constraints)
SELECT c.id, p.sort_order, p.position_type, cat.id, p.target_offset_seconds,
       CASE WHEN p.fallback_name IS NOT NULL THEN jsonb_build_object(
         'fallbackCategoryId',
         (SELECT id FROM categories WHERE station_id = :'sid' AND name = p.fallback_name)::text
       ) END
FROM clocks c,
LATERAL (VALUES
  ( 1, 'sweeper',  'TOH IDs',    0,    NULL),
  ( 2, 'category', 'A1',         NULL, NULL),
  ( 3, 'category', 'Recurrents', NULL, NULL),
  ( 4, 'sweeper',  'Sweepers',   NULL, NULL),
  ( 5, 'category', 'B',          NULL, NULL),
  ( 6, 'category', 'G10',        NULL, NULL),
  ( 7, 'category', 'N',          NULL, 'G10'),
  ( 8, 'category', 'H',          NULL, NULL),
  ( 9, 'sweeper',  'Sweepers',   NULL, NULL),
  (10, 'category', 'C',          NULL, 'G10'),
  (11, 'category', 'G00',        NULL, NULL),
  (12, 'category', 'A1',         NULL, NULL),
  (13, 'category', 'Recurrents', NULL, NULL),
  (14, 'sweeper',  'Sweepers',   NULL, NULL),
  (15, 'category', 'A2',         NULL, 'G10'),
  (16, 'category', 'G90',        NULL, 'G00'),
  (17, 'category', 'Discovery',  NULL, 'G10'),
  (18, 'category', 'H',          NULL, NULL),
  (19, 'category', 'B',          NULL, NULL),
  (20, 'category', 'G10',        NULL, NULL),
  (21, 'category', 'G90',        NULL, NULL)
) AS p(sort_order, position_type, category_name, target_offset_seconds, fallback_name)
JOIN categories cat ON cat.station_id = :'sid' AND cat.name = p.category_name
WHERE c.station_id = :'sid' AND c.name = 'CHR Standard Hour';

-- ── Format grid: every hour of every day → the one clock ─────────────────────
INSERT INTO format_grid (station_id, day_of_week, hour, clock_id)
SELECT :'sid', d, h, (SELECT id FROM clocks WHERE station_id = :'sid' AND name = 'CHR Standard Hour')
FROM generate_series(0, 6) d, generate_series(0, 23) h;

-- ── Rules ─────────────────────────────────────────────────────────────────────
INSERT INTO rules (station_id, scope, scope_ref, rule_type, params, hardness, weight) VALUES
  (:'sid', 'global',   NULL, 'artist_separation', '{"minMinutes": 45}',  'hard', NULL),
  (:'sid', 'global',   NULL, 'title_separation',  '{"minMinutes": 150}', 'hard', NULL),
  (:'sid', 'category', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Currents'),
                             'artist_separation', '{"minMinutes": 30}',  'hard', NULL),
  (:'sid', 'global',   NULL, 'tempo_clash',       '{"maxJump": 2}',      'soft', 0.2),
  (:'sid', 'global',   NULL, 'era_spread',        '{}',                  'soft', 0.15),
  -- Scoped to the Recurrents parent, so the cap applies across R1+R2+R3 combined
  -- (category-scoped rules resolve over the subtree) — same intent as the old
  -- 'Gold 2020s' cap, which was a single flat pool.
  (:'sid', 'category', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Recurrents'),
                             'max_per_hour',      '{"count": 6}',        'hard', NULL);

COMMIT;

-- ── Verification ──────────────────────────────────────────────────────────────
-- Expected: 23 categories, 21 clock_positions, 168 format_grid, 6 rules.
SELECT 'categories' AS what, count(*) FROM categories WHERE station_id = :'sid'
UNION ALL SELECT 'song_categories', count(*) FROM song_categories sc JOIN categories c ON c.id = sc.category_id WHERE c.station_id = :'sid'
UNION ALL SELECT 'clock_positions', count(*) FROM clock_positions cp JOIN clocks c ON c.id = cp.clock_id WHERE c.station_id = :'sid'
UNION ALL SELECT 'format_grid', count(*) FROM format_grid WHERE station_id = :'sid'
UNION ALL SELECT 'rules', count(*) FROM rules WHERE station_id = :'sid';

-- Per-pool membership. A total count alone hides the failure that matters: one
-- category mapped to a subcategory ID that doesn't exist in this install. Every
-- category the clock references must be non-zero.
-- `songs` also carries song_type, and the engine filters on it independently of
-- category (songTypeMap: category positions take type 0, sweeper positions 1 or 2),
-- so a pool can be correctly mapped and still yield nothing schedulable — hence the
-- type breakdown alongside the count.
SELECT c.name AS category,
       count(sc.song_id) AS songs,
       count(*) FILTER (WHERE s.song_type = 0) AS type_music,
       count(*) FILTER (WHERE s.song_type IN (1, 2)) AS type_imaging,
       count(*) FILTER (WHERE s.song_type NOT IN (0, 1, 2)) AS type_other
FROM categories c
LEFT JOIN song_categories sc ON sc.category_id = c.id
LEFT JOIN songs s ON s.id = sc.song_id
WHERE c.station_id = :'sid'
GROUP BY c.name
ORDER BY songs, c.name;
