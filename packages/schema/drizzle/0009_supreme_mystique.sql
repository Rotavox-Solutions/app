CREATE TABLE "runner_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"last_version" text,
	"revoked_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "runner_keys" ADD CONSTRAINT "runner_keys_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_keys" ADD CONSTRAINT "runner_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runner_keys_token_unique" ON "runner_keys" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "runner_keys_station_idx" ON "runner_keys" USING btree ("station_id");