/**
 * Opt-in dual-write to `certification_records` (Phase 1B).
 * Set `REACT_APP_CERT_RECORDS_DUAL_WRITE=true` in env (e.g. `.env.local`).
 */
export function isCertRecordsDualWriteEnabled(): boolean {
  return process.env.REACT_APP_CERT_RECORDS_DUAL_WRITE === 'true';
}
