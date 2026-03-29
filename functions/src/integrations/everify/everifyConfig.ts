/**
 * E-Verify configuration (env / secrets).
 * HRX E-Verify Master Plan §3.2
 */

export function getEverifyEnv(): 'stage' | 'prod' {
  const v = process.env.EVERIFY_ENV || 'stage';
  return v === 'prod' ? 'prod' : 'stage';
}

/**
 * Fail fast when prod is selected but API host is still USCIS stage (common misconfiguration).
 * USCIS does not publish production REST roots publicly; they are in the official go-live letter.
 *
 * @see https://developer.uscis.gov/node/145 — production keys and endpoints are emailed on approval
 */
export function assertEverifyEnvUrlConsistency(): void {
  const env = getEverifyEnv();
  const base = getEverifyBaseUrl().toLowerCase();
  if (env === 'prod' && base.includes('stage-everify')) {
    throw new Error(
      'EVERIFY_ENV is prod but EVERIFY_BASE_URL points to USCIS stage (stage-everify). ' +
        'Set EVERIFY_BASE_URL (and any auth URL your ICA specifies) to the production values from your USCIS go-live letter.'
    );
  }
}

/** Base URL for E-Verify API (Stage default: https://stage-everify.uscis.gov/api/v31) */
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

/**
 * Non-secret snapshot for everifyPingAuth / ops. ICA REST login uses restLoginUrl (not oauthClientCredentialsUrl).
 */
export function getEverifyAuthArchitectureDiagnostics(): {
  everifyEnabledRuntime: boolean;
  everifyEnv: 'stage' | 'prod';
  everifyBaseUrl: string;
  restLoginUrl: string;
  restLoginHost: string;
  restLoginPath: string;
  oauthClientCredentialsUrl: string;
  fakeProvider: boolean;
  deployedHostIsLikelyStage: boolean;
  deployedHostIsLikelyProduction: boolean;
} {
  const base = getEverifyBaseUrl().replace(/\/$/, '');
  const loginUrl = `${base}/authentication/login`;
  let restLoginHost = '';
  let restLoginPath = '/authentication/login';
  try {
    const u = new URL(loginUrl);
    restLoginHost = u.host;
    restLoginPath = u.pathname || restLoginPath;
  } catch {
    restLoginHost = '';
  }
  const h = restLoginHost.toLowerCase();
  return {
    everifyEnabledRuntime: process.env.EVERIFY_ENABLED === 'true',
    everifyEnv: getEverifyEnv(),
    everifyBaseUrl: base,
    restLoginUrl: loginUrl,
    restLoginHost,
    restLoginPath,
    oauthClientCredentialsUrl: getEverifyAuthUrl(),
    fakeProvider: getEverifyFakeProvider(),
    deployedHostIsLikelyStage: h.includes('stage-everify'),
    deployedHostIsLikelyProduction: h.includes('everify.uscis.gov') && !h.includes('stage-everify'),
  };
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

// ─── SOAP (ICA: align namespaces / SOAPAction with your Interface Control Agreement) ─

/** Full SOAP endpoint URL. Default: {EVERIFY_BASE_URL}/soap — confirm path in ICA. */
export function getEverifySoapUrl(): string {
  const explicit = process.env.EVERIFY_SOAP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const base = getEverifyBaseUrl().replace(/\/$/, '');
  const suffix = process.env.EVERIFY_SOAP_PATH || '/soap';
  return `${base}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

export function getEverifySoapServiceNamespace(): string {
  return (
    process.env.EVERIFY_SOAP_SERVICE_NS ||
    'http://everify.uscis.gov/soap/v31'
  );
}

export function getEverifySoapLoginSoapAction(): string {
  return process.env.EVERIFY_SOAP_LOGIN_SOAPACTION || 'urn:everify:Authenticate';
}

export function getEverifySoapCreateCaseSoapAction(): string {
  return process.env.EVERIFY_SOAP_CREATE_CASE_SOAPACTION || 'urn:everify:CreateCase';
}

/** SOAP 1.1 (default) or 1.2 — some gateways differ on Content-Type / SOAPAction. */
export function getEverifySoapVersion(): '1.1' | '1.2' {
  return process.env.EVERIFY_SOAP_VERSION === '1.2' ? '1.2' : '1.1';
}

export function getEverifySoapTimeoutMs(): number {
  return parseInt(process.env.EVERIFY_SOAP_TIMEOUT_MS || String(getEverifyTimeoutMs()), 10);
}
