/**
 * **R.3** — `confirmReadinessItem` callable. CSA marks a readiness item as
 * passed (`complete_pass` + `resolutionMethod: 'csa_confirmed'`).
 *
 *   - Operates on `assignmentReadinessItems` or `employeeReadinessItems`
 *     based on the explicit `collection` argument.
 *   - Refuses AccuSource (`background_check`, `drug_screen`,
 *     `screening_package_match`) and E-Verify items — those route through
 *     dedicated callables.
 *   - `note` is optional but recorded in the audit history when supplied.
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

export const confirmReadinessItem = onCall({ cors: true }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  const data = (request.data || {}) as CsaReadinessActionInput;
  await ensureReadinessCsaAdmin(request.auth.uid, data?.tenantId ?? null);
  return applyCsaReadinessAction(data, request.auth.uid, 'csa_confirm');
});
