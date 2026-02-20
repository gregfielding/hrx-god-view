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
  const base = config.evereeApiBaseUrl ?? 'https://api.sandbox.everee.com';
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
  if (path.includes('ping') || path === '/v2/tenants/me') return { ok: true };
  if (path.includes('workers') && method === 'POST') return { id: 'stub-worker-id' };
  if (path.includes('embed') && method === 'POST') return { url: 'https://stub.everee.com/embed' };
  return {};
}
