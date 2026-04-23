/** Phase 3 — readiness surfaces use certification engine outputs when true (see `.env` / CI). */
export function isCertEngineReadinessEnabled(): boolean {
  return process.env.REACT_APP_CERT_ENGINE_READINESS === 'true';
}
