import {
  findProfileCertForRequirement,
  getCertificationVerificationStatus,
  isUploadRequiredCert,
  type CertificationVerificationStatus,
} from '../certificationVerification';
import type { CertificationEvaluationResult } from './evaluateCertificationRequirement';

export type CertificationShadowComparisonRow = {
  requirementId: string;
  /** Coarse legacy model label (profile array + upload-required heuristic). */
  legacyStatus: string;
  /** Engine vocabulary. */
  newStatus: string;
  mismatch: boolean;
  reasonDiff?: string;
};

/**
 * Shadow / debug only — **legacy path may use name-based lookup** (`findProfileCertForRequirement`).
 * The readiness engine itself remains string-matching-free; comparison happens outside the engine.
 */
export function compareCertificationEvaluationWithLegacy(input: {
  requirementId: string;
  catalogDisplayNameForLegacyLookup: string;
  engineResult: CertificationEvaluationResult;
  profileCerts: Array<{
    name?: string;
    fileUrl?: string;
    expirationDate?: string;
    verificationStatus?: string;
  }> | null;
}): CertificationShadowComparisonRow {
  const { requirementId, catalogDisplayNameForLegacyLookup, engineResult, profileCerts } = input;

  const legacyCert = findProfileCertForRequirement(profileCerts, catalogDisplayNameForLegacyLookup);
  const uploadHeavy = isUploadRequiredCert(catalogDisplayNameForLegacyLookup);

  let legacyStatus: string;
  if (!legacyCert || !(legacyCert as { fileUrl?: string }).fileUrl) {
    legacyStatus = uploadHeavy ? 'legacy:missing_upload_expected' : 'legacy:missing_or_attest_path';
  } else {
    const v = getCertificationVerificationStatus(legacyCert as Parameters<typeof getCertificationVerificationStatus>[0]);
    legacyStatus = `legacy:${v}${uploadHeavy ? ':upload_req' : ''}`;
  }

  const newStatus = engineResult.status;

  const legacyVerification = (
    legacyCert
      ? getCertificationVerificationStatus(legacyCert as Parameters<typeof getCertificationVerificationStatus>[0])
      : 'missing'
  ) as CertificationVerificationStatus;

  const { mismatch, reasonDiff } = describeMismatch(legacyStatus, newStatus, legacyVerification);

  return { requirementId, legacyStatus, newStatus, mismatch: mismatch ?? false, reasonDiff };
}

function describeMismatch(
  legacyStatus: string,
  newStatus: CertificationEvaluationResult['status'],
  legacyVerification: CertificationVerificationStatus,
): { mismatch: boolean; reasonDiff?: string } {
  const engineCoarse = coarseEngine(newStatus);
  const legacyCoarse = coarseLegacy(legacyVerification);

  if (engineCoarse === legacyCoarse) {
    return { mismatch: false };
  }

  return {
    mismatch: true,
    reasonDiff: `coarse legacy=${legacyCoarse} engine=${engineCoarse} (raw legacy=${legacyStatus} raw engine=${newStatus})`,
  };
}

type Coarse = 'absent' | 'pending' | 'good' | 'expired';

function coarseEngine(s: CertificationEvaluationResult['status']): Coarse {
  if (s === 'approved' || s === 'expiring_soon') return 'good';
  if (s === 'expired') return 'expired';
  if (s === 'pending_review') return 'pending';
  return 'absent';
}

function coarseLegacy(v: CertificationVerificationStatus): Coarse {
  if (v === 'expired') return 'expired';
  if (v === 'verified') return 'good';
  if (v === 'uploaded') return 'pending';
  return 'absent';
}
