import { eq } from "drizzle-orm";
import { weekInCycle } from "@rotavox/engine";
import { getGridForEdit, MAX_CYCLE_WEEKS, stations } from "@rotavox/schema";
import { db } from "@/lib/db";
import { allowed, requireStation } from "@/lib/auth";
import { RotationForm, StationNameForm } from "@/components/station/SettingsForms";

// Live view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <div className="pt-1 text-sm text-neutral-400">{label}</div>
      <div className="space-y-1">
        <div className="text-sm">{children}</div>
        {help && <p className="max-w-2xl text-xs text-neutral-500">{help}</p>}
      </div>
    </div>
  );
}

export default async function StationSettingsPage() {
  const ctx = await requireStation();
  const { stationId } = ctx;
  const [[station], grid] = await Promise.all([
    db.select().from(stations).where(eq(stations.id, stationId)),
    getGridForEdit(db, stationId),
  ]);
  if (!station || !grid) return null;
  const airing = grid.cycleEpoch ? weekInCycle(new Date(), grid.cycleEpoch, grid.cycleWeeks, station.timezone) : 0;
  const hoursByWeek = Array.from({ length: grid.cycleWeeks }, (_, w) => grid.cells.filter((c) => c.weekInCycle === w).length);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-neutral-500">The station itself, and how its week grid rotates.</p>
      </div>

      <Section title="Station">
        <Row label="Name">
          <StationNameForm name={station.name} readOnly={!allowed(ctx, "manage_station")} />
        </Row>
        <Row
          label="Time zone"
          help="Every grid hour, log and report is in this time zone. Changing it moves every hour of the format and the AutoDJ fail-safe, so Rotavox staff change it with you."
        >
          {station.timezone}
        </Row>
        <Row
          label="Play history"
          help={
            station.assumeLogAired
              ? "With no as-played feed from the playout system, approving a log records its songs as played, so separation has something to work from."
              : "Read from RadioDJ's history by the Runner, so separation works from what really aired."
          }
        >
          {station.assumeLogAired ? "Assumed from approved logs" : "From RadioDJ, through the Runner"}
        </Row>
      </Section>

      <Section title="Rotation">
        <p className="max-w-2xl text-sm text-neutral-500">
          A grid can repeat over several weeks, so each week of the cycle plays its own clocks, for example to
          alternate two versions of a show. Changing which week is airing changes which clocks air from now on; changing the length adds or
          removes weeks on the{" "}
          <a href="/format/grid" className="underline hover:text-neutral-300">
            Week grid
          </a>
          . Logs already generated keep their clocks.
        </p>
        <RotationForm
          cycleWeeks={grid.cycleWeeks}
          airingWeek={airing + 1}
          hoursByWeek={hoursByWeek}
          gridUpdatedAt={grid.updatedAt.toISOString()}
          maxWeeks={MAX_CYCLE_WEEKS}
          readOnly={!allowed(ctx, "edit_format")}
        />
      </Section>
    </div>
  );
}
