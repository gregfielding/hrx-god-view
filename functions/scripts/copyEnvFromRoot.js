#!/usr/bin/env node
/**
 * Copies param keys from repo root .env into functions/.env so Firebase deploy
 * doesn't prompt. Run before build (predeploy). Single source of truth: root .env.
 *
 * Firebase also loads `functions/.env.<PROJECT_ID>` (e.g. `.env.hrx1-d3beb`) when
 * you deploy to that project — those values OVERRIDE `functions/.env` for the same keys.
 * This script merges PARAM_KEYS into any existing `.env.<projectId>` from `.firebaserc`
 * so root `.env` wins and you don't stay stuck on old sandbox AccuSource settings.
 */
const fs = require('fs');
const path = require('path');

const FUNCTIONS_DIR = path.resolve(__dirname, '..');
const ROOT_ENV = path.join(FUNCTIONS_DIR, '..', '.env');
const FIREBASE_JSON = path.join(FUNCTIONS_DIR, '..', 'firebase.json');
const OUT_ENV = path.join(FUNCTIONS_DIR, '.env');

// All defineString / defineSecret keys used in functions (so deploy can read from .env and not prompt)
const PARAM_KEYS = [
  // defineString (params)
  'OPENAI_API_KEY',
  'SERP_API_KEY',
  'GNEWS_API_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  // scheduledGmailMonitoring (functions/src/gmailIntegration.ts) — must be literal "true"
  'ENABLE_GMAIL_MONITORING',
  'SMS_PROVIDER',
  // Server-side Geocoding API key (fieldglass auto-ensure street resolution
  // — functions/src/integrations/fieldglass/serverGeocode.ts). NOT the
  // browser Maps key; that one is API-restricted and rejected server-side.
  'GOOGLE_MAPS_SERVER_KEY',
  // defineSecret (secrets) – set in root .env if you use these
  'SENDGRID_API_KEY',
  'SENDGRID_FROM_EMAIL',
  'SENDGRID_FROM_NAME',
  'SLACK_SIGNING_SECRET',
  'SLACK_BOT_TOKEN',
  'APOLLO_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_MESSAGING_PHONE_NUMBER',
  'TWILIO_A2P_CAMPAIGN',
  'TWILIO_VERIFY_SERVICE_SID',
  // E-Verify (everifyGate, everifyConfig — functions/src/integrations/everify/)
  'EVERIFY_ENABLED',
  'EVERIFY_ENV',
  'EVERIFY_BASE_URL',
  'EVERIFY_AUTH_URL',
  'EVERIFY_I9_FIXTURE_JSON',
  'EVERIFY_STAGE_I9_FIXTURE_JSON',
  'EVERIFY_TIMEOUT_MS',
  'EVERIFY_MAX_RETRIES',
  'EVERIFY_FAKE_PROVIDER',
  'EVERIFY_EAAT_STUB',
  'EVERIFY_EAAT_SCENARIO',
  'EVERIFY_FAKE_SCENARIO',
  'EVERIFY_WORKER_URL',
  'EVERIFY_QUEUE',
  'EVERIFY_SOAP_URL',
  'EVERIFY_SOAP_PATH',
  'EVERIFY_SOAP_SERVICE_NS',
  'EVERIFY_SOAP_LOGIN_SOAPACTION',
  'EVERIFY_SOAP_CREATE_CASE_SOAPACTION',
  'EVERIFY_SOAP_VERSION',
  'EVERIFY_SOAP_TIMEOUT_MS',
  // EVERIFY_WS_USERNAME / EVERIFY_WS_PASSWORD are defineSecret-only — do NOT put them in functions/.env:
  // Firebase merges functions/.env as plain env vars; Cloud Run 400s if the same names are also secret mounts.
  // Set with: firebase functions:secrets:set EVERIFY_WS_USERNAME --data-file=-  (and PASSWORD); keep values in root .env for your records only, or use secrets:set exclusively.
  // AccuSource / SourceDirect (see functions/src/integrations/accusource/config.ts)
  'ACCUSOURCE_ENABLED',
  'ACCUSOURCE_ENVIRONMENT',
  'ACCUSOURCE_ENV',
  'ACCUSOURCE_BASE_URL',
  'ACCUSOURCE_API_KEY',
  'SOURCEDIRECT_API_KEY',
  'SOURCEDIRECT_CLIENT_ID',
  'ACCUSOURCE_CLIENT_ID',
  'SOURCEDIRECT_CLIENT_SECRET',
  'ACCUSOURCE_CLIENT_SECRET',
  'SOURCEDIRECT_TOKEN_URL',
  'ACCUSOURCE_TOKEN_URL',
  'ACCUSOURCE_WEBHOOK_SECRET',
  'SOURCEDIRECT_WEBHOOK_SECRET',
  'ACCUSOURCE_CREATE_PROFILE_PATH',
  'ACCUSOURCE_PRODUCTION_VALIDATION_HRX_ONLY',
  // Everee payroll integration — see HRX-Everee-Master-Plan.md and
  // functions/src/integrations/everee/. EVEREE_ENABLED is the master
  // switch read at module-load time by evereeGate.ts; without it the
  // gate substitutes stub callables that return failed-precondition.
  // EVEREE_API_TOKEN_<evereeTenantId> is the per-tenant API token
  // (one per Everee tenant the org is enrolled with). Today these are
  // read as plain process.env via evereeSecrets.ts; when Secret Manager
  // is wired (per the master plan §0.3) move these to defineSecret +
  // `firebase functions:secrets:set` and remove the matching entries
  // from this list (Firebase 400s if the same name is both env-var
  // and secret-mount; same gotcha as the EVERIFY_WS_* pattern above).
  'EVEREE_ENABLED',
  // Optional global base URL override (defaults to https://api.everee.com).
  // Everee uses a single host for both sandbox + prod; the per-tenant API
  // token enforces environment separation. Set in root .env only when you
  // need to point at a non-default host (staging mirror, dry-run sink, …).
  'EVEREE_BASE_URL',
  // Per-tenant Everee API tokens (read as plain process.env via evereeSecrets.ts).
  // Add EVEREE_API_TOKEN_<tid> whenever a new Everee tenant is onboarded.
  'EVEREE_API_TOKEN_2320',
  'EVEREE_API_TOKEN_3138',
  'EVEREE_API_TOKEN_3133',
  // Per-tenant webhook HMAC secrets — INTENTIONALLY OMITTED from PARAM_KEYS for tids 3133 + 3138.
  // These are bound via `defineSecret('EVEREE_WEBHOOK_SECRET_<tid>')` in
  // functions/src/integrations/everee/evereeWebhook.ts (WH.1). Cloud Run
  // 400s on deploy if the same name is both an env-var AND a secret mount
  // ("Secret environment variable overlaps non secret environment variable").
  // Same gotcha as the EVERIFY_WS_* pattern documented above.
  // Set them with: `firebase functions:secrets:set EVEREE_WEBHOOK_SECRET_<tid> --data-file=-`.
  // EVEREE_WEBHOOK_SECRET_2320 is still safe in PARAM_KEYS because tid 2320
  // does not yet have a defineSecret() binding in code — when it does, drop
  // it from this list and `firebase functions:secrets:set` it instead.
  'EVEREE_WEBHOOK_SECRET_2320',
  // Document AI — I-9 supporting extraction (see docs/I9_SUPPORTING_DOCUMENTS_ARCHITECTURE.md)
  'DOCUMENT_AI_PROJECT_ID',
  'DOCUMENT_AI_LOCATION',
  'DOCUMENT_AI_PROCESSOR_US_DRIVER_LICENSE',
  'DOCUMENT_AI_PROCESSOR_DL_CUSTOM',
  'DOCUMENT_AI_PROCESSOR_SSN_CARD',
  'DOCUMENT_AI_PROCESSOR_GREEN_CARD',
  'DOCUMENT_AI_PROCESSOR_EAD',
  'DOCUMENT_AI_PROCESSOR_PASSPORT',
  'DOCUMENT_AI_PROCESSOR_STATE_ID',
  'DOCUMENT_AI_PROCESSOR_BIRTH_CERTIFICATE',
];

function parseEnv(content) {
  const out = {};
  for (const line of (content || '').split('\n')) {
    // Support: KEY=value, export KEY=value, and REACT_APP_KEY=value
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1].trim()] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

function getValue(rootVars, paramKey) {
  if (rootVars[paramKey] != null && rootVars[paramKey] !== '') return rootVars[paramKey];
  const reactKey = 'REACT_APP_' + paramKey;
  if (rootVars[reactKey] != null && rootVars[reactKey] !== '') return rootVars[reactKey];
  return null;
}

function getFirebaseProjectIds() {
  const rcPath = path.join(FUNCTIONS_DIR, '..', '.firebaserc');
  if (!fs.existsSync(rcPath)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
    const ids = new Set();
    if (j.projects && typeof j.projects === 'object') {
      for (const v of Object.values(j.projects)) {
        if (typeof v === 'string' && v.trim()) ids.add(v.trim());
      }
    }
    return [...ids];
  } catch (_) {
    return [];
  }
}

/**
 * Upsert PARAM_KEYS present in envVars into an existing project-specific .env file.
 */
function mergeParamKeysIntoProjectEnvFile(targetPath, envVars) {
  const keysToWrite = PARAM_KEYS.filter((k) => envVars[k] != null && envVars[k] !== '');
  if (keysToWrite.length === 0 || !fs.existsSync(targetPath)) return 0;

  const content = fs.readFileSync(targetPath, 'utf8');
  const lines = content.split('\n');
  const keySet = new Set(keysToWrite);
  const updated = new Set();
  const out = [];

  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && keySet.has(m[1])) {
      out.push(`${m[1]}=${envVars[m[1]]}`);
      updated.add(m[1]);
    } else {
      out.push(line);
    }
  }
  for (const k of keysToWrite) {
    if (!updated.has(k)) out.push(`${k}=${envVars[k]}`);
  }

  fs.writeFileSync(targetPath, out.join('\n').replace(/\n*$/, '\n'), 'utf8');
  return keysToWrite.length;
}

// Build merged vars: root .env (and REACT_APP_* fallbacks) first, then firebase.json environmentVariables as fallback
const rootVars = fs.existsSync(ROOT_ENV)
  ? parseEnv(fs.readFileSync(ROOT_ENV, 'utf8'))
  : {};
let envVars = {};
for (const key of PARAM_KEYS) {
  const v = getValue(rootVars, key);
  if (v != null && v !== '') envVars[key] = v;
}
// Fallback: firebase.json functions[].environmentVariables (e.g. GNEWS_API_KEY, SERP_API_KEY, SMS_PROVIDER)
if (fs.existsSync(FIREBASE_JSON)) {
  try {
    const fb = JSON.parse(fs.readFileSync(FIREBASE_JSON, 'utf8'));
    const fns = Array.isArray(fb.functions) ? fb.functions[0] : fb.functions;
    const fbEnv = fns && fns.environmentVariables;
    if (fbEnv && typeof fbEnv === 'object') {
      for (const key of PARAM_KEYS) {
        if (!envVars[key] && fbEnv[key]) envVars[key] = fbEnv[key];
      }
    }
  } catch (_) {}
}

// Fallback: preserve existing functions/.env so we never wipe keys you set once (e.g. from a past deploy prompt).
// If root .env sets KEY= (empty), do not restore a stale value from functions/.env (e.g. rotating away sandbox tokens).
if (fs.existsSync(OUT_ENV)) {
  const existing = parseEnv(fs.readFileSync(OUT_ENV, 'utf8'));
  for (const key of PARAM_KEYS) {
    const explicitlyCleared =
      Object.prototype.hasOwnProperty.call(rootVars, key) && rootVars[key] === '';
    if (explicitlyCleared) continue;
    if (!envVars[key] && existing[key]) envVars[key] = existing[key];
  }
}

const lines = [
  '# Auto-generated by scripts/copyEnvFromRoot.js (predeploy): root .env + REACT_APP_* + firebase.json env',
  '',
];
let copied = Object.keys(envVars).length;
for (const key of PARAM_KEYS) {
  const value = envVars[key];
  if (value != null && value !== '') lines.push(`${key}=${value}`);
}
if (copied === 0) {
  console.warn('[copy-env] No params found in root .env (or REACT_APP_*), or firebase.json environmentVariables. Add keys to root .env to avoid deploy prompts.');
}
fs.writeFileSync(OUT_ENV, lines.join('\n') + '\n', 'utf8');
console.log('[copy-env] Wrote', copied, 'params to functions/.env');

for (const projectId of getFirebaseProjectIds()) {
  const projectEnvPath = path.join(FUNCTIONS_DIR, `.env.${projectId}`);
  const n = mergeParamKeysIntoProjectEnvFile(projectEnvPath, envVars);
  if (n > 0) {
    console.log('[copy-env] Merged', n, 'param keys into', path.basename(projectEnvPath), '(overrides base .env for Firebase deploy)');
  }
}
