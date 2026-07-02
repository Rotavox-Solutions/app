-- M2 seed: one real format clock + category tree + rules + format grid for The BOLT.
-- Hand-authored because the authoring UI is M4. Re-runnable: deletes this station's
-- prior scheduling config (INCLUDING generated logs/log_items — dev convenience) first.
--
-- Station uuid is the single seeded station from M1. If you re-seed the stations
-- table, update it here.
--
-- Category → RadioDJ subcategory mapping (from live introspection, 2026-07-01):
--   A1=24  A2=50  B=25,26  C=27  N=28  Discovery(X)=33
--   Gold 2020s=35  G10=51  G00=31  G90=3
--   Sweepers=8  TOH IDs=52
--
-- Apply: docker exec -i rotavox-postgres-1 psql -U rotavox -d rotavox < packages/schema/seed/m2-clubfm-seed.sql

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
INSERT INTO categories (station_id, name, kind, default_target_turnover_hours) VALUES
  (:'sid', 'Currents', 'music', NULL),
  (:'sid', 'Gold',     'music', NULL);

INSERT INTO categories (station_id, name, kind, parent_id, default_target_turnover_hours) VALUES
  (:'sid', 'A1', 'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Currents'), 3),
  (:'sid', 'A2', 'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Currents'), 5),
  (:'sid', 'B',  'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Currents'), 6),
  (:'sid', 'C',  'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Currents'), 8),
  (:'sid', 'N',  'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Currents'), 6),
  (:'sid', 'Gold 2020s', 'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Gold'), 30),
  (:'sid', 'G10', 'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Gold'), 72),
  (:'sid', 'G00', 'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Gold'), 72),
  (:'sid', 'G90', 'music', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Gold'), 96);

INSERT INTO categories (station_id, name, kind, default_target_turnover_hours) VALUES
  (:'sid', 'Discovery', 'music',   12),
  (:'sid', 'Sweepers',  'imaging',  6),
  (:'sid', 'TOH IDs',   'imaging', 24);

-- ── Song membership (mirror rdj_subcategory_id → scheduler category) ─────────
INSERT INTO song_categories (song_id, category_id)
SELECT s.id, c.id FROM songs s
JOIN categories c ON c.station_id = s.station_id
WHERE s.station_id = :'sid' AND (
  (c.name = 'A1'         AND s.rdj_subcategory_id = 24) OR
  (c.name = 'A2'         AND s.rdj_subcategory_id = 50) OR
  (c.name = 'B'          AND s.rdj_subcategory_id IN (25, 26)) OR
  (c.name = 'C'          AND s.rdj_subcategory_id = 27) OR
  (c.name = 'N'          AND s.rdj_subcategory_id = 28) OR
  (c.name = 'Gold 2020s' AND s.rdj_subcategory_id = 35) OR
  (c.name = 'G10'        AND s.rdj_subcategory_id = 51) OR
  (c.name = 'G00'        AND s.rdj_subcategory_id = 31) OR
  (c.name = 'G90'        AND s.rdj_subcategory_id = 3)  OR
  (c.name = 'Discovery'  AND s.rdj_subcategory_id = 33) OR
  (c.name = 'Sweepers'   AND s.rdj_subcategory_id = 8)  OR
  (c.name = 'TOH IDs'    AND s.rdj_subcategory_id = 52)
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
  ( 3, 'category', 'Gold 2020s', NULL, NULL),
  ( 4, 'sweeper',  'Sweepers',   NULL, NULL),
  ( 5, 'category', 'B',          NULL, NULL),
  ( 6, 'category', 'G10',        NULL, NULL),
  ( 7, 'category', 'N',          NULL, 'Gold 2020s'),
  ( 8, 'category', 'Gold 2020s', NULL, NULL),
  ( 9, 'sweeper',  'Sweepers',   NULL, NULL),
  (10, 'category', 'C',          NULL, 'Gold 2020s'),
  (11, 'category', 'G00',        NULL, NULL),
  (12, 'category', 'A1',         NULL, NULL),
  (13, 'category', 'Gold 2020s', NULL, NULL),
  (14, 'sweeper',  'Sweepers',   NULL, NULL),
  (15, 'category', 'A2',         NULL, 'Gold 2020s'),
  (16, 'category', 'G90',        NULL, 'G00'),
  (17, 'category', 'Discovery',  NULL, 'Gold 2020s'),
  (18, 'category', 'Gold 2020s', NULL, NULL),
  (19, 'category', 'B',          NULL, NULL),
  (20, 'category', 'G10',        NULL, NULL),
  (21, 'category', 'Gold 2020s', NULL, NULL)
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
  (:'sid', 'category', (SELECT id FROM categories WHERE station_id = :'sid' AND name = 'Gold 2020s'),
                             'max_per_hour',      '{"count": 6}',        'hard', NULL);

COMMIT;

-- Sanity counts
SELECT 'categories' AS what, count(*) FROM categories WHERE station_id = :'sid'
UNION ALL SELECT 'song_categories', count(*) FROM song_categories sc JOIN categories c ON c.id = sc.category_id WHERE c.station_id = :'sid'
UNION ALL SELECT 'clock_positions', count(*) FROM clock_positions cp JOIN clocks c ON c.id = cp.clock_id WHERE c.station_id = :'sid'
UNION ALL SELECT 'format_grid', count(*) FROM format_grid WHERE station_id = :'sid'
UNION ALL SELECT 'rules', count(*) FROM rules WHERE station_id = :'sid';
