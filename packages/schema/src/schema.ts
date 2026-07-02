import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  real,
  unique,
} from "drizzle-orm/pg-core";

// station_id on every table, from day one (invariant #3) — even though this is a
// single-station build for now.

export const stations = pgTable("stations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  rdjConnectionRef: text("rdj_connection_ref"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Mirror + Scheduler-owned extended metadata (spec §5). Core fields are written by
// the Runner's library sync; extended fields are Scheduler/UI-owned and must never
// be touched by sync — see apps/runner/src/sync-library.ts's explicit set-allowlist.
export const songs = pgTable(
  "songs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stationId: uuid("station_id").notNull().references(() => stations.id),
    rdjSongId: integer("rdj_song_id").notNull(),

    // Core mirror fields (Runner-owned, synced from RadioDJ).
    artist: text("artist"),
    title: text("title"),
    album: text("album"),
    durationMs: integer("duration_ms"),
    path: text("path"),
    // RadioDJ has no category_id directly on songs (M0 found it's one hop via
    // subcategory.parentid) — both are denormalized here at sync time.
    rdjSubcategoryId: integer("rdj_subcategory_id"),
    rdjCategoryId: integer("rdj_category_id"),
    rdjGenreId: integer("rdj_genre_id"),
    enabled: boolean("enabled"),
    songType: integer("song_type"), // 0 music / 1 jingle / 2 sweeper / 3 voiceover

    // Extended fields (Scheduler/UI-owned; sync never writes these after insert).
    era: text("era"),
    tempo: integer("tempo"),
    energy: integer("energy"),
    mood: text("mood"),
    soundCodes: text("sound_codes").array(),
    hookMs: integer("hook_ms"),
    introMs: integer("intro_ms"),
    outroMs: integer("outro_ms"),
    lastScheduledAt: timestamp("last_scheduled_at"),
    timesScheduled: integer("times_scheduled").default(0),
    targetTurnoverHours: integer("target_turnover_hours"),
  },
  (t) => [unique("songs_station_rdj_song_unique").on(t.stationId, t.rdjSongId)]
);

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  stationId: uuid("station_id").notNull().references(() => stations.id),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // 'music' | 'imaging' | 'voicetrack'
  parentId: uuid("parent_id"),
  defaultTargetTurnoverHours: integer("default_target_turnover_hours"),
  defaultRuleOverrides: jsonb("default_rule_overrides"),
});

export const songCategories = pgTable(
  "song_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    songId: uuid("song_id").notNull().references(() => songs.id),
    categoryId: uuid("category_id").notNull().references(() => categories.id),
  },
  (t) => [unique("song_categories_song_category_unique").on(t.songId, t.categoryId)]
);

export const clocks = pgTable("clocks", {
  id: uuid("id").defaultRandom().primaryKey(),
  stationId: uuid("station_id").notNull().references(() => stations.id),
  name: text("name").notNull(),
  lengthMinutes: integer("length_minutes").default(60),
  notes: text("notes"),
});

export const clockPositions = pgTable("clock_positions", {
  id: uuid("id").defaultRandom().primaryKey(),
  clockId: uuid("clock_id").notNull().references(() => clocks.id),
  sortOrder: integer("sort_order").notNull(),
  positionType: text("position_type").notNull(), // 'category' | 'fixed_event' | 'sweeper' | 'voicetrack'
  categoryId: uuid("category_id").references(() => categories.id),
  targetOffsetSeconds: integer("target_offset_seconds"),
  constraints: jsonb("constraints"),
  fixedRef: text("fixed_ref"),
});

export const formatGrid = pgTable("format_grid", {
  id: uuid("id").defaultRandom().primaryKey(),
  stationId: uuid("station_id").notNull().references(() => stations.id),
  dayOfWeek: integer("day_of_week").notNull(),
  hour: integer("hour").notNull(),
  clockId: uuid("clock_id").notNull().references(() => clocks.id),
});

export const rules = pgTable("rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  stationId: uuid("station_id").notNull().references(() => stations.id),
  scope: text("scope").notNull(), // 'global' | 'category' | 'position'
  scopeRef: uuid("scope_ref"),
  ruleType: text("rule_type").notNull(),
  params: jsonb("params"),
  hardness: text("hardness").notNull(), // 'hard' | 'soft'
  weight: real("weight"),
});

export const dayparts = pgTable("dayparts", {
  id: uuid("id").defaultRandom().primaryKey(),
  stationId: uuid("station_id").notNull().references(() => stations.id),
  name: text("name").notNull(),
  ranges: jsonb("ranges"), // day/hour ranges; shape owned by the engine (M2)
});

export const logs = pgTable("logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  stationId: uuid("station_id").notNull().references(() => stations.id),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at").notNull(),
  status: text("status").notNull(), // 'draft' | 'approved' | 'airing' | 'aired'
  generatedAt: timestamp("generated_at"),
  generatorVersion: text("generator_version"),
  seed: text("seed"),
});

export const logItems = pgTable("log_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  logId: uuid("log_id").notNull().references(() => logs.id),
  sortOrder: integer("sort_order").notNull(),
  projectedAirAt: timestamp("projected_air_at"),
  elementType: text("element_type").notNull(), // 'music' | 'sweeper' | 'voicetrack' | 'fixed_event'
  songId: uuid("song_id").references(() => songs.id),
  rdjSongId: integer("rdj_song_id"),
  clockPositionId: uuid("clock_position_id").references(() => clockPositions.id),
  violations: jsonb("violations"),
  pushedAt: timestamp("pushed_at"),
  airedAt: timestamp("aired_at"),
});

// Authoritative separation state (spec §5) — fed by the Runner's reconciliation.
export const playHistory = pgTable(
  "play_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stationId: uuid("station_id").notNull().references(() => stations.id),
    songId: uuid("song_id").references(() => songs.id),
    rdjSongId: integer("rdj_song_id").notNull(),
    artist: text("artist"),
    airedAt: timestamp("aired_at").notNull(),
    source: text("source").notNull(), // 'reconciled' | 'assumed'
    // Not in spec's literal table list — the source RadioDJ history.ID, so
    // reconciliation can ON CONFLICT DO NOTHING and safely re-process a batch
    // after a crash between the Postgres insert and the watermark bump.
    rdjHistoryId: integer("rdj_history_id"),
  },
  (t) => [unique("play_history_station_rdj_history_unique").on(t.stationId, t.rdjHistoryId)]
);

// Not in spec's literal table list — persists sync/reconcile watermarks (§7 refers
// to "since last watermark" / "by id / modified marker" but never names where that
// state lives). One row per (station, job); each job parses its own watermark type.
export const syncState = pgTable(
  "sync_state",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stationId: uuid("station_id").notNull().references(() => stations.id),
    syncKey: text("sync_key").notNull(),
    watermark: text("watermark"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [unique("sync_state_station_key_unique").on(t.stationId, t.syncKey)]
);
