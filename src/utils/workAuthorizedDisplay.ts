/**
 * Work Authorized (authorized to work in the US) display helpers.
 * Only workEligibilityAttestation.authorizedToWorkUS is used; legacy workEligibility is ignored
 * so that "Skipped" is shown until the user has completed the attestation.
 */

export type WorkAuthorizedStatus = 'yes' | 'no' | 'skipped';

export interface WorkAuthorizedSource {
  workEligibility?: boolean;
  workEligibilityAttestation?: {
    authorizedToWorkUS?: boolean;
    requireSponsorship?: boolean | null;
  } | null;
}

/**
 * Derive display status from user data.
 * - yes: attestation has authorizedToWorkUS === true (real answer or the
 *   C1 Events contractor-terms attestation)
 * - no: attestation has an EXPLICIT false AND requireSponsorship is a
 *   boolean — i.e. the worker really completed the eligibility step.
 * - skipped: everything else. 2026-07-09 (Greg): sign-up stopped asking
 *   the question, but the apply flow kept auto-writing
 *   `authorizedToWorkUS: false` with `requireSponsorship: null` for
 *   workers who were never shown it — that shape must read as
 *   never-answered, not as a red "No".
 * We do not use legacy workEligibility so that workers who haven't completed the step show Skipped.
 */
export function getWorkAuthorizedStatus(user: unknown): WorkAuthorizedStatus {
  if (user == null || typeof user !== 'object') return 'skipped';
  const u = user as WorkAuthorizedSource;
  const attestation = u.workEligibilityAttestation;
  if (attestation != null && typeof attestation === 'object' && typeof attestation.authorizedToWorkUS === 'boolean') {
    if (attestation.authorizedToWorkUS) return 'yes';
    if (typeof attestation.requireSponsorship === 'boolean') return 'no';
  }
  return 'skipped';
}

export function getWorkAuthorizedLabel(status: WorkAuthorizedStatus): string {
  switch (status) {
    case 'yes': return 'Yes';
    case 'no': return 'No';
    case 'skipped': return 'Skipped';
  }
}

/** For table sort: order yes first, then no, then skipped (or configurable). */
export function compareWorkAuthorized(a: WorkAuthorizedStatus, b: WorkAuthorizedStatus): number {
  const order: Record<WorkAuthorizedStatus, number> = { yes: 0, no: 1, skipped: 2 };
  return order[a] - order[b];
}
