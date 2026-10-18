BEGIN;
DELETE FROM song_categories WHERE category_id IN (SELECT id FROM categories WHERE station_id = '6a42a599-acfc-404f-a524-9fb9b65d36f3');
INSERT INTO song_categories (song_id, category_id)
SELECT s.id, c.id FROM songs s JOIN categories c ON c.station_id = s.station_id
WHERE s.station_id = '6a42a599-acfc-404f-a524-9fb9b65d36f3' AND (
  (c.name = 'A1' AND s.rdj_subcategory_id = 5) OR
  (c.name = 'A2' AND s.rdj_subcategory_id = 3) OR
  (c.name = 'B' AND s.rdj_subcategory_id = 6) OR
  (c.name = 'C' AND s.rdj_subcategory_id = 23) OR
  (c.name = 'N' AND s.rdj_subcategory_id = 24) OR
  (c.name = 'R1' AND s.rdj_subcategory_id = 26) OR
  (c.name = 'R2' AND s.rdj_subcategory_id = 27) OR
  (c.name = 'R3' AND s.rdj_subcategory_id = 28) OR
  (c.name = 'G2010' AND s.rdj_subcategory_id = 29) OR
  (c.name = 'G2000' AND s.rdj_subcategory_id = 4) OR
  (c.name = 'G1990' AND s.rdj_subcategory_id = 1) OR
  (c.name = 'H1' AND s.rdj_subcategory_id = 2) OR
  (c.name = 'H2' AND s.rdj_subcategory_id = 36) OR
  (c.name = 'Discovery' AND s.rdj_subcategory_id = 30) OR
  (c.name = 'F' AND s.rdj_subcategory_id = 25) OR
  (c.name = 'TOH IDs' AND s.rdj_subcategory_id = 42) OR
  (c.name = 'Liners' AND s.rdj_subcategory_id = 37) OR
  (c.name = 'New-Music Sweepers' AND s.rdj_subcategory_id = 38) OR
  (c.name = 'Gold Backsells' AND s.rdj_subcategory_id = 41) OR
  (c.name = 'Relaunch Sweepers' AND s.rdj_subcategory_id = 40) OR
  (c.name = 'Station Promos' AND s.rdj_subcategory_id = 43)
)
ON CONFLICT ON CONSTRAINT song_categories_song_category_unique DO NOTHING;
SELECT c.name, count(*) FROM song_categories sc JOIN categories c ON c.id=sc.category_id JOIN songs s ON s.id=sc.song_id WHERE s.enabled AND c.name IN ('A1','A2','B','C','N','R1','R2','R3','Discovery','F') GROUP BY 1 ORDER BY 1;
COMMIT;
