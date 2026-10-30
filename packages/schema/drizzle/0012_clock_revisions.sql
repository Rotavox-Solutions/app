CREATE TABLE "clock_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"clock_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"note" text,
	"saved_by" uuid,
	"saved_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clocks" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "clock_revisions" ADD CONSTRAINT "clock_revisions_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clock_revisions" ADD CONSTRAINT "clock_revisions_clock_id_clocks_id_fk" FOREIGN KEY ("clock_id") REFERENCES "public"."clocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clock_revisions" ADD CONSTRAINT "clock_revisions_saved_by_users_id_fk" FOREIGN KEY ("saved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clock_revisions_clock_idx" ON "clock_revisions" USING btree ("clock_id","saved_at");