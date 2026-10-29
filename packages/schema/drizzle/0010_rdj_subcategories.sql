CREATE TABLE "rdj_subcategories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"rdj_subcategory_id" integer NOT NULL,
	"name" text NOT NULL,
	"parent_name" text,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rdj_subcategories_station_rdj_unique" UNIQUE("station_id","rdj_subcategory_id")
);
--> statement-breakpoint
ALTER TABLE "rdj_subcategories" ADD CONSTRAINT "rdj_subcategories_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;