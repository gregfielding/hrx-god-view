/**
 * Everee callable Cloud Functions (HRX Everee Master Plan §4).
 * Stub implementations; real logic in evereeService.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  createWorkerIfNeeded,
  createOnboardingSession,
  getPayHistory,
  getPayStatement,
  pushShift,
  preparePayout,
  ping,
} from './evereeService';
import { requireEvereeEnabledEntity } from './evereeConfig';

function requireAuth(request: { auth?: { uid: string; token?: Record<string, unknown> } | null }) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }
  return request.auth;
}

function requireTenantEntity(data: unknown): { tenantId: string; entityId: string } {
  const d = data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  if (!tenantId || !entityId) {
    throw new HttpsError('invalid-argument', 'tenantId and entityId required');
  }
  return { tenantId, entityId };
}

function canManageEveree(auth: { token?: { roles?: Record<string, { role?: string }>; hrx?: boolean } } | null | undefined, tenantId: string): boolean {
  if (!auth?.token) return false;
  const roles = auth.token.roles ?? {};
  const tenantRole = roles[tenantId]?.role;
  if (tenantRole && ['Recruiter', 'Manager', 'Admin'].includes(String(tenantRole))) return true;
  if (auth.token.hrx === true) return true;
  return false;
}

/**
 * Worker-facing embed callables allow **self-service** — a worker must be able
 * to ensure their own Everee record + open their own onboarding session from
 * the app. Recruiters retain full access via `canManageEveree`.
 *
 * Returns true when (a) the caller has recruiter/admin rights, or (b) the
 * callable's target `userId` matches the auth'd uid.
 */
function canSelfOrManageEveree(
  auth: { uid: string; token?: { roles?: Record<string, { role?: string }>; hrx?: boolean } } | null | undefined,
  tenantId: string,
  targetUserId: string,
): boolean {
  if (!auth?.uid) return false;
  if (targetUserId && auth.uid === targetUserId) return true;
  return canManageEveree(auth as any, tenantId);
}

export const evereePing = onCall(async (request) => {
  requireAuth(request);
  const { tenantId, entityId } = requireTenantEntity(request.data);
  if (!canManageEveree(request.auth as any, tenantId)) {
    throw new HttpsError('permission-denied', 'Not allowed to manage Everee for this tenant');
  }
  await requireEvereeEnabledEntity(tenantId, entityId);
  return ping(tenantId, entityId);
});

export const evereeEnsureWorker = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const userId = typeof d?.userId === 'string' ? d.userId : '';
  if (!tenantId || !entityId || !userId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId, userId required');
  }
  if (!canSelfOrManageEveree(request.auth as any, tenantId, userId)) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }
  await requireEvereeEnabledEntity(tenantId, entityId);
  // `firebaseUid` is forwarded to Everee as the partner-side external id (custom
  // field). Use the *worker's* uid (== user doc id), not the caller's, so a
  // recruiter-initiated sync still tags the worker correctly in Everee.
  return createWorkerIfNeeded({
    tenantId,
    entityId,
    userId,
    firebaseUid: userId,
    workerType: (d?.workerType as 'employee' | 'contractor') || 'employee',
    email: typeof d?.email === 'string' ? d.email : undefined,
    firstName: typeof d?.firstName === 'string' ? d.firstName : undefined,
    lastName: typeof d?.lastName === 'string' ? d.lastName : undefined,
    phone: typeof d?.phone === 'string' ? d.phone : undefined,
  });
});

export const evereeCreateOnboardingSession = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const userId = typeof d?.userId === 'string' ? d.userId : '';
  const evereeWorkerId = typeof d?.evereeWorkerId === 'string' ? d.evereeWorkerId : '';
  if (!tenantId || !entityId || !userId || !evereeWorkerId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId, userId, evereeWorkerId required');
  }
  if (!canSelfOrManageEveree(request.auth as any, tenantId, userId)) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }
  await requireEvereeEnabledEntity(tenantId, entityId);
  return createOnboardingSession({
    tenantId,
    entityId,
    userId,
    evereeWorkerId,
    returnUrl: typeof d?.returnUrl === 'string' ? d.returnUrl : undefined,
  });
});

export const evereeGetPayHistory = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const userId = typeof d?.userId === 'string' ? d.userId : request.auth?.uid ?? '';
  if (!tenantId || !entityId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId required');
  }
  if (!canSelfOrManageEveree(request.auth as any, tenantId, userId)) {
    throw new HttpsError('permission-denied', 'Not allowed to view pay history for this user');
  }
  await requireEvereeEnabledEntity(tenantId, entityId);
  return getPayHistory(tenantId, entityId, userId);
});

export const evereeGetPayStatement = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const userId = typeof d?.userId === 'string' ? d.userId : request.auth?.uid ?? '';
  const statementId = typeof d?.statementId === 'string' ? d.statementId : '';
  if (!tenantId || !entityId || !statementId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId, statementId required');
  }
  if (!canSelfOrManageEveree(request.auth as any, tenantId, userId)) {
    throw new HttpsError('permission-denied', 'Not allowed to view pay statement for this user');
  }
  await requireEvereeEnabledEntity(tenantId, entityId);
  const out = await getPayStatement(tenantId, entityId, userId, statementId);
  return out ?? null;
});

export const evereeAdminPushShift = onCall(async (request) => {
  requireAuth(request);
  const { tenantId, entityId } = requireTenantEntity(request.data);
  if (!canManageEveree(request.auth as any, tenantId)) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }
  await requireEvereeEnabledEntity(tenantId, entityId);
  const payload = (request.data as Record<string, unknown>) ?? {};
  return pushShift(tenantId, entityId, payload as Parameters<typeof pushShift>[2]);
});

export const evereeAdminPreparePayout = onCall(async (request) => {
  requireAuth(request);
  const { tenantId, entityId } = requireTenantEntity(request.data);
  if (!canManageEveree(request.auth as any, tenantId)) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }
  await requireEvereeEnabledEntity(tenantId, entityId);
  const payload = (request.data as Record<string, unknown>) ?? {};
  return preparePayout(tenantId, entityId, payload as Parameters<typeof preparePayout>[2]);
});

/**
 * TEMP — sandbox API contract validation callable.
 *
 * Bypasses `requireEvereeEnabledEntity` so a recruiter can fire `POST
 * /v2/workers` against the Everee sandbox without first wiring any entity
 * doc. Hardcodes Everee tenant 2320 (sandbox) + the synthetic entity id
 * `_temp_sandbox` for the linkage doc id; the user-record map write
 * (`users/{uid}.evereeWorkerIds["2320"]`) is the canonical signal that the
 * round-trip succeeded.
 *
 * Remove together with `TempEvereeSyncButton.tsx` and the `_overrideConfig`
 * branch in `createWorkerIfNeeded` once the API contract is verified and
 * `EvereeAdminSyncCard` (per-entity, properly gated) is the only entry point.
 */
const TEMP_SANDBOX_EVEREE_TENANT_ID = '2320';
const TEMP_SANDBOX_ENTITY_ID = '_temp_sandbox';

export const evereeTempSandboxSync = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const userId = typeof d?.userId === 'string' ? d.userId : '';
  if (!tenantId || !userId) {
    throw new HttpsError('invalid-argument', 'tenantId and userId required');
  }
  if (!canManageEveree(request.auth as any, tenantId)) {
    throw new HttpsError('permission-denied', 'Not allowed (recruiter/admin/hrx required)');
  }
  if (process.env.EVEREE_ENABLED !== 'true') {
    throw new HttpsError(
      'failed-precondition',
      'Everee is disabled at the process level (EVEREE_ENABLED !== "true").',
    );
  }
  return createWorkerIfNeeded({
    tenantId,
    entityId: TEMP_SANDBOX_ENTITY_ID,
    userId,
    firebaseUid: userId,
    workerType: (d?.workerType as 'employee' | 'contractor') || 'employee',
    email: typeof d?.email === 'string' ? d.email : undefined,
    firstName: typeof d?.firstName === 'string' ? d.firstName : undefined,
    lastName: typeof d?.lastName === 'string' ? d.lastName : undefined,
    phone: typeof d?.phone === 'string' ? d.phone : undefined,
    _overrideConfig: {
      evereeTenantId: TEMP_SANDBOX_EVEREE_TENANT_ID,
      evereeEnvironment: 'sandbox',
      // Everee uses a single host for both envs — the per-tenant token
      // (EVEREE_API_TOKEN_2320 here) enforces sandbox vs prod separation.
      evereeApiBaseUrl: process.env.EVEREE_BASE_URL || 'https://api.everee.com',
      evereeEnabled: true,
    },
  });
});
