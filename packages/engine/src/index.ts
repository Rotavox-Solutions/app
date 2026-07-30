export const ENGINE_VERSION = "0.4.0";

export * from "./types.js";
export { generateLog } from "./generate.js";
export { SeparationState, normKey } from "./separation.js";
export { createRng } from "./rng.js";
export { localParts, iterateHours, assertHourAligned, weekInCycle, HOUR_MS } from "./time.js";
export {
  resolveRules,
  buildStationConstraints,
  buildCategoryIndex,
  ancestry,
  subtree,
} from "./rules.js";
export type { EffectiveRules, StationConstraints } from "./rules.js";
export {
  restScore,
  flowScore,
  eraSpreadScore,
  moodFitScore,
  soundFitScore,
  nearSeparationPenalty,
  scoreCandidate,
} from "./scoring.js";
export type { ScoreContext } from "./scoring.js";
export { buildRungs, fillPosition } from "./ladder.js";
export type { Rung, FillResult } from "./ladder.js";
export { basePool, hardFilter } from "./candidates.js";
export type { FilterContext } from "./candidates.js";
