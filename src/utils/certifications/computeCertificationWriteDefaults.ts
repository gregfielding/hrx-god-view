import type {
  CertificationRecordStatus,
  CertificationReviewStatus,
  CertificationSourcePhase1,
} from '../../types/certifications/certificationEnums';

export type CertificationWriteDefaults = {
  reviewStatus: CertificationReviewStatus;
  recordStatus: CertificationRecordStatus;
};

/**
 * Phase 1B strict defaults (admin vs worker × file × catalog attestation).
 */
export function computeCertificationWriteDefaults(input: {
  source: CertificationSourcePhase1;
  hasEvidenceFile: boolean;
  catalogAllowsSelfAttestation: boolean;
}): CertificationWriteDefaults {
  const { source, hasEvidenceFile, catalogAllowsSelfAttestation } = input;

  if (source === 'admin_manual') {
    return { reviewStatus: 'approved', recordStatus: 'active' };
  }

  if (source === 'worker_upload' || hasEvidenceFile) {
    return { reviewStatus: 'submitted', recordStatus: 'pending_review' };
  }

  if (source === 'worker_attestation' && catalogAllowsSelfAttestation) {
    return { reviewStatus: 'not_required', recordStatus: 'active' };
  }

  return { reviewStatus: 'submitted', recordStatus: 'pending_review' };
}
