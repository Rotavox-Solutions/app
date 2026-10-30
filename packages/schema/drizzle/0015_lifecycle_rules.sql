CREATE TABLE "lifecycle_suggestion_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"song_id" uuid NOT NULL,
	"rule" text NOT NULL,
	"until" timestamp NOT NULL,
	"dismissed_by" uuid,
	"dismissed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_suggestion_dismissals_song_rule" UNIQUE("song_id","rule")
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "rest_exit_category_id" uuid;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "promote_after_days" integer;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "promote_to_category_id" uuid;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "bench_after_unaired_days" integer;--> statement-breakpoint
ALTER TABLE "lifecycle_suggestion_dismissals" ADD CONSTRAINT "lifecycle_suggestion_dismissals_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_suggestion_dismissals" ADD CONSTRAINT "lifecycle_suggestion_dismissals_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_suggestion_dismissals" ADD CONSTRAINT "lifecycle_suggestion_dismissals_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;