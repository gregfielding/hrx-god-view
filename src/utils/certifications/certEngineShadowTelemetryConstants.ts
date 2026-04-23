/**
 * Shadow telemetry: persist engine vs legacy comparisons for mismatch rate / unmapped analysis.
 * Enable writes with `REACT_APP_CERT_SHADOW_PERSISTENCE=true` (requires auth for Firestore).
 */
export const CERT_ENGINE_SHADOW_COLLECTION = 'cert_engine_shadow_events';

/** Fraction of agreeing (non-mismatch) events to persist for baseline volume (0–1). Mismatches always persist when persistence is on. */
export const CERT_ENGINE_SHADOW_SAMPLE_RATE = 0.2;

export function isCertShadowPersistenceEnabled(): boolean {
  return process.env.REACT_APP_CERT_SHADOW_PERSISTENCE === 'true';
}

/** @deprecated Use `process.env.NODE_ENV === 'development'` only; panel is dev-gated in `App.tsx`. */
export function isCertShadowDebugPanelEnabled(): boolean {
  return process.env.NODE_ENV === 'development';
}
