CREATE TABLE "runner_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"summary" text,
	"output" text
);
--> statement-breakpoint
ALTER TABLE "runner_jobs" ADD CONSTRAINT "runner_jobs_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runner_jobs_one_open" ON "runner_jobs" USING btree ("station_id","kind") WHERE status IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX "runner_jobs_station_requested_idx" ON "runner_jobs" USING btree ("station_id","requested_at");