/**
 * Mirrors `getWorkAuthorizedStatus` in `src/utils/workAuthorizedDisplay.ts`.
 * Cloud Functions `tsc` rootDir cannot import repo `src/`; keep logic identical when attestation rules change.
 *
 * Intentionally ignores legacy `workEligibility` (same as web helper).
 */

export type WorkAuthorizedStatusReadiness = 'yes' | 'no' | 'skipped';

export function getWorkAuthorizedStatusForReadiness(user: unknown): WorkAuthorizedStatusReadiness {
  if (user == null || typeof user !== 'object') return 'skipped';
  const u = user as { workEligibilityAttestation?: { authorizedToWorkUS?: boolean } | null };
  const attestation = u.workEligibilityAttestation;
  if (attestation != null && typeof attestation === 'object' && typeof attestation.authorizedToWorkUS === 'boolean') {
    return attestation.authorizedToWorkUS ? 'yes' : 'no';
  }
  return 'skipped';
}
