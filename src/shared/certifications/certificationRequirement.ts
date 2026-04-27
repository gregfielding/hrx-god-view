/**
 * Phase 1 — structured requirement (engine + preview only; not yet job order source of truth).
 * See certifications_phase1_build_spec.md §7.
 */
export type Phase1CertificationRequirement = {
  requirementId: string;
  catalogEntryId: string;
  scope: 'required' | 'preferred';
  evidencePolicy: 'upload_required' | 'attestation_allowed' | 'either';
  reviewPolicy: 'must_be_approved' | 'pending_ok_for_apply' | 'pending_ok_for_assignment';
  expirationPolicy: 'must_be_valid' | 'grace_days' | 'warn_only';
  gracePeriodDays?: number;
  /** First legacy job-order string that mapped to this row (bridge only). */
  legacySourceLabel?: string;
  /**
   * **R.1 (D4.R1)** — Per-instance severity override for the seeded
   * `cert_match` readiness item. Falls through to
   * `JobOrder.requirementSeverityOverrides.cert_match` then to the `'hard'`
   * type default. Set explicitly on `scope: 'preferred'` requirements when the
   * operator wants the chip to show preferred items as soft contributors.
   */
  severity?: 'hard' | 'soft';
};

export type EvaluationContext = 'apply' | 'assignment' | 'generic';
