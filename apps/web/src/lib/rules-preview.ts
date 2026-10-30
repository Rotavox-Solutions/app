// "Try these rules": generate the next hours on the real week grid, in memory, once with
// the saved rules and once with the editor's draft, same seed. Tighter separation is how
// fill failures start (FORMAT-WORKFLOW §1a item 6), so the comparison is rules relaxed and
// slots left empty. READ-ONLY: nothing is written, and no log or horizon is touched.
import type { EngineRule } from "@rotavox/engine";
import type { RuleDraft } from "@rotavox/schema";
import { loadGenerationInputs } from "./generation";
import { HOUR_MS } from "./constants";
import { runPreview, type PreviewRun } from "./clock-preview";

export interface RulesPreview {
  start: string;
  hours: number;
  cueFidelity: number;
  saved: PreviewRun;
  draft: PreviewRun;
}

export async function previewRules(
  stationId: string,
  drafts: RuleDraft[],
  hours: number,
  now: Date = new Date()
): Promise<RulesPreview> {
  const start = new Date(Math.ceil(now.getTime() / HOUR_MS) * HOUR_MS);
  const end = new Date(start.getTime() + hours * HOUR_MS);
  const { input, cueFidelity } = await loadGenerationInputs(stationId, start, end);
  const base = { ...input, seed: `rules-preview-${start.toISOString()}` };
  const draftRules: EngineRule[] = drafts.map((d) => ({
    id: d.id ?? d.key,
    scope: d.scope,
    scopeRef: d.scope === "global" ? null : d.scopeRef,
    ruleType: d.ruleType,
    params: d.params ?? {},
    hardness: d.hardness,
    weight: d.weight,
  }));
  return {
    start: start.toISOString(),
    hours,
    cueFidelity,
    saved: runPreview(base),
    draft: runPreview({ ...base, rules: draftRules }),
  };
}
