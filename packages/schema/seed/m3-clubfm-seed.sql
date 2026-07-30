-- M3 seed: daypart + weekend format for The BOLT. Supersedes m2 (single static clock).
-- 11 clocks, split contextual imaging, 7-day grid. Phase 1: single week (cycleWeeks=1).
-- Requires a library re-sync FIRST (song_categories derives from songs.rdj_subcategory_id,
-- which must reflect the 2026-07-30 W reclassification). Promos are song_type=4 — the engine
-- must allow type 4 on sweeper positions (packages/engine/src/types.ts songTypeMap) or promo
-- positions yield nothing.
BEGIN;

DELETE FROM log_items WHERE log_id IN (SELECT id FROM logs WHERE station_id = '6a42a599-acfc-404f-a524-9fb9b65d36f3');
DELETE FROM logs WHERE station_id = '6a42a599-acfc-404f-a524-9fb9b65d36f3';
DELETE FROM format_grid WHERE station_id = '6a42a599-acfc-404f-a524-9fb9b65d36f3';
DELETE FROM clock_positions WHERE clock_id IN (SELECT id FROM clocks WHERE station_id = '6a42a599-acfc-404f-a524-9fb9b65d36f3');
DELETE FROM clocks WHERE station_id = '6a42a599-acfc-404f-a524-9fb9b65d36f3';
DELETE FROM rules WHERE station_id = '6a42a599-acfc-404f-a524-9fb9b65d36f3';
DELETE FROM song_categories WHERE category_id IN (SELECT id FROM categories WHERE station_id = '6a42a599-acfc-404f-a524-9fb9b65d36f3');
DELETE FROM categories WHERE station_id = '6a42a599-acfc-404f-a524-9fb9b65d36f3';

-- Station rotation config (phase 1: no week rotation yet)
UPDATE stations SET format_cycle_weeks = 1, format_cycle_epoch = NULL WHERE id = '6a42a599-acfc-404f-a524-9fb9b65d36f3';

-- Parent music categories
INSERT INTO categories (station_id, name, kind, default_target_turnover_hours) VALUES
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'Currents', 'music', NULL),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'Recurrents', 'music', NULL),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'Gold', 'music', NULL),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'Discovery', 'music', 12);

-- Child + standalone music categories
INSERT INTO categories (station_id, name, kind, parent_id, default_target_turnover_hours) VALUES
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'A1', 'music', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Currents'), 3),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'A2', 'music', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Currents'), 5),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'B', 'music', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Currents'), 6),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'C', 'music', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Currents'), 8),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'N', 'music', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Currents'), 6),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'R1', 'music', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Recurrents'), 30),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'R2', 'music', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Recurrents'), 36),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'R3', 'music', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Recurrents'), 48),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'G2010', 'music', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold'), 72),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'G2000', 'music', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold'), 96),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'G1990', 'music', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold'), 120),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'H', 'music', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold'), 120),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'GDEEP', 'music', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold'), NULL);

-- Imaging categories (contextual: split out from the old lumped 'Sweepers')
INSERT INTO categories (station_id, name, kind, default_target_turnover_hours) VALUES
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'TOH IDs', 'imaging', 24),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'Liners', 'imaging', 4),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'Relaunch Sweepers', 'imaging', 6),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'New-Music Sweepers', 'imaging', 6),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'Gold Backsells', 'imaging', 8),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'Station Promos', 'imaging', 8);

-- Song membership (rdj_subcategory_id -> scheduler category)
INSERT INTO song_categories (song_id, category_id)
SELECT s.id, c.id FROM songs s JOIN categories c ON c.station_id = s.station_id
WHERE s.station_id = '6a42a599-acfc-404f-a524-9fb9b65d36f3' AND (
  (c.name = 'A1' AND s.rdj_subcategory_id =4) OR
  (c.name = 'A2' AND s.rdj_subcategory_id =2) OR
  (c.name = 'B' AND s.rdj_subcategory_id IN (1,5)) OR
  (c.name = 'C' AND s.rdj_subcategory_id =3) OR
  (c.name = 'N' AND s.rdj_subcategory_id =23) OR
  (c.name = 'R1' AND s.rdj_subcategory_id =24) OR
  (c.name = 'R2' AND s.rdj_subcategory_id =25) OR
  (c.name = 'R3' AND s.rdj_subcategory_id =26) OR
  (c.name = 'G2010' AND s.rdj_subcategory_id =29) OR
  (c.name = 'G2000' AND s.rdj_subcategory_id =28) OR
  (c.name = 'G1990' AND s.rdj_subcategory_id =27) OR
  (c.name = 'H' AND s.rdj_subcategory_id =30) OR
  (c.name = 'GDEEP' AND s.rdj_subcategory_id =37) OR
  (c.name = 'Discovery' AND s.rdj_subcategory_id =6) OR
  (c.name = 'TOH IDs' AND s.rdj_subcategory_id =10) OR
  (c.name = 'Liners' AND s.rdj_subcategory_id =9) OR
  (c.name = 'Relaunch Sweepers' AND s.rdj_subcategory_id =8) OR
  (c.name = 'New-Music Sweepers' AND s.rdj_subcategory_id =33) OR
  (c.name = 'Gold Backsells' AND s.rdj_subcategory_id =34) OR
  (c.name = 'Station Promos' AND s.rdj_subcategory_id =12)
);

-- Clocks
INSERT INTO clocks (station_id, name, length_minutes, notes) VALUES
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'AM Drive', 60, 'M3 daypart clock'),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'Midday', 60, 'M3 daypart clock'),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'PM Drive', 60, 'M3 daypart clock'),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'Evening', 60, 'M3 daypart clock'),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'Overnight', 60, 'M3 daypart clock'),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'Gold Lunch', 60, 'M3 daypart clock'),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'WKND AM', 60, 'M3 daypart clock'),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'WKND Midday', 60, 'M3 daypart clock'),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'WKND PM', 60, 'M3 daypart clock'),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'WKND Evening', 60, 'M3 daypart clock'),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 'WKND Overnight', 60, 'M3 daypart clock');

-- Clock positions
INSERT INTO clock_positions (clock_id, sort_order, position_type, category_id, target_offset_seconds, constraints)
VALUES
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 1, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='TOH IDs'), 0, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 2, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A1'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 3, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='B'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 4, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 5, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='C'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 6, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 7, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='New-Music Sweepers'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 8, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='N'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 9, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 10, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Relaunch Sweepers'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 11, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R1'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 12, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 13, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 14, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='C'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 15, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A1'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 16, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Station Promos'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 17, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='B'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 18, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 19, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 20, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G1990'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 21, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 22, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 23, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R3'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive'), 24, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Discovery'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text)));

INSERT INTO clock_positions (clock_id, sort_order, position_type, category_id, target_offset_seconds, constraints)
VALUES
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 1, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='TOH IDs'), 0, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 2, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A1'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 3, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='B'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 4, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 5, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='C'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 6, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 7, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='New-Music Sweepers'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 8, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='N'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 9, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 10, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Relaunch Sweepers'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 11, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R1'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 12, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 13, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 14, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='C'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 15, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='B'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 16, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Station Promos'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 17, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 18, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 19, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 20, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G1990'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 21, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='H'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 22, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 23, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R3'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday'), 24, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Discovery'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text)));

INSERT INTO clock_positions (clock_id, sort_order, position_type, category_id, target_offset_seconds, constraints)
VALUES
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 1, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='TOH IDs'), 0, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 2, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A1'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 3, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='B'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 4, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 5, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='C'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 6, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 7, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='New-Music Sweepers'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 8, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='N'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 9, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 10, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Relaunch Sweepers'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 11, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R1'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 12, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='C'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 13, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 14, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='B'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 15, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A1'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 16, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Station Promos'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 17, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='C'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 18, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 19, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 20, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 21, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G1990'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 22, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 23, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R3'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive'), 24, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Discovery'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text)));

INSERT INTO clock_positions (clock_id, sort_order, position_type, category_id, target_offset_seconds, constraints)
VALUES
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 1, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='TOH IDs'), 0, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 2, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A1'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 3, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='B'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 4, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 5, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R1'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 6, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 7, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 8, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 9, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 10, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 11, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 12, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G1990'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 13, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='New-Music Sweepers'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 14, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Discovery'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 15, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='C'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 16, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Station Promos'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 17, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 18, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 19, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 20, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 21, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G1990'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 22, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 23, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R3'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening'), 24, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='H'), NULL, NULL);

INSERT INTO clock_positions (clock_id, sort_order, position_type, category_id, target_offset_seconds, constraints)
VALUES
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 1, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='TOH IDs'), 0, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 2, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A1'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 3, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 4, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 5, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 6, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 7, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 8, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G1990'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 9, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='H'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 10, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 11, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 12, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 13, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='B'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 14, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 15, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 16, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R3'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 17, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 18, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G1990'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 19, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='H'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 20, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 21, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight'), 22, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Discovery'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text)));

INSERT INTO clock_positions (clock_id, sort_order, position_type, category_id, target_offset_seconds, constraints)
VALUES
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 1, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='TOH IDs'), 0, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 2, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 3, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 4, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 5, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 6, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G1990'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 7, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='H'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 8, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 9, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 10, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 11, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 12, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G1990'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 13, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 14, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 15, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='H'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 16, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 17, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 18, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G1990'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 19, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 20, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Station Promos'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 21, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch'), 22, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Discovery'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text)));

INSERT INTO clock_positions (clock_id, sort_order, position_type, category_id, target_offset_seconds, constraints)
VALUES
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 1, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='TOH IDs'), 0, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 2, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A1'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 3, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='B'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 4, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 5, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='C'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 6, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 7, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='New-Music Sweepers'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 8, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R1'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 9, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 10, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Relaunch Sweepers'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 11, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 12, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 13, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 14, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R3'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 15, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A1'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 16, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Station Promos'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 17, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='B'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 18, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 19, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 20, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G1990'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 21, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 22, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 23, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R3'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM'), 24, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Discovery'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text)));

INSERT INTO clock_positions (clock_id, sort_order, position_type, category_id, target_offset_seconds, constraints)
VALUES
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 1, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='TOH IDs'), 0, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 2, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A1'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 3, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='B'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 4, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 5, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R1'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 6, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 7, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 8, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 9, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 10, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Relaunch Sweepers'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 11, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 12, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G1990'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 13, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 14, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='C'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 15, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='B'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 16, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Station Promos'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 17, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R3'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 18, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 19, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 20, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 21, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='H'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 22, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 23, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R3'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday'), 24, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Discovery'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text)));

INSERT INTO clock_positions (clock_id, sort_order, position_type, category_id, target_offset_seconds, constraints)
VALUES
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 1, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='TOH IDs'), 0, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 2, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A1'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 3, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='B'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 4, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 5, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='C'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 6, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 7, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='New-Music Sweepers'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 8, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R1'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 9, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 10, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Relaunch Sweepers'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 11, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 12, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 13, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 14, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R3'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 15, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A1'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 16, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Station Promos'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 17, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='B'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 18, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 19, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 20, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G1990'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 21, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 22, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 23, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R3'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM'), 24, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Discovery'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text)));

INSERT INTO clock_positions (clock_id, sort_order, position_type, category_id, target_offset_seconds, constraints)
VALUES
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 1, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='TOH IDs'), 0, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 2, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A1'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 3, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='B'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 4, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 5, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R1'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 6, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 7, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 8, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 9, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 10, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 11, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R3'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 12, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G1990'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 13, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 14, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Discovery'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 15, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 16, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Station Promos'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 17, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 18, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 19, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 20, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 21, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G1990'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 22, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 23, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R3'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'), 24, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='H'), NULL, NULL);

INSERT INTO clock_positions (clock_id, sort_order, position_type, category_id, target_offset_seconds, constraints)
VALUES
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 1, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='TOH IDs'), 0, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 2, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='A1'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 3, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 4, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 5, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 6, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R2'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 7, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 8, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G1990'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 9, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='H'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 10, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 11, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 12, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 13, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R3'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 14, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 15, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 16, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='R3'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000')::text))),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 17, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Backsells'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 18, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G1990'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 19, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='H'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 20, 'sweeper', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Liners'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 21, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2000'), NULL, NULL),
  ((SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight'), 22, 'category', (SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Discovery'), NULL, (SELECT jsonb_build_object('fallbackCategoryId',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='G2010')::text)));

-- Format grid (week_in_cycle 0; 168 cells)
INSERT INTO format_grid (station_id, day_of_week, hour, week_in_cycle, clock_id) VALUES
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 0, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 1, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 2, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 3, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 4, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 5, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 6, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 7, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 8, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 9, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 10, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 11, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 12, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 13, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 14, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 15, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 16, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 17, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 18, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 19, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 20, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 21, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 22, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 0, 23, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 0, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 1, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 2, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 3, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 4, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 5, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 6, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 7, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 8, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 9, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 10, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 11, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 12, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 13, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 14, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 15, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 16, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 17, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 18, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 19, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 20, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 21, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 22, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 1, 23, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 0, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 1, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 2, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 3, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 4, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 5, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 6, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 7, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 8, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 9, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 10, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 11, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 12, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 13, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 14, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 15, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 16, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 17, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 18, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 19, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 20, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 21, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 22, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 2, 23, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 0, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 1, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 2, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 3, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 4, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 5, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 6, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 7, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 8, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 9, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 10, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 11, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 12, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 13, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 14, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 15, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 16, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 17, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 18, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 19, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 20, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 21, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 22, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 3, 23, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 0, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 1, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 2, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 3, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 4, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 5, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 6, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 7, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 8, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 9, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 10, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 11, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 12, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 13, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 14, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 15, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 16, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 17, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 18, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 19, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 20, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 21, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 22, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 4, 23, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 0, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 1, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 2, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 3, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 4, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 5, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 6, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 7, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 8, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 9, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='AM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 10, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 11, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 12, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Gold Lunch')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 13, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 14, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 15, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 16, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 17, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 18, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='PM Drive')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 19, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 20, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 21, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 22, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 5, 23, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 0, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 1, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 2, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 3, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 4, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 5, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Overnight')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 6, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 7, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 8, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 9, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND AM')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 10, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 11, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 12, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 13, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 14, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Midday')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 15, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 16, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 17, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 18, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND PM')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 19, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 20, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 21, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 22, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening')),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3', 6, 23, 0, (SELECT id FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='WKND Evening'));

-- Rules (carried from m2)
INSERT INTO rules (station_id, scope, scope_ref, rule_type, params, hardness, weight) VALUES
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3','global',NULL,'artist_separation','{"minMinutes":45}','hard',NULL),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3','global',NULL,'title_separation','{"minMinutes":150}','hard',NULL),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3','category',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Currents'),'artist_separation','{"minMinutes":30}','hard',NULL),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3','global',NULL,'tempo_clash','{"maxJump":2}','soft',0.2),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3','global',NULL,'era_spread','{}','soft',0.15),
  ('6a42a599-acfc-404f-a524-9fb9b65d36f3','category',(SELECT id FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3' AND name='Recurrents'),'max_per_hour','{"count":6}','hard',NULL);

COMMIT;

-- Verify: 12 clocks, 168 grid cells, ~275 positions
SELECT 'clocks' w, count(*) FROM clocks WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3'
UNION ALL SELECT 'positions', count(*) FROM clock_positions cp JOIN clocks c ON c.id=cp.clock_id WHERE c.station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3'
UNION ALL SELECT 'grid', count(*) FROM format_grid WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3'
UNION ALL SELECT 'categories', count(*) FROM categories WHERE station_id='6a42a599-acfc-404f-a524-9fb9b65d36f3';
