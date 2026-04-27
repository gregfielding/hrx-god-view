/**
 * Source weights, interview dampening, and fixed confidence bumps per event source (V2).
 */

import type { CategoryScoreEventSourceV1 } from './categoryScoreEventTypes';

/** Applied as: rawDelta * SOURCE_WEIGHT[source] before diminishing + caps. */
export const SOURCE_WEIGHT: Record<CategoryScoreEventSourceV1, number> = {
  interview: 1.0,
  background_check: 1.2,
  shift_completion: 1.3,
  no_show: 1.5,
  activity: 0.4,
  recruiter_override: 2.0,
};

export function sourceWeightFor(source: CategoryScoreEventSourceV1): number {
  const w = SOURCE_WEIGHT[source];
  return typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 1;
}

/**
 * Confidence points added per category updated by this event (then clamped 0–100).
 * V1 table: fixed increments, not tied to |delta| magnitude.
 */
export function confidenceIncrementForSource(source: CategoryScoreEventSourceV1): number {
  switch (source) {
    case 'interview':
      return 10;
    case 'background_check':
      return 15;
    case 'shift_completion':
      return 12;
    case 'no_show':
      return 12;
    case 'activity':
      return 3;
    case 'recruiter_override':
      return 20;
    default:
      return 0;
  }
}

/**
 * Dampen *new* interview-sourced deltas only (does not recompute stored scores).
 * Uses count of prior successful interview applies (this transaction not included).
 */
export function interviewDeltaWeight(priorInterviewApplyCount: number): number {
  const n = Math.max(0, Math.floor(priorInterviewApplyCount));
  if (n > 15) return 0.2;
  if (n > 5) return 0.5;
  return 1.0;
}
