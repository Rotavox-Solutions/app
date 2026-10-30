import { getPositionLabels, getRulesForEdit, listRuleRevisions } from "@rotavox/schema";
import { db } from "@/lib/db";
import { getClockCategoryOptions } from "@/lib/format-edits";
import { allowed, requireStation } from "@/lib/auth";
import { RulesEditor } from "@/components/format/RulesEditor";

// Live view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const ctx = await requireStation();
  const { stationId } = ctx;
  const [rules, categories, revisions] = await Promise.all([
    getRulesForEdit(db, stationId),
    getClockCategoryOptions(stationId),
    listRuleRevisions(db, stationId),
  ]);
  if (!rules) return null;
  const positionIds = rules.rules.filter((r) => r.scope === "position" && r.scopeRef).map((r) => r.scopeRef!);
  const labels = await getPositionLabels(db, stationId, positionIds);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Rules</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          What the generator keeps apart and holds back when it picks songs. A rule for a category overrides the
          station-wide one for that category and the pools under it. When a slot can&apos;t be filled within the rules,
          the generator relaxes them one step at a time and marks the item in the log. Changing rules only changes logs
          generated afterwards.
        </p>
      </div>
      <RulesEditor
        initial={rules.rules}
        updatedAt={rules.updatedAt.toISOString()}
        categories={categories}
        positionLabels={Object.fromEntries(labels.map((l) => [l.id, l.label]))}
        revisions={revisions.map((r) => ({ ...r, savedAt: r.savedAt.toISOString() }))}
        timezone={ctx.station.timezone}
        readOnly={!allowed(ctx, "edit_format")}
      />
    </div>
  );
}
