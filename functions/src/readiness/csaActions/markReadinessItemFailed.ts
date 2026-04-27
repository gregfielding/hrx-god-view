/**
 * **R.3** — `markReadinessItemFailed` callable. CSA records a final fail
 * verdict on a readiness item — `complete_fail` +
 * `resolutionMethod: 'csa_confirmed'` (the recruiter is _confirming_ the
 * failure manually, so the resolution method matches `confirmReadinessItem`
 * — the difference is the destination status).
 *
 *   - Operates on `assignmentReadinessItems` or `employeeReadinessItems`
 *     based on the explicit `collection` argument.
 *   - Refuses AccuSource and E-Verify items — those route through dedicated
 *     callables.
 *   - `note` is REQUIRED — non-empty string. The callable rejects empty /
 *     missing notes with `invalid-argument`.
 *   - Admin-gated (admin/super_admin/manager role OR security level >= 5)
 *     via `ensureReadinessCsaAdmin`.
 *
 * Note: the chip aggregator treats `complete_fail` as a hard blocker for
 * `severity: 'hard'` items and as informational for `severity: 'soft'`
 * items, matching the rest of the model. R.3 doesn't change those rules.
 *
 * @see ./applyCsaReadinessAction.ts for the shared transition logic.
 * @see docs/READINESS_R3_HANDOFF.md
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';

import { applyCsaReadinessAction } from './applyCsaReadinessAction';
import { ensureReadinessCsaAdmin } from './ensureReadinessCsaAdmin';
import type { CsaReadinessActionInput } from './csaActionTypes';

export const markReadinessItemFailed = onCall({ cors: true }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  const data = (request.data || {}) as CsaReadinessActionInput;
  await ensureReadinessCsaAdmin(request.auth.uid, data?.tenantId ?? null);
  return applyCsaReadinessAction(data, request.auth.uid, 'csa_mark_failed');
});
