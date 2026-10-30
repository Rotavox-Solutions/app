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
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// station_id on every table, from day one (invariant #3). The one exception is `users`:
// a person can work for several stations (ADR-0003).

export const stations = pgTable("stations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  rdjConnectionRef: text("rdj_connection_ref"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Format rotation (§ clock scheduling): the format_grid repeats over this many
  // weeks; 1 = a plain static weekly grid. `formatCycleEpoch` anchors week 0 of the
  // cycle (its local calendar date only — time-of-day is ignored). Null epoch (or
  // cycleWeeks=1) means no rotation and the engine only ever reads week_in_cycle=0.
  formatCycleWeeks: integer("format_cycle_weeks").default(1).notNull(),
  formatCycleEpoch: timestamp("format_cycle_epoch"),
  /** Bumped on every save of the week grid from the editor: a save made against an older one is refused. */
  gridUpdatedAt: timestamp("grid_updated_at").defaultNow().notNull(),
  /**
   * Adapter tier 0/1: no as-played feed exists, because the station ingests an exported
   * log itself rather than letting Rotavox drive playout (ADR-0001 §3.5c). With no
   * reconciliation the engine would have no separation memory at all, so approving a
   * log records its items as `assumed` play history. Optimistic but far better than
   * nothing — an approved log almost always airs.
   *
   * False wherever a real as-played feed exists; assumed rows would otherwise
   * double-count against reconciled ones.
   */
  assumeLogAired: boolean("assume_log_aired").default(false).notNull(),
  /**
   * When the one-time membership import ran (ADR-0002 §4). Null = membership is still a
   * derived snapshot of RadioDJ subcategories; set = Rotavox owns membership and
   * lifecycle for this station, and nothing may re-derive them from RadioDJ.
   */
  membershipImportedAt: timestamp("membership_imported_at"),
  /**
   * RadioDJ subcategories that encode a lifecycle STATE rather than a pool, keyed by
   * subcategory ID: `{"33": {"state": "resting", "origin": "N"}, "35": {"state": "benched"}}`.
   * `origin` names the category a resting song belongs to. Adapter config, read by the
   * import and by the Runner when it mirrors applied changesets.
   */
  rdjLifecycleSubcats: jsonb("rdj_lifecycle_subcats"),
});

// ── Accounts (ADR-0003) ─────────────────────────────────────────────────────────────
// A person is one account across every station they work for, so `users` is the one
// table without a station_id; what they may do at a station lives in station_members,
// which has one.
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Stored lowercased; the sign-in name. */
    email: text("email").notNull(),
    name: text("name").notNull(),
    /** scrypt, self-describing: `scrypt$N$r$p$salt$hash` (see the web app's lib/auth/password.ts). */
    passwordHash: text("password_hash").notNull(),
    /** Rotavox staff: every station, every station-admin power, and the staff-only tools. */
    isStaff: boolean("is_staff").default(false).notNull(),
    failedLogins: integer("failed_logins").default(0).notNull(),
    lockedUntil: timestamp("locked_until"),
    disabledAt: timestamp("disabled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastLoginAt: timestamp("last_login_at"),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)]
);

export const stationMembers = pgTable(
  "station_members",
  {
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 'admin' | 'programmer' | 'viewer'
    role: text("role").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique("station_members_pk").on(t.stationId, t.userId), index("station_members_user_idx").on(t.userId)]
);

// A signed-in browser. The cookie holds a random token; only its SHA-256 is stored, so
// a leaked table can't be replayed as a session.
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The station this browser is working on. Null for staff before they pick one. */
    stationId: uuid("station_id").references(() => stations.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => [uniqueIndex("sessions_token_unique").on(t.tokenHash), index("sessions_user_idx").on(t.userId)]
);

// One-time links: an invitation to a station (or, from the engineer bootstrap, to
// Rotavox staff), or a password reset. Hashed like session tokens.
export const accountTokens = pgTable(
  "account_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // 'invite' | 'reset'
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    email: text("email").notNull(),
    /** The station an invite is for. Null for a staff invite or a reset. */
    stationId: uuid("station_id").references(() => stations.id, { onDelete: "cascade" }),
    role: text("role"),
    isStaff: boolean("is_staff").default(false).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [uniqueIndex("account_tokens_token_unique").on(t.tokenHash), index("account_tokens_station_idx").on(t.stationId)]
);

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
    // Effective segue length from RadioDJ's cue points: the next track starts at `xta`,
    // not at end-of-file, so this is what the scheduler must use for timing. Averages
    // 1.5s shorter than durationMs across the library and up to 23s on individual
    // tracks — roughly 24 seconds of drift per hour if file duration is used instead.
    // Mutable: the PD edits cue points, so this is re-read on EVERY sync, not once.
    effectiveDurationMs: integer("effective_duration_ms"),
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

    // Lifecycle (ADR-0002 §3) — Scheduler-owned; sync never writes these.
    // 'active' | 'resting' | 'benched' | 'retired'. Only 'active' is schedulable.
    lifecycleState: text("lifecycle_state").default("active").notNull(),
    lifecycleSince: timestamp("lifecycle_since"),
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
  /** Standard rest for songs resting from this pool; past it they are surfaced for a decision. */
  restReviewDays: integer("rest_review_days"),
  /**
   * Place on the currents ladder, 1 = hottest. A song that came here from a hotter pool is
   * falling; from a cooler one, rising. Null = not on the ladder (ADR-0002 §3: direction
   * is derived, never stored on the song).
   */
  ladderRank: integer("ladder_rank"),
  /** A song active here longer than this is falling, however it arrived. Null = never by time. */
  fallingAfterDays: integer("falling_after_days"),
  /**
   * Projection map to the playout library (ADR-0002 §3): the RadioDJ subcategories this
   * category corresponds to. Null or empty = not projected. Replaces the SUBCAT table
   * that lived only in tools/m4-seed.mjs.
   */
  rdjSubcategoryIds: integer("rdj_subcategory_ids").array(),
}, (t) => [
  // Names are how seeds, imports and PDs address a category; two of one name would make
  // every by-name lookup pick arbitrarily.
  unique("categories_station_name_unique").on(t.stationId, t.name),
]);

// RadioDJ's subcategories as the Runner last saw them (library sync): names only, so a
// PD can map a new category to one by name. RadioDJ owns these; Rotavox never writes them.
export const rdjSubcategories = pgTable(
  "rdj_subcategories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    rdjSubcategoryId: integer("rdj_subcategory_id").notNull(),
    name: text("name").notNull(),
    /** Its RadioDJ category: "Sweepers", "Station IDs". */
    parentName: text("parent_name"),
    syncedAt: timestamp("synced_at").defaultNow().notNull(),
  },
  (t) => [unique("rdj_subcategories_station_rdj_unique").on(t.stationId, t.rdjSubcategoryId)]
);

export const songCategories = pgTable(
  "song_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    songId: uuid("song_id").notNull().references(() => songs.id),
    categoryId: uuid("category_id").notNull().references(() => categories.id),
    // 'primary' — the song's one pool, which depth counts; 'also' — explicit extra
    // eligibility for the rare overlap (ADR-0002 §6.4).
    role: text("role").default("primary").notNull(),
  },
  (t) => [
    unique("song_categories_song_category_unique").on(t.songId, t.categoryId),
    uniqueIndex("song_categories_one_primary").on(t.songId).where(sql`role = 'primary'`),
  ]
);

// Every lifecycle transition and pool move, with its provenance (ADR-0002 §3). What
// makes "why is this in R2" answerable, and what standing lifecycle rules will read.
export const lifecycleEvents = pgTable(
  "lifecycle_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stationId: uuid("station_id").notNull().references(() => stations.id),
    songId: uuid("song_id").notNull().references(() => songs.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    fromCategoryId: uuid("from_category_id").references(() => categories.id),
    toCategoryId: uuid("to_category_id").references(() => categories.id),
    // 'import' | 'changeset' | 'ui' — and, for a changeset, its id in source_ref.
    source: text("source").notNull(),
    sourceRef: text("source_ref"),
    reason: text("reason").notNull(),
    at: timestamp("at").defaultNow().notNull(),
  },
  (t) => [index("lifecycle_events_song_idx").on(t.songId, t.at)]
);

// A UI-authored changeset (ADR-0002 §2.3): the reviewable, reversible unit every pool and
// lifecycle edit goes through. At most one draft per station: edits from any screen stage
// into it, and it is reviewed and applied as a whole. Applying writes Rotavox at once;
// `projection` then tracks getting the same change into the playout library.
export const changesets = pgTable(
  "changesets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stationId: uuid("station_id").notNull().references(() => stations.id),
    // 'draft' | 'applied' | 'discarded'
    status: text("status").default("draft").notNull(),
    /** Why this exists — required to apply, and the reason for any item without its own. */
    intent: text("intent"),
    /** Set on an undo: the applied changeset this one reverses. */
    revertsChangesetId: uuid("reverts_changeset_id").references((): AnyPgColumn => changesets.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    appliedAt: timestamp("applied_at"),
    /**
     * Null when the station has nothing to project to (tier 0/1). Otherwise 'pending'
     * until the Runner writes it to RadioDJ, then 'projected' or 'failed'.
     */
    projection: text("projection"),
    projectedAt: timestamp("projected_at"),
    projectionError: text("projection_error"),
    /** Who applied it. Null for one applied outside the UI. */
    appliedBy: uuid("applied_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("changesets_one_draft").on(t.stationId).where(sql`status = 'draft'`),
    index("changesets_station_applied_idx").on(t.stationId, t.appliedAt),
  ]
);

// One song's placement change. `from_*` is the precondition captured when the item was
// staged; applying re-checks it, so a song changed by someone else in between is
// reported rather than silently overwritten (CHANGESET-CONTRACT §5).
export const changesetItems = pgTable(
  "changeset_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stationId: uuid("station_id").notNull().references(() => stations.id),
    changesetId: uuid("changeset_id")
      .notNull()
      .references(() => changesets.id, { onDelete: "cascade" }),
    songId: uuid("song_id").notNull().references(() => songs.id),
    fromState: text("from_state").notNull(),
    fromCategoryId: uuid("from_category_id").references(() => categories.id),
    toState: text("to_state").notNull(),
    toCategoryId: uuid("to_category_id").references(() => categories.id),
    reason: text("reason"),
    /** The song's RadioDJ subcategory per the mirror when it was staged. */
    fromRdjSubcat: integer("from_rdj_subcat"),
    /**
     * Set on an undo: the exact RadioDJ subcategory to restore, the original's
     * `from_rdj_subcat`. Otherwise derived from the placement at projection time — and some
     * placements (active with no pool) have no subcategory of their own to derive.
     */
    toRdjSubcat: integer("to_rdj_subcat"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique("changeset_items_one_per_song").on(t.changesetId, t.songId)]
);

// Work the UI asks the Runner to do (ADR-0001 invariant #4: the web app never contacts
// RadioDJ, so a button that needs RadioDJ queues a job here). The Runner service polls,
// claims and records each one; the UI shows its state and output.
export const runnerJobs = pgTable(
  "runner_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stationId: uuid("station_id").notNull().references(() => stations.id),
    // 'sync_library' | 'project_changesets' | 'project_autodj_events' | 'update_runner'
    kind: text("kind").notNull(),
    // 'queued' | 'running' | 'succeeded' | 'failed'
    status: text("status").default("queued").notNull(),
    // 'ui' | 'schedule' | 'changeset' — why it was queued, for the activity list
    requestedBy: text("requested_by").notNull(),
    /** The person, when requestedBy is 'ui'. */
    requestedByUser: uuid("requested_by_user").references(() => users.id, { onDelete: "set null" }),
    requestedAt: timestamp("requested_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    /** One line for the UI: "12 songs updated", or the error. */
    summary: text("summary"),
    /** The job's full output, for when the summary isn't enough. */
    output: text("output"),
  },
  (t) => [
    // Asking twice while one is waiting or running is the same request.
    uniqueIndex("runner_jobs_one_open").on(t.stationId, t.kind).where(sql`status IN ('queued', 'running')`),
    index("runner_jobs_station_requested_idx").on(t.stationId, t.requestedAt),
  ]
);

// How a station's Runner proves who it is to the API (ADR-0004). One key per install;
// only the SHA-256 is stored. The key names the station, so nothing the Runner sends
// can reach another station's data.
export const runnerKeys = pgTable(
  "runner_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /** What the person who made it called it: "BOLT broadcast box". */
    label: text("label").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at"),
    /** The Runner version that last used it, from its X-Rotavox-Runner header. */
    lastVersion: text("last_version"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [uniqueIndex("runner_keys_token_unique").on(t.tokenHash), index("runner_keys_station_idx").on(t.stationId)]
);

export const clocks = pgTable("clocks", {
  id: uuid("id").defaultRandom().primaryKey(),
  stationId: uuid("station_id").notNull().references(() => stations.id),
  name: text("name").notNull(),
  lengthMinutes: integer("length_minutes").default(60),
  notes: text("notes"),
  /** Bumped on every save from the editor: a save made against an older one is refused. */
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// A snapshot of a clock as saved from the editor, for history and restore. The first
// save also records the clock as it stood before, so the seeded original is never lost.
export const clockRevisions = pgTable(
  "clock_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stationId: uuid("station_id").notNull().references(() => stations.id),
    clockId: uuid("clock_id")
      .notNull()
      .references(() => clocks.id, { onDelete: "cascade" }),
    /** The clock in ClockDraft's shape (packages/schema/src/clocks.ts). */
    snapshot: jsonb("snapshot").notNull(),
    note: text("note"),
    savedBy: uuid("saved_by").references(() => users.id, { onDelete: "set null" }),
    savedAt: timestamp("saved_at").defaultNow().notNull(),
  },
  (t) => [index("clock_revisions_clock_idx").on(t.clockId, t.savedAt)]
);

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

export const formatGrid = pgTable(
  "format_grid",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stationId: uuid("station_id").notNull().references(() => stations.id),
    dayOfWeek: integer("day_of_week").notNull(),
    hour: integer("hour").notNull(),
    // Which week of the station's rotation cycle this cell applies to (0-based).
    // A non-rotating grid leaves every row at 0. See stations.formatCycleWeeks.
    weekInCycle: integer("week_in_cycle").default(0).notNull(),
    clockId: uuid("clock_id").notNull().references(() => clocks.id),
  },
  (t) => [unique("format_grid_cell_unique").on(t.stationId, t.weekInCycle, t.dayOfWeek, t.hour)]
);

// A snapshot of the week grid as saved from the editor, for history and restore. The first
// save also records the grid as it stood before.
export const gridRevisions = pgTable(
  "grid_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    /** { cycleWeeks, cells: [{ weekInCycle, dayOfWeek, hour, clockId }] } (packages/schema/src/grid.ts). */
    snapshot: jsonb("snapshot").notNull(),
    note: text("note"),
    savedBy: uuid("saved_by").references(() => users.id, { onDelete: "set null" }),
    savedAt: timestamp("saved_at").defaultNow().notNull(),
  },
  (t) => [index("grid_revisions_station_idx").on(t.stationId, t.savedAt)]
);

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
  locked: boolean("locked").default(false).notNull(),
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
