/**
 * **Slice 3/4 — apply-gate hint computation.**
 *
 * Pure function. Maps `(eventType, matchConfidence)` →
 * `recommendedAction` per the slice 4 spec:
 *
 *   - `auto`         — the nightly triage (schedulingTriageNightly)
 *                      auto-applies these: exact new_request (creates
 *                      the shift, PI-2 2026-07-21) and exact
 *                      cancel_booking (truth-sync, 2026-07-19). The
 *                      recruiter can still click sooner.
 *   - `review`       — high-confidence change (change_time /
 *                      change_headcount). Stays human-gated.
 *   - `manual-only`  — no_show, or low confidence (multiple / none).
 *                      Never auto-applied.
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
  // 2026-07-21 cleanup (PI-2): the label now tells the truth about
  // what the nightly triage actually does. Exact cancel_booking rows
  // HAVE been auto-applied since 2026-07-19 (Greg's triage decision) —
  // the matcher named WHO on WHICH shift, the booking is gone at the
  // source, so applying is truth-sync. no_show stays manual-only, and
  // any non-exact confidence on a destructive type does too.
  if (eventType === 'no_show') {
    return 'manual-only';
  }
  if (eventType === 'cancel_booking') {
    return matchConfidence === 'exact' ? 'auto' : 'manual-only';
  }

  // Low / ambiguous match — recruiter has to disambiguate.
  if (matchConfidence === 'none' || matchConfidence === 'multiple') {
    return 'manual-only';
  }

  // Digests and info notices are info-only; the recruiter scans them
  // but the system never auto-acts.
  if (eventType === 'daily_digest_expired' || eventType === 'info_notice') {
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
