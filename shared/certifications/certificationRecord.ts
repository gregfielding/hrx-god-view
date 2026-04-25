/**
 * Minimal canonical `certification_records` shape (Phase 1A — types only).
 * Timestamps use `unknown` until Firestore serializers land in 1B.
 */
import type {
  CertificationRecordStatus,
  CertificationReviewStatus,
  CertificationSourcePhase1,
} from './certificationEnums';

export type CertificationEvidenceFileRefV1 = {
  /** Firebase Storage path (e.g. users/uid/certifications/slug/file) when known. */
  storagePath?: string;
  storageUrl?: string;
  fileName?: string | null;
};

export type CertificationReviewStateV1 = {
  status: CertificationReviewStatus;
  rejectionReason?: string | null;
};

/**
 * Frozen Phase 1 document — do not add OCR, tenant overrides, scoring, etc. (spec §9 discipline).
 */
export type CertificationRecordV1 = {
  schemaVersion: 1;
  catalogEntryId: string;
  issuer?: string | null;
  /** UTC calendar date YYYY-MM-DD when set. */
  expirationDate?: string | null;
  evidenceFileRefs?: CertificationEvidenceFileRefV1[];
  review: CertificationReviewStateV1;
  recordStatus: CertificationRecordStatus;
  source: CertificationSourcePhase1;
  createdAt?: unknown;
  updatedAt?: unknown;
};
