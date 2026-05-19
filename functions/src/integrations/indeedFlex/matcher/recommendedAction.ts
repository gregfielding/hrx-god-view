/**
 * **Slice 3/4 — apply-gate hint computation.**
 *
 * Pure function. Maps `(eventType, matchConfidence)` →
 * `recommendedAction` per the slice 4 spec:
 *
 *   - `auto`         — additive + exact match. Slice 5 may auto-apply
 *                      once activated. Today the UI still asks the
 *                      recruiter to click approve.
 *   - `review`       — high-confidence change. Stays human-gated even
 *                      after Slice 5 ships.
 *   - `manual-only`  — destructive (cancel_booking, no_show), or low
 *                      confidence (multiple / none). Slice 5 will NEVER
 *                      auto-apply these.
 */

import type {
  ExternalShiftRequest,
  ExternalShiftRequestRecommendedAction,
  IndeedFlexEventType,
} from '../../../shared/indeedFlex/types';

type MatchConfidence = NonNullable<ExternalShiftRequest['matchConfidence']>;

export function recommendedActionFor(
  eventType: IndeedFlexEventType,
  matchConfidence: MatchConfidence,
): ExternalShiftRequestRecommendedAction {
  // Destructive event types always stay manual-only, regardless of
  // confidence — we don't want a misclassified email cancelling a
  // worker's shift without a human in the loop.
  if (eventType === 'cancel_booking' || eventType === 'no_show') {
    return 'manual-only';
  }

  // Low / ambiguous match — recruiter has to disambiguate.
  if (matchConfidence === 'none' || matchConfidence === 'multiple') {
    return 'manual-only';
  }

  // Digests are info-only; the recruiter scans them but the system
  // shouldn't auto-act on the expired-jobs list.
  if (eventType === 'daily_digest_expired') {
    return 'review';
  }

  // Additive + exact = the only auto-apply candidate today.
  if (eventType === 'new_request' && matchConfidence === 'exact') {
    return 'auto';
  }

  // Everything else — change_time, change_headcount on exact/fuzzy —
  // stays human-gated by default.
  return 'review';
}
