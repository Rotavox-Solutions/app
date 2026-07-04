import { sql } from "drizzle-orm";
import { db } from "../../src/lib/db";

export async function resetDb(): Promise<void> {
  await db.execute(sql`
    TRUNCATE
      log_items, logs, song_categories, songs, rules, dayparts,
      format_grid, clock_positions, clocks, categories, play_history,
      sync_state, stations
    CASCADE
  `);
}
