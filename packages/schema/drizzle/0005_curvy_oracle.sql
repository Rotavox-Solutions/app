CREATE TABLE "lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"song_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"from_category_id" uuid,
	"to_category_id" uuid,
	"source" text NOT NULL,
	"source_ref" text,
	"reason" text NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "rest_review_days" integer;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "rdj_subcategory_ids" integer[];--> statement-breakpoint
ALTER TABLE "song_categories" ADD COLUMN "role" text DEFAULT 'primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "lifecycle_state" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "lifecycle_since" timestamp;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "membership_imported_at" timestamp;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "rdj_lifecycle_subcats" jsonb;--> statement-breakpoint
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_from_category_id_categories_id_fk" FOREIGN KEY ("from_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_to_category_id_categories_id_fk" FOREIGN KEY ("to_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lifecycle_events_song_idx" ON "lifecycle_events" USING btree ("song_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "song_categories_one_primary" ON "song_categories" USING btree ("song_id") WHERE role = 'primary';--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_station_name_unique" UNIQUE("station_id","name");