/**
 * Build-time flags for certification engine surfaces (CRA injects at compile time).
 *
 * Kept flags:
 * - REACT_APP_CERT_ENGINE_READINESS
 * - REACT_APP_CERT_ENGINE_ACTION_ITEMS
 * - REACT_APP_CERT_ENGINE_TRUST_SURFACES
 * - REACT_APP_CERT_SHADOW_PERSISTENCE (see certEngineShadowTelemetryConstants.ts)
 * - REACT_APP_CERT_RECORDS_DUAL_WRITE (dual-write; not a surface flag)
 */

import { isCertEngineReadinessEnabled } from './certEngineReadinessFlag';

/** True when any primary engine surface flag is on (readiness, action items, or trust UI). */
export function isCertificationEngineEnabled(): boolean {
  return (
    isCertEngineReadinessEnabled() ||
    isCertEngineActionItemsEnabled() ||
    isCertEngineTrustSurfacesEnabled()
  );
}

export function isCertEngineActionItemsEnabled(): boolean {
  return process.env.REACT_APP_CERT_ENGINE_ACTION_ITEMS === 'true';
}

/** Phase 5B/C — recruiter scoring explanation + readiness cert summary (no automation). */
export function isCertEngineTrustSurfacesEnabled(): boolean {
  return process.env.REACT_APP_CERT_ENGINE_TRUST_SURFACES === 'true';
}
