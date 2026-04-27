/**
 * **R.3** — `waiveReadinessItem` callable. CSA bypasses a (typically soft)
 * readiness item with a mandatory note. Resolves the item as
 * `complete_pass` + `resolutionMethod: 'csa_waived'` so the chip / badge
 * counts it as satisfied while the audit trail captures the override.
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
 * @see ./applyCsaReadinessAction.ts for the shared transition logic.
 * @see docs/READINESS_R3_HANDOFF.md
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';

import { applyCsaReadinessAction } from './applyCsaReadinessAction';
import { ensureReadinessCsaAdmin } from './ensureReadinessCsaAdmin';
import type { CsaReadinessActionInput } from './csaActionTypes';

export const waiveReadinessItem = onCall({ cors: true }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  const data = (request.data || {}) as CsaReadinessActionInput;
  await ensureReadinessCsaAdmin(request.auth.uid, data?.tenantId ?? null);
  return applyCsaReadinessAction(data, request.auth.uid, 'csa_waive');
});
