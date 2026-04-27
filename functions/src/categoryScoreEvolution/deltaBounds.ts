/**
 * Conservative per-source caps on |delta| for a single category score event (0–100 scale).
 */

import type { CategoryScoreEventSourceV1 } from './categoryScoreEventTypes';

export const MAX_ABS_DELTA_BY_SOURCE: Record<CategoryScoreEventSourceV1, number> = {
  interview: 12,
  background_check: 8,
  shift_completion: 6,
  no_show: 10,
  /** Small per-event deltas only (engagement / funnel participation). */
  activity: 4,
  recruiter_override: 15,
};

export function clampDeltaForSource(
  requestedDelta: number,
  source: CategoryScoreEventSourceV1,
): { appliedDelta: number; clamped: boolean } {
  const cap = MAX_ABS_DELTA_BY_SOURCE[source];
  const abs = Math.abs(requestedDelta);
  if (abs <= cap) {
    return { appliedDelta: Math.round(requestedDelta), clamped: false };
  }
  const sign = requestedDelta >= 0 ? 1 : -1;
  return { appliedDelta: sign * cap, clamped: true };
}
