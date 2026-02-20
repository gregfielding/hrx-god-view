/**
 * E-Verify ICA v31 auth: username/password login + refresh.
 * Tokens expire after 2 hours; refresh early.
 * ICA v31 Refactor Pack §4.2
 */

import { httpJson } from './everifyHttp';
import { getEverifyBaseUrl } from './everifyConfig';
import { logger } from 'firebase-functions/v2';

export interface EverifyCredentials {
  username: string;
  password: string;
}

type AuthResponse = {
  access_token?: string;
  user_info?: unknown;
};

let cachedToken: { token: string; expiresAtMs: number } | null = null;

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const REFRESH_EARLY_MS = 90 * 60 * 1000;

/**
 * Get a valid bearer token. Uses cache; refreshes or re-login as needed.
 * Logs only success/failure (no credentials).
 */
export async function getAccessToken(creds: EverifyCredentials): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < cachedToken.expiresAtMs - REFRESH_EARLY_MS) {
    return cachedToken.token;
  }

  if (cachedToken) {
    const refreshed = await tryRefresh(cachedToken.token);
    if (refreshed) return refreshed;
  }

  const token = await login(creds);
  return token;
}

async function login(creds: EverifyCredentials): Promise<string> {
  const baseUrl = getEverifyBaseUrl().replace(/\/$/, '');
  const url = `${baseUrl}/authentication/login`;
  const body = { username: creds.username, password: creds.password };

  try {
    const resp = await httpJson<AuthResponse>({
      method: 'POST',
      url,
      body,
      timeoutMs: 15000,
      retries: 1,
    });

    if (!resp?.access_token) throw new Error('E-Verify login: missing access_token');

    cachedToken = {
      token: resp.access_token,
      expiresAtMs: Date.now() + TWO_HOURS_MS,
    };

    logger.info('E-Verify auth: login succeeded');
    return resp.access_token;
  } catch (e: unknown) {
    logger.warn('E-Verify auth: login failed', {
      message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

async function tryRefresh(existingToken: string): Promise<string | null> {
  const baseUrl = getEverifyBaseUrl().replace(/\/$/, '');
  const url = `${baseUrl}/authentication/refresh`;

  try {
    const resp = await httpJson<AuthResponse>({
      method: 'POST',
      url,
      headers: { Authorization: `Bearer ${existingToken}` },
      timeoutMs: 15000,
      retries: 0,
    });

    if (!resp?.access_token) return null;

    cachedToken = {
      token: resp.access_token,
      expiresAtMs: Date.now() + TWO_HOURS_MS,
    };

    logger.info('E-Verify auth: refresh succeeded');
    return resp.access_token;
  } catch {
    cachedToken = null;
    return null;
  }
}
