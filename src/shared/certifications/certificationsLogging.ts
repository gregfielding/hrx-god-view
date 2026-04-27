/** Standardized dev logging for certifications modules (implementation discipline §6). */

export type CertificationLogType =
  | 'unmapped_legacy_name'
  | 'duplicate_detected'
  | 'field_mismatch'
  | 'dual_write_failed'
  | 'readiness_mismatch'
  | 'action_items_mismatch'
  | 'recruiter_explanation_mismatch'
  /** Phase 6 — structured legacy vs engine comparison (diagnostics). */
  | 'cert_engine_shadow_mismatch'
  /** Dev-only — code path still touched legacy cert storage; do not add new dependencies. */
  | 'legacy_cert_usage_detected';

export function warnCertifications(
  type: CertificationLogType,
  payload: {
    userId?: string | null;
    detail: string | Record<string, unknown>;
  },
): void {
  // eslint-disable-next-line no-console -- intentional structured diagnostics
  console.warn('[certifications]', { type, ...payload });
}

/**
 * Dev-only: surface when legacy `user.certifications` / `workerProfile.credentials.certifications` are used.
 * Does nothing in production.
 */
export function warnLegacyCertUsageDetected(detail: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'production') return;
  warnCertifications('legacy_cert_usage_detected', { detail });
}
