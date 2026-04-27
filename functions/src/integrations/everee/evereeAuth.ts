/**
 * Everee auth: build headers (authorization: basic, x-everee-tenant-id).
 * HRX Everee Master Plan §0.3. Tokens must be server-only (Secret Manager).
 * Stub: uses placeholder until EVEREE_API_TOKEN_* secrets are set.
 */

import { getSecret } from './evereeSecrets';
import type { EvereeEntityConfig } from './evereeConfig';

export async function getEvereeHeaders(config: EvereeEntityConfig): Promise<Record<string, string>> {
  const token = await getEvereeApiToken(config.evereeTenantId);
  const encoded = Buffer.from(token, 'utf8').toString('base64');
  return {
    authorization: `Basic ${encoded}`,
    'x-everee-tenant-id': config.evereeTenantId,
    'content-type': 'application/json',
  };
}

async function getEvereeApiToken(evereeTenantId: string): Promise<string> {
  const secret = await getSecret(`EVEREE_API_TOKEN_${evereeTenantId}`);
  if (secret) return secret;
  return 'stub-no-token-configured';
}
