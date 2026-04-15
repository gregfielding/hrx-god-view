import { defineString } from 'firebase-functions/params';
import { AccusourceEnvironment, AccusourceProviderConfig } from './types';

/** Official hosts (SourceDirect API V2 external docs). Override with ACCUSOURCE_BASE_URL if AccuSource gives a different gateway. */
const DEFAULT_SANDBOX_BASE = 'https://sdapi-sandbox.accusourcedirect.construction';
const DEFAULT_PROD_BASE = 'https://sdapi.accusourcedirect.com';

/** Applicant self-service setup (partial profile invite) — not the REST API host. */
const DEFAULT_APPLICANT_SETUP_SANDBOX = 'https://sandbox.myaccusourcedirect.construction/setup?token=';
const DEFAULT_APPLICANT_SETUP_PRODUCTION = 'https://myaccusourcedirect.com/setup?token=';

/**
 * Firebase params (see `functions/scripts/copyEnvFromRoot.js` PARAM_KEYS) — same names as root `.env`.
 * Falls back to `process.env` so local scripts and tests keep working.
 */
const P_ACCUSOURCE_API_KEY = defineString('ACCUSOURCE_API_KEY', { default: '' });
const P_SOURCEDIRECT_API_KEY = defineString('SOURCEDIRECT_API_KEY', { default: '' });
const P_ACCUSOURCE_ENVIRONMENT = defineString('ACCUSOURCE_ENVIRONMENT', { default: '' });
const P_ACCUSOURCE_BASE_URL = defineString('ACCUSOURCE_BASE_URL', { default: '' });
const P_ACCUSOURCE_WEBHOOK_SECRET = defineString('ACCUSOURCE_WEBHOOK_SECRET', { default: '' });
const P_SOURCEDIRECT_WEBHOOK_SECRET = defineString('SOURCEDIRECT_WEBHOOK_SECRET', { default: '' });
const P_ACCUSOURCE_ENABLED = defineString('ACCUSOURCE_ENABLED', { default: 'true' });
/** When `ACCUSOURCE_ENVIRONMENT` is production and this is not `false`, only `hrx: true` users may submit orders; automation is blocked. */
const P_ACCUSOURCE_PRODUCTION_VALIDATION_HRX_ONLY = defineString('ACCUSOURCE_PRODUCTION_VALIDATION_HRX_ONLY', {
  default: 'true',
});

function trimStr(v: string | undefined): string {
  return (v ?? '').trim();
}

function normalizeEnvironment(input: unknown): AccusourceEnvironment {
  const value = String(input || '').toLowerCase();
  if (value === 'production' || value === 'prod') return 'production';
  return 'sandbox';
}

/** Resolve API key: param → process.env (names must match copy-env / Firebase deploy). */
function resolveAccusourceApiKey(): string | undefined {
  const fromParam =
    trimStr(P_ACCUSOURCE_API_KEY.value()) || trimStr(P_SOURCEDIRECT_API_KEY.value());
  const fromEnv =
    trimStr(process.env.ACCUSOURCE_API_KEY) ||
    trimStr(process.env.SOURCEDIRECT_API_KEY) ||
    trimStr(process.env.SOURCEDIRECT_ACCESS_TOKEN) ||
    trimStr(process.env.ACCUSOURCE_ACCESS_TOKEN) ||
    trimStr(process.env.ACCUSOURCE_BEARER_TOKEN);
  const key = fromParam || fromEnv;
  return key || undefined;
}

export function getAccusourceConfig(): AccusourceProviderConfig {
  const envRaw =
    trimStr(P_ACCUSOURCE_ENVIRONMENT.value()) ||
    trimStr(process.env.ACCUSOURCE_ENVIRONMENT) ||
    trimStr(process.env.ACCUSOURCE_ENV);
  const environment = normalizeEnvironment(envRaw || 'sandbox');

  const baseUrlFromEnv =
    trimStr(P_ACCUSOURCE_BASE_URL.value()) || trimStr(process.env.ACCUSOURCE_BASE_URL);
  const baseUrl =
    baseUrlFromEnv.length > 0
      ? baseUrlFromEnv
      : environment === 'production'
        ? DEFAULT_PROD_BASE
        : DEFAULT_SANDBOX_BASE;

  const apiKey = resolveAccusourceApiKey();
  const webhookSecret =
    trimStr(P_ACCUSOURCE_WEBHOOK_SECRET.value()) ||
    trimStr(P_SOURCEDIRECT_WEBHOOK_SECRET.value()) ||
    trimStr(process.env.ACCUSOURCE_WEBHOOK_SECRET) ||
    trimStr(process.env.SOURCEDIRECT_WEBHOOK_SECRET) ||
    undefined;

  const enabledRaw =
    trimStr(P_ACCUSOURCE_ENABLED.value()) || trimStr(process.env.ACCUSOURCE_ENABLED) || 'true';
  const enabled = enabledRaw.toLowerCase() !== 'false';

  return {
    environment,
    baseUrl,
    apiKey,
    webhookSecret,
    enabled,
  };
}

/**
 * Production cutover / validation: restrict who can create SourceDirect profiles and block assignment automation orders.
 * Set `ACCUSOURCE_PRODUCTION_VALIDATION_HRX_ONLY=false` after validation to allow tenant admins (L5+) to order in production.
 */
export function isAccusourceProductionValidationHrxOnly(): boolean {
  const v =
    trimStr(P_ACCUSOURCE_PRODUCTION_VALIDATION_HRX_ONLY.value()) ||
    trimStr(process.env.ACCUSOURCE_PRODUCTION_VALIDATION_HRX_ONLY) ||
    'true';
  return v.toLowerCase() !== 'false' && v !== '0';
}

/**
 * Base URL for applicant-facing partial-profile setup links (includes `?token=`).
 * Override with ACCUSOURCE_APPLICANT_SETUP_BASE_URL for staging or vendor changes.
 */
export function getAccusourceApplicantSetupBaseUrl(environment: AccusourceEnvironment): string {
  const fromEnv = trimStr(process.env.ACCUSOURCE_APPLICANT_SETUP_BASE_URL);
  if (fromEnv.length > 0) {
    if (fromEnv.includes('token=')) return fromEnv;
    const base = fromEnv.replace(/\/?$/, '');
    return `${base}/setup?token=`;
  }
  return environment === 'production' ? DEFAULT_APPLICANT_SETUP_PRODUCTION : DEFAULT_APPLICANT_SETUP_SANDBOX;
}

/** Full applicant portal URL for a partial-profile invite token. */
export function buildAccusourceApplicantPortalLink(
  environment: AccusourceEnvironment,
  token: string,
): string | null {
  const t = String(token ?? '').trim();
  if (!t) return null;
  const base = getAccusourceApplicantSetupBaseUrl(environment);
  return `${base}${encodeURIComponent(t)}`;
}

