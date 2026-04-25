/**
 * CERTIFICATIONS ENUMS — LOCKED (Phase Final)
 *
 * CertificationEvaluationStatus, CertificationRecordStatus, CertificationReviewStatus,
 * CertificationConfidence — do not modify without explicit version bump and migration plan.
 *
 * @see certifications_phase1_build_spec.md §3
 */

export type CertificationRecordStatus =
  | 'draft'
  | 'pending_review'
  | 'active'
  | 'expired'
  | 'rejected'
  | 'superseded'
  | 'revoked';

export type CertificationReviewStatus =
  | 'not_required'
  | 'submitted'
  | 'approved'
  | 'rejected';

/** Engine output only — not persisted on Firestore in Phase 1. */
export type CertificationEvaluationStatus =
  | 'missing'
  | 'attested_only'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'expiring_soon'
  | 'invalid'
  | 'waived'
  | 'preferred_unmet';

export type CertificationConfidence = 'high' | 'medium' | 'low';

/** Persisted on Firestore `certification_records` in Phase 1 — three values only. */
export type CertificationSourcePhase1 = 'admin_manual' | 'worker_upload' | 'worker_attestation';
