CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"parent_id" uuid,
	"default_target_turnover_hours" integer,
	"default_rule_overrides" jsonb
);
--> statement-breakpoint
CREATE TABLE "clock_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clock_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"position_type" text NOT NULL,
	"category_id" uuid,
	"target_offset_seconds" integer,
	"constraints" jsonb,
	"fixed_ref" text
);
--> statement-breakpoint
CREATE TABLE "clocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"name" text NOT NULL,
	"length_minutes" integer DEFAULT 60,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "dayparts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"name" text NOT NULL,
	"ranges" jsonb
);
--> statement-breakpoint
CREATE TABLE "format_grid" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"hour" integer NOT NULL,
	"clock_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "log_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"log_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"projected_air_at" timestamp,
	"element_type" text NOT NULL,
	"song_id" uuid,
	"rdj_song_id" integer,
	"clock_position_id" uuid,
	"violations" jsonb,
	"pushed_at" timestamp,
	"aired_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"generated_at" timestamp,
	"generator_version" text,
	"seed" text
);
--> statement-breakpoint
CREATE TABLE "play_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"song_id" uuid,
	"rdj_song_id" integer NOT NULL,
	"artist" text,
	"aired_at" timestamp NOT NULL,
	"source" text NOT NULL,
	"rdj_history_id" integer,
	CONSTRAINT "play_history_station_rdj_history_unique" UNIQUE("station_id","rdj_history_id")
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"scope_ref" uuid,
	"rule_type" text NOT NULL,
	"params" jsonb,
	"hardness" text NOT NULL,
	"weight" real
);
--> statement-breakpoint
CREATE TABLE "song_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"song_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "song_categories_song_category_unique" UNIQUE("song_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "songs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"rdj_song_id" integer NOT NULL,
	"artist" text,
	"title" text,
	"album" text,
	"duration_ms" integer,
	"path" text,
	"rdj_subcategory_id" integer,
	"rdj_category_id" integer,
	"rdj_genre_id" integer,
	"enabled" boolean,
	"song_type" integer,
	"era" text,
	"tempo" integer,
	"energy" integer,
	"mood" text,
	"sound_codes" text[],
	"hook_ms" integer,
	"intro_ms" integer,
	"outro_ms" integer,
	"last_scheduled_at" timestamp,
	"times_scheduled" integer DEFAULT 0,
	"target_turnover_hours" integer,
	CONSTRAINT "songs_station_rdj_song_unique" UNIQUE("station_id","rdj_song_id")
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"rdj_connection_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"sync_key" text NOT NULL,
	"watermark" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sync_state_station_key_unique" UNIQUE("station_id","sync_key")
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clock_positions" ADD CONSTRAINT "clock_positions_clock_id_clocks_id_fk" FOREIGN KEY ("clock_id") REFERENCES "public"."clocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clock_positions" ADD CONSTRAINT "clock_positions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clocks" ADD CONSTRAINT "clocks_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dayparts" ADD CONSTRAINT "dayparts_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "format_grid" ADD CONSTRAINT "format_grid_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "format_grid" ADD CONSTRAINT "format_grid_clock_id_clocks_id_fk" FOREIGN KEY ("clock_id") REFERENCES "public"."clocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_items" ADD CONSTRAINT "log_items_log_id_logs_id_fk" FOREIGN KEY ("log_id") REFERENCES "public"."logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_items" ADD CONSTRAINT "log_items_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_items" ADD CONSTRAINT "log_items_clock_position_id_clock_positions_id_fk" FOREIGN KEY ("clock_position_id") REFERENCES "public"."clock_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_history" ADD CONSTRAINT "play_history_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_history" ADD CONSTRAINT "play_history_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "song_categories" ADD CONSTRAINT "song_categories_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "song_categories" ADD CONSTRAINT "song_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;