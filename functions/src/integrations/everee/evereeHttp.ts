/**
 * Everee HTTP: request wrapper (HRX Everee Master Plan).
 * Stub: when token is placeholder, returns stub responses; no outbound calls.
 */

import { getEvereeHeaders } from './evereeAuth';
import type { EvereeEntityConfig } from './evereeConfig';

const STUB_TOKEN = 'stub-no-token-configured';

export async function evereeRequest<T>(
  config: EvereeEntityConfig,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const headers = await getEvereeHeaders(config);
  const auth = headers.authorization ?? '';
  const token = auth.replace(/^Basic\s+/i, '');
  const decoded = token ? Buffer.from(token, 'base64').toString('utf8') : '';
  if (decoded === STUB_TOKEN || !decoded) {
    return stubResponse(method, path) as T;
  }
  // Everee uses a single API host for both sandbox + prod (env separation
  // is enforced by the per-tenant API token, not the hostname). Keep the
  // entity-config override as the primary; fall back to the canonical host.
  const base = config.evereeApiBaseUrl ?? 'https://api.everee.com';
  const url = `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: { ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Everee API ${method} ${path}: ${res.status} ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function stubResponse(method: string, path: string): unknown {
  if (path.includes('ping') || path.endsWith('/tenants/me')) return { ok: true };
  if (
    method === 'POST' &&
    (path.includes('/embedded/workers/') ||
      path.includes('/onboarding/contractor') ||
      path.includes('/workers'))
  ) {
    return { workerId: 'stub-worker-id', id: 'stub-worker-id' };
  }
  if (path.includes('embed') && method === 'POST') return { url: 'https://stub.everee.com/embed' };
  return {};
}
