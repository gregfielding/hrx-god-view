/**
 * Work Authorized (authorized to work in the US) display helpers.
 * Value comes from workEligibilityAttestation.authorizedToWorkUS or legacy workEligibility.
 */

export type WorkAuthorizedStatus = 'yes' | 'no' | 'skipped';

export interface WorkAuthorizedSource {
  workEligibility?: boolean;
  workEligibilityAttestation?: { authorizedToWorkUS?: boolean } | null;
}

/**
 * Derive display status from user data.
 * - yes: explicitly authorized (true)
 * - no: explicitly not authorized (false)
 * - skipped: not answered yet (undefined/null)
 * Accepts any value (e.g. user, candidate, member) and safely reads workEligibility / workEligibilityAttestation.
 */
export function getWorkAuthorizedStatus(user: unknown): WorkAuthorizedStatus {
  if (user == null || typeof user !== 'object') return 'skipped';
  const u = user as WorkAuthorizedSource;
  const attestation = u.workEligibilityAttestation;
  if (attestation != null && typeof attestation === 'object' && typeof attestation.authorizedToWorkUS === 'boolean') {
    return attestation.authorizedToWorkUS ? 'yes' : 'no';
  }
  if (typeof u.workEligibility === 'boolean') {
    return u.workEligibility ? 'yes' : 'no';
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
