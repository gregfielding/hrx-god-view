/**
 * Minimal canonical `certification_records` shape (Phase 1A — types only).
 * Timestamps use `unknown` until Firestore serializers land in 1B.
 */
import type {
  CertificationRecordStatus,
  CertificationReviewStatus,
  CertificationSourcePhase1,
} from './certificationEnums';
import type { CertificationAiVerificationV1, CertificationScanVerdict } from './certificationAiVerification';

export type CertificationEvidenceFileRefV1 = {
  /** Firebase Storage path (e.g. users/uid/certifications/slug/file) when known. */
  storagePath?: string;
  storageUrl?: string;
  fileName?: string | null;
};

export type CertificationReviewStateV1 = {
  status: CertificationReviewStatus;
  /** A `CertificationScanReasonCode` when the AI scan or a reviewer rejected; free text on legacy rows. */
  rejectionReason?: string | null;
  /** `'system'` when the AI scan decided; otherwise the reviewer uid (added 2026-09-08). */
  decidedBy?: string | null;
  decidedAt?: unknown;
  /** Reviewer note (capped at 500 chars). */
  note?: string | null;
  /** Stashed the first time a reviewer flips away from the scan's verdict, so the UI can show the override. */
  previousAutoVerdict?: CertificationScanVerdict | null;
};

/**
 * Phase 1 document. The one post-freeze addition is `aiVerification`
 * (2026-09-08, Greg: AI cert scan + review queue) — server-written, optional,
 * ignored by every Phase 1 reader. Tenant overrides / scoring still do NOT
 * belong here (spec §9 discipline).
 */
export type CertificationRecordV1 = {
  schemaVersion: 1;
  catalogEntryId: string;
  issuer?: string | null;
  /** UTC calendar date YYYY-MM-DD when set. */
  expirationDate?: string | null;
  /** Worker-typed (or scan-filled on approve) certificate / license number — key for issuer lookups. Added 2026-09-08. */
  certificateNumber?: string | null;
  evidenceFileRefs?: CertificationEvidenceFileRefV1[];
  review: CertificationReviewStateV1;
  recordStatus: CertificationRecordStatus;
  source: CertificationSourcePhase1;
  /** AI scan of the evidence file. Server-only writer; absent until the first scan. */
  aiVerification?: CertificationAiVerificationV1 | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};
