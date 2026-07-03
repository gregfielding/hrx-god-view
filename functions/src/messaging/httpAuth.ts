/**
 * Shared Bearer-token auth for the messaging HTTP (onRequest) endpoints.
 *
 * Mirrors `bulkSendApi.ts`'s local `verifyAuthAndTenant` contract: on
 * failure each helper writes the 401/403 JSON response itself and returns
 * null, so call sites can simply `if (!auth) return;`.
 *
 * Extracted 2026-07-03 while closing the unauthenticated `sendMessageApi` /
 * `testRenderApi` / automations endpoints — all were deployed with
 * `invoker: 'public'` (or default) and only a `// TODO: Add authentication`
 * comment, meaning any internet caller could send real SMS through the
 * routing orchestrator on the company toll-free number (cost + carrier-
 * reputation exposure). Found during the 2026-07 Twilio billing-spike audit.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import { workerHasTenantAssociation } from '../onboarding/onCallOnboardingGuards';

if (!admin.apps.length) {
  admin.initializeApp();
}

export interface VerifiedHttpAuth {
  uid: string;
  /** Raw decoded ID-token claims (hrx, roles, etc.). */
  claims: Record<string, unknown>;
}

/**
 * Require a valid Firebase ID token in the Authorization header.
 * 401s and returns null when missing/invalid.
 */
export async function verifyRequestAuth(
  request: { headers: Record<string, unknown> },
  response: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<VerifiedHttpAuth | null> {
  const authHeader = String((request.headers as Record<string, unknown>).authorization ?? '');
  if (!authHeader.startsWith('Bearer ')) {
    response.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
    return null;
  }
  try {
    const token = authHeader.replace('Bearer ', '').trim();
    const decoded = await admin.auth().verifyIdToken(token);
    return { uid: decoded.uid, claims: decoded as unknown as Record<string, unknown> };
  } catch (err: unknown) {
    logger.warn('[httpAuth] token verification failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    response.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid token' },
    });
    return null;
  }
}

/**
 * Require a valid ID token AND membership in the given tenant (JWT roles
 * map, `hrx: true`, or a `users/{uid}` Firestore tenant link — same
 * three-way check `bulkSendApi.ts` uses, since staff JWTs don't always
 * carry the roles map). 401/403s and returns null on failure.
 */
export async function verifyRequestAuthAndTenant(
  request: { headers: Record<string, unknown> },
  response: { status: (code: number) => { json: (body: unknown) => void } },
  tenantId: string,
): Promise<VerifiedHttpAuth | null> {
  const auth = await verifyRequestAuth(request, response);
  if (!auth) return null;

  const roles = (auth.claims.roles ?? {}) as Record<string, unknown>;
  const hasJwtTenantRole = Boolean(roles[tenantId]);
  const isHrx = auth.claims.hrx === true;

  if (!hasJwtTenantRole && !isHrx) {
    const userDoc = await admin.firestore().collection('users').doc(auth.uid).get();
    if (!workerHasTenantAssociation(userDoc.data(), tenantId)) {
      response.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Not a member of this tenant' },
      });
      return null;
    }
  }
  return auth;
}

/**
 * Require a valid ID token with the `hrx: true` platform-admin claim.
 * Used by the internal automation endpoints, which have no legitimate
 * client callers today — anything hitting them should be an HRX operator.
 */
export async function verifyRequestAuthHrx(
  request: { headers: Record<string, unknown> },
  response: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<VerifiedHttpAuth | null> {
  const auth = await verifyRequestAuth(request, response);
  if (!auth) return null;
  if (auth.claims.hrx !== true) {
    response.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'HRX admin access required' },
    });
    return null;
  }
  return auth;
}
