/**
 * E-Verify configuration (env / secrets).
 * HRX E-Verify Master Plan §3.2
 */

export function getEverifyEnv(): 'stage' | 'prod' {
  const v = process.env.EVERIFY_ENV || 'stage';
  return v === 'prod' ? 'prod' : 'stage';
}

/** Base URL for E-Verify API (Stage: https://stage-everify.uscis.gov/api/v31) */
export function getEverifyBaseUrl(): string {
  return (
    process.env.EVERIFY_BASE_URL || 'https://stage-everify.uscis.gov/api/v31'
  );
}

/** OAuth token endpoint for Stage (may differ from API base) */
export function getEverifyAuthUrl(): string {
  return (
    process.env.EVERIFY_AUTH_URL || 'https://stage-everify.uscis.gov/oauth/accesstoken'
  );
}

export function getEverifyTimeoutMs(): number {
  return parseInt(process.env.EVERIFY_TIMEOUT_MS || '30000', 10);
}

export function getEverifyMaxRetries(): number {
  return parseInt(process.env.EVERIFY_MAX_RETRIES || '2', 10);
}

/**
 * Fake provider: when true, use stub instead of real ICA API.
 * Prefer EVERIFY_FAKE_PROVIDER so nobody thinks OAuth/EAAT is "real E-Verify."
 * Real provider path is ICA login + bearer only.
 */
export function getEverifyFakeProvider(): boolean {
  return (
    process.env.EVERIFY_FAKE_PROVIDER === 'true' ||
    process.env.EVERIFY_FAKE_PROVIDER === '1' ||
    process.env.EVERIFY_EAAT_STUB === 'true' ||
    process.env.EVERIFY_EAAT_STUB === '1'
  );
}

/** @deprecated Use getEverifyFakeProvider. Kept for backward compatibility. */
export function getEverifyEaatStub(): boolean {
  return getEverifyFakeProvider();
}

/** Optional scenario for fake provider simulation: e.g. 'employment_authorized', 'tnc', 'error' */
export function getEverifyEaatScenario(): string | undefined {
  return process.env.EVERIFY_EAAT_SCENARIO || process.env.EVERIFY_FAKE_SCENARIO || undefined;
}

/** Cloud Tasks worker URL (config-driven; no hardcoded v2 function URL) */
export function getEverifyWorkerUrl(): string | undefined {
  return process.env.EVERIFY_WORKER_URL || undefined;
}

/** Queue name for E-Verify tasks */
export function getEverifyQueueName(): string {
  return process.env.EVERIFY_QUEUE || 'everify';
}
