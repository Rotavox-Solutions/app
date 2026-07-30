ALTER TABLE "format_grid" ADD COLUMN "week_in_cycle" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "format_cycle_weeks" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "format_cycle_epoch" timestamp;--> statement-breakpoint
ALTER TABLE "format_grid" ADD CONSTRAINT "format_grid_cell_unique" UNIQUE("station_id","week_in_cycle","day_of_week","hour");