/**
 * Dual-write to canonical `certification_records` (Phase 1B).
 *
 * ON by default since 2026-09-08: the AI certification scan and the review
 * queue run off the canonical rows, so every worker upload must create one.
 * Set `REACT_APP_CERT_RECORDS_DUAL_WRITE=false` to opt out (dev only).
 */
export function isCertRecordsDualWriteEnabled(): boolean {
  return process.env.REACT_APP_CERT_RECORDS_DUAL_WRITE !== 'false';
}
