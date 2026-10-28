import { utcEventName, type UtcEvent } from "@rotavox/schema";

// What RadioDJ's events table should hold for the fail-safe plan (autodj-events.ts), as a
// pure function of the plan and the rows there now, so it can be tested without RadioDJ.

const OWNED_NAME = /^.+ \d{2}:00 UTC$/;

export interface EventRow {
  ID: number;
  name: string;
  time: string;
  day: string;
  data: string;
  enabled: number;
}

export interface EventWrite {
  /** The row to rewrite, or null to insert one. */
  id: number | null;
  name: string;
  time: string;
  day: string;
  data: string;
}

export interface EventPlan {
  writes: EventWrite[];
  /** Owned events the plan no longer needs and no new one could reuse. */
  disable: number[];
  unchanged: number;
}

/** What RadioDJ's events table should hold for this plan, against what it holds now. */
export function planEventWrites(utc: UtcEvent[], rotationIds: Map<string, number>, existing: EventRow[]): EventPlan {
  const owned = existing.filter((e) => e.data.startsWith("Load Rotation|") && OWNED_NAME.test(e.name));
  const byName = new Map(owned.map((e) => [e.name, e]));
  const wanted = utc.map((e) => {
    const id = rotationIds.get(e.rot);
    if (id === undefined) throw new Error(`RadioDJ has no rotation named "${e.rot}"`);
    return {
      name: utcEventName(e),
      time: `${String(e.hour).padStart(2, "0")}:00:00`,
      day: "&" + e.days.join("&"),
      data: `Load Rotation|${id}|${e.rot}`,
    };
  });
  const names = new Set(wanted.map((w) => w.name));
  if (names.size !== wanted.length) throw new Error("the plan names the same rotation twice in one hour");
  const spare = owned.filter((e) => !names.has(e.name)).map((e) => e.ID);

  const writes: EventWrite[] = [];
  let unchanged = 0;
  for (const w of wanted) {
    const row = byName.get(w.name);
    if (row && row.time === w.time && row.day === w.day && row.data === w.data && row.enabled === 1) {
      unchanged++;
      continue;
    }
    writes.push({ id: row?.ID ?? spare.shift() ?? null, ...w });
  }
  // A spare that's already disabled needs nothing more.
  const disable = spare.filter((id) => owned.find((e) => e.ID === id)?.enabled !== 0);
  return { writes, disable, unchanged };
}
