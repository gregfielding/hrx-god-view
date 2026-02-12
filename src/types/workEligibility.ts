/**
 * Work Eligibility — attestation (not a document upload).
 * Stored on user as workEligibilityAttestation; workEligibility boolean is derived for compatibility.
 */

export interface WorkEligibilityAttestation {
  /** User attested they are authorized to work in the US */
  authorizedToWorkUS: boolean;
  /** User attested they now or in future require employer sponsorship */
  requireSponsorship?: boolean;
  /** When the attestation was given (Firestore Timestamp or ISO string) */
  attestedAt: any;
  /** Application id where this attestation was captured (wizard or quick apply) */
  sourceApplicationId?: string;
  /** Optional EEO self-identification */
  gender?: string;
  veteranStatus?: string;
  disabilityStatus?: string;
}

/**
 * Derive legacy workEligibility boolean from attestation.
 * Use for backward compatibility wherever code expects workEligibility: boolean.
 */
export function deriveWorkEligibilityFromAttestation(
  attestation: WorkEligibilityAttestation | null | undefined
): boolean {
  if (!attestation || typeof attestation !== 'object') return false;
  return attestation.authorizedToWorkUS === true;
}

/**
 * Whether the user has a completed attestation (authorized or not).
 */
export function hasWorkEligibilityAttestation(
  attestation: WorkEligibilityAttestation | null | undefined
): boolean {
  if (!attestation || typeof attestation !== 'object') return false;
  return attestation.attestedAt != null;
}

/** Checklist item key for Work Eligibility in onboarding.checklist */
export const WORK_ELIGIBILITY_CHECKLIST_KEY = 'work_eligibility';
