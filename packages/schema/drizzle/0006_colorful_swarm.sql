CREATE TABLE "changeset_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"changeset_id" uuid NOT NULL,
	"song_id" uuid NOT NULL,
	"from_state" text NOT NULL,
	"from_category_id" uuid,
	"to_state" text NOT NULL,
	"to_category_id" uuid,
	"reason" text,
	"from_rdj_subcat" integer,
	"to_rdj_subcat" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "changeset_items_one_per_song" UNIQUE("changeset_id","song_id")
);
--> statement-breakpoint
CREATE TABLE "changesets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"intent" text,
	"reverts_changeset_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"applied_at" timestamp,
	"projection" text,
	"projected_at" timestamp,
	"projection_error" text
);
--> statement-breakpoint
ALTER TABLE "changeset_items" ADD CONSTRAINT "changeset_items_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changeset_items" ADD CONSTRAINT "changeset_items_changeset_id_changesets_id_fk" FOREIGN KEY ("changeset_id") REFERENCES "public"."changesets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changeset_items" ADD CONSTRAINT "changeset_items_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changeset_items" ADD CONSTRAINT "changeset_items_from_category_id_categories_id_fk" FOREIGN KEY ("from_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changeset_items" ADD CONSTRAINT "changeset_items_to_category_id_categories_id_fk" FOREIGN KEY ("to_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changesets" ADD CONSTRAINT "changesets_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changesets" ADD CONSTRAINT "changesets_reverts_changeset_id_changesets_id_fk" FOREIGN KEY ("reverts_changeset_id") REFERENCES "public"."changesets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "changesets_one_draft" ON "changesets" USING btree ("station_id") WHERE status = 'draft';--> statement-breakpoint
CREATE INDEX "changesets_station_applied_idx" ON "changesets" USING btree ("station_id","applied_at");