/**
 * Everee secrets (Secret Manager). Stub: reads process.env until EVEREE_API_TOKEN / EVEREE_API_TOKEN_<evereeTenantId> are set.
 */

export async function getSecret(name: string): Promise<string | undefined> {
  return process.env[name];
}
