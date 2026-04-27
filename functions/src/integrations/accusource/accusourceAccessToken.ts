/**
 * SourceDirect OAuth 2.0 client_credentials — tokens expire ~30m per vendor docs; cache + refresh.
 * If client id/secret are not set, falls back to static ACCUSOURCE_API_KEY / SOURCEDIRECT_API_KEY (legacy).
 */
import { defineString } from 'firebase-functions/params';
import { getAccusourceConfig } from './config';
import { accusourceLog } from './accusourceLogger';
import type { AccusourceEnvironment } from './types';

const P_CLIENT_ID = defineString('SOURCEDIRECT_CLIENT_ID', { default: '' });
const P_CLIENT_SECRET = defineString('SOURCEDIRECT_CLIENT_SECRET', { default: '' });
const P_TOKEN_URL = defineString('SOURCEDIRECT_TOKEN_URL', { default: '' });

function trim(v: string | undefined): string {
  return (v ?? '').trim();
}

type TokenCache = { token: string; expiresAtMs: number };
let cache: TokenCache | null = null;

/** Refresh this many seconds before expiry to avoid edge 401s */
const REFRESH_BUFFER_SEC = 90;

function resolveClientId(): string {
  return (
    trim(P_CLIENT_ID.value()) ||
    trim(process.env.SOURCEDIRECT_CLIENT_ID) ||
    trim(process.env.ACCUSOURCE_CLIENT_ID)
  );
}

function resolveClientSecret(): string {
  return (
    trim(P_CLIENT_SECRET.value()) ||
    trim(process.env.SOURCEDIRECT_CLIENT_SECRET) ||
    trim(process.env.ACCUSOURCE_CLIENT_SECRET)
  );
}

/** Vendor Postman + live API use `/oauth/access_token` (not `/oauth/token` — that path returns 404 on sdapi). */
function defaultTokenUrl(environment: AccusourceEnvironment): string {
  return environment === 'production'
    ? 'https://sdapi.accusourcedirect.com/oauth/access_token'
    : 'https://sdapi-sandbox.accusourcedirect.construction/oauth/access_token';
}

/** E-Verify OAuth uses uscis.gov; SourceDirect uses accusourcedirect — never point SOURCEDIRECT_TOKEN_URL at E-Verify. */
function isEverifyUsCisUrl(url: string): boolean {
  return url.toLowerCase().includes('uscis.gov');
}

function resolveTokenUrl(environment: AccusourceEnvironment): string {
  const o =
    trim(P_TOKEN_URL.value()) ||
    trim(process.env.SOURCEDIRECT_TOKEN_URL) ||
    trim(process.env.ACCUSOURCE_TOKEN_URL);
  if (o) {
    if (isEverifyUsCisUrl(o)) {
      throw new Error(
        'SOURCEDIRECT_TOKEN_URL points to E-Verify (uscis.gov), not AccuSource/SourceDirect. Remove SOURCEDIRECT_TOKEN_URL / ACCUSOURCE_TOKEN_URL from env, or set it to SourceDirect only: sandbox https://sdapi-sandbox.accusourcedirect.construction/oauth/access_token — production https://sdapi.accusourcedirect.com/oauth/access_token. E-Verify OAuth belongs in EVERIFY_AUTH_URL only.',
      );
    }
    return o;
  }
  return defaultTokenUrl(environment);
}

/**
 * Bearer token for SourceDirect API calls. Prefers OAuth client_credentials when id+secret exist.
 */
export async function getAccusourceBearerToken(): Promise<string | undefined> {
  const cfg = getAccusourceConfig();
  const clientId = resolveClientId();
  const clientSecret = resolveClientSecret();

  if (!clientId || !clientSecret) {
    return cfg.apiKey;
  }

  const now = Date.now();
  if (cache && cache.expiresAtMs > now + REFRESH_BUFFER_SEC * 1000) {
    return cache.token;
  }

  const tokenUrl = resolveTokenUrl(cfg.environment);
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    accusourceLog('error', 'oauth', 'SourceDirect OAuth token request failed', {
      status: res.status,
      tokenUrlHost: (() => {
        try {
          return new URL(tokenUrl).host;
        } catch {
          return 'invalid-token-url';
        }
      })(),
      bodySnippet: text.slice(0, 300),
    });
    throw new Error(
      `SourceDirect OAuth token request failed (${res.status}): ${text}. Check SOURCEDIRECT_CLIENT_ID/SECRET, ACCUSOURCE_ENVIRONMENT, and SOURCEDIRECT_TOKEN_URL if your tenant uses a non-default token endpoint.`
    );
  }

  let json: { access_token?: string; expires_in?: number };
  try {
    json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  } catch {
    throw new Error(`SourceDirect OAuth: expected JSON, got: ${text.slice(0, 200)}`);
  }

  const accessToken = json.access_token;
  if (!accessToken) {
    throw new Error(`SourceDirect OAuth: missing access_token in response: ${text.slice(0, 300)}`);
  }

  const expiresInSec = typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : 1700;
  cache = {
    token: accessToken,
    expiresAtMs: now + Math.max(60, expiresInSec - REFRESH_BUFFER_SEC) * 1000,
  };

  return accessToken;
}

/** True if we can obtain a Bearer token (OAuth client_credentials or static API key). */
export function hasAccusourceOutboundAuth(): boolean {
  const cfg = getAccusourceConfig();
  if (cfg.apiKey) return true;
  const clientId = resolveClientId();
  const clientSecret = resolveClientSecret();
  return Boolean(clientId && clientSecret);
}
