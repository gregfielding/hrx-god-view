/**
 * Portal credentials for the bot accounts. Resolution order:
 *   1. env  — INDEED_FLEX_BOT_USERNAME / INDEED_FLEX_BOT_PASSWORD,
 *             FIELDGLASS_BOT_USERNAME / FIELDGLASS_BOT_PASSWORD
 *   2. Secret Manager — `${secretPrefix}-${provider}-username|password`
 *             (e.g. portal-worker-indeed_flex-password) in the project.
 * Missing credentials are NOT an error here: the worker reports the session
 * as login_required and escalates the action to needs_human instead.
 * Values are registered with the logger's redaction list and never logged.
 */
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import type { PortalProvider } from '../../shared/portalActions.ts';
import type { WorkerConfig } from './config.ts';
import { log, redact } from './logger.ts';

export interface PortalCredentials {
  username: string;
  password: string;
  source: 'env' | 'secret-manager';
}

const cache = new Map<PortalProvider, PortalCredentials | null>();
let client: SecretManagerServiceClient | null = null;

const ENV_PREFIX: Record<PortalProvider, string> = {
  indeed_flex: 'INDEED_FLEX_BOT',
  fieldglass: 'FIELDGLASS_BOT',
};

async function readSecret(projectId: string, name: string): Promise<string | null> {
  try {
    client ??= new SecretManagerServiceClient();
    const [version] = await client.accessSecretVersion({
      name: `projects/${projectId}/secrets/${name}/versions/latest`,
    });
    const data = version.payload?.data;
    if (!data) return null;
    return Buffer.from(data as Uint8Array).toString('utf8').trim() || null;
  } catch (err) {
    const code = (err as { code?: number }).code;
    // 5 = NOT_FOUND, 7 = PERMISSION_DENIED — both mean "not provisioned for this box".
    if (code === 5 || code === 7) return null;
    log.warn('secret manager read failed', { name, err });
    return null;
  }
}

export async function getPortalCredentials(
  config: WorkerConfig,
  provider: PortalProvider,
): Promise<PortalCredentials | null> {
  if (cache.has(provider)) return cache.get(provider) ?? null;

  const prefix = ENV_PREFIX[provider];
  let username = process.env[`${prefix}_USERNAME`] || null;
  let password = process.env[`${prefix}_PASSWORD`] || null;
  let source: PortalCredentials['source'] = 'env';

  if (!username || !password) {
    source = 'secret-manager';
    const base = `${config.secretPrefix}-${provider}`;
    [username, password] = await Promise.all([
      readSecret(config.projectId, `${base}-username`),
      readSecret(config.projectId, `${base}-password`),
    ]);
  }

  let creds: PortalCredentials | null = null;
  if (username && password) {
    redact(password);
    creds = { username, password, source };
    log.info('portal credentials loaded', { provider, source, username: maskUsername(username) });
  } else {
    log.warn('no portal credentials available — logins will escalate to needs_human', { provider });
  }
  cache.set(provider, creds);
  return creds;
}

/**
 * Shared courier keys for HRX's extension endpoints (the same values as
 * FIELDGLASS_EXTENSION_KEY / INDEED_FLEX_EXTENSION_KEY in functions env).
 * env first, then Secret Manager `${secretPrefix}-<provider>-extension-key`.
 */
const keyCache = new Map<PortalProvider, string | null>();
const KEY_ENV: Record<PortalProvider, string> = {
  indeed_flex: 'INDEED_FLEX_EXTENSION_KEY',
  fieldglass: 'FIELDGLASS_EXTENSION_KEY',
};

export async function getExtensionKey(config: WorkerConfig, provider: PortalProvider): Promise<string | null> {
  if (keyCache.has(provider)) return keyCache.get(provider) ?? null;
  let key = process.env[KEY_ENV[provider]] || null;
  if (!key) key = await readSecret(config.projectId, `${config.secretPrefix}-${provider}-extension-key`);
  if (key) redact(key);
  else log.warn('no HRX extension key available — sync actions will escalate', { provider, env: KEY_ENV[provider] });
  keyCache.set(provider, key);
  return key;
}

/** Drop the cache so a rotated secret is picked up on the next login attempt. */
export function forgetPortalCredentials(provider?: PortalProvider): void {
  if (provider) cache.delete(provider);
  else cache.clear();
}

function maskUsername(u: string): string {
  if (u.length <= 4) return '****';
  return `${u.slice(0, 2)}***${u.slice(-2)}`;
}
