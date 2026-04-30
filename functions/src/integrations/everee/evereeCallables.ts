/**
 * Everee callable Cloud Functions (HRX Everee Master Plan §4).
 * Stub implementations; real logic in evereeService.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import {
  createWorkerIfNeeded,
  createOnboardingSession,
  getPayHistory,
  getPayStatement,
  pushShift,
  preparePayout,
  ping,
  type EvereeEmbedExperienceType,
} from './evereeService';

const ALLOWED_EMBED_EXPERIENCE_TYPES = new Set<EvereeEmbedExperienceType>([
  'ONBOARDING',
  'WORKER_HOME',
  'PAYMENT_HISTORY',
  'TAX_DOCUMENTS',
  'PAYMENT_DEPOSIT',
  'HOME_ADDRESS',
]);

function coerceEmbedExperienceType(value: unknown): EvereeEmbedExperienceType | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return undefined;
  if (ALLOWED_EMBED_EXPERIENCE_TYPES.has(trimmed as EvereeEmbedExperienceType)) {
    return trimmed as EvereeEmbedExperienceType;
  }
  throw new HttpsError('invalid-argument', `Unsupported experienceType: ${value}`);
}

function coerceEmbedExperienceVersion(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // Everee versions are short (e.g., V1_0, V2_0); reject anything obviously wrong.
  if (!/^V\d+(_\d+)?$/i.test(trimmed)) {
    throw new HttpsError('invalid-argument', `Unsupported experienceVersion: ${value}`);
  }
  return trimmed.toUpperCase();
}
import { requireEvereeEnabledEntity } from './evereeConfig';
import { evereeRequest } from './evereeHttp';
import * as admin from 'firebase-admin';

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
  const approvalGroupRaw = d?.approvalGroupId;
  const approvalGroupId =
    typeof approvalGroupRaw === 'number' && Number.isFinite(approvalGroupRaw)
      ? approvalGroupRaw
      : typeof approvalGroupRaw === 'string' && /^\d+$/.test(approvalGroupRaw.trim())
        ? parseInt(approvalGroupRaw.trim(), 10)
        : undefined;

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
    ...(approvalGroupId !== undefined ? { approvalGroupId } : {}),
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
  const experienceType = coerceEmbedExperienceType(d?.experienceType);
  const experienceVersion = coerceEmbedExperienceVersion(d?.experienceVersion);
  try {
    const session = await createOnboardingSession({
      tenantId,
      entityId,
      userId,
      evereeWorkerId,
      returnUrl: typeof d?.returnUrl === 'string' ? d.returnUrl : undefined,
      ...(experienceType ? { experienceType } : {}),
      ...(experienceVersion ? { experienceVersion } : {}),
    });
    return {
      ...session,
      embedUrl: session.url,
      expiresAt: new Date(Date.now() + session.expiresInMs).toISOString(),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[evereeCreateOnboardingSession] failed', {
      tenantId,
      entityId,
      userId,
      message: msg,
    });
    const safe =
      msg.length > 480 ? `${msg.slice(0, 480)}…` : msg || 'Could not create Everee embed session';
    throw new HttpsError('failed-precondition', safe);
  }
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
 * Admin-only "fetch the worker straight from Everee" debug helper. Wraps
 * `GET /api/v2/workers/<id>` and returns the raw response so the operator can
 * eyeball address / direct deposit / W-4 / tax data that lives only in Everee
 * (we never persist that PII in Firestore by design).
 *
 * Failure modes are surfaced verbatim — Everee endpoint 404s ("path not
 * found") look the same as auth errors otherwise, so we let the underlying
 * `Error` message bubble through `failed-precondition` to make it obvious
 * when we need to point at `/api/v2/embedded/workers/{id}` instead.
 */
/**
 * Worker-callable: ask Everee whether onboarding is finished for the worker
 * tied to the given Everee tenant. Used by `/c1/workers/payroll/{tid}` as a
 * server-side preflight so we can request the right Embed Component
 * (`ONBOARDING` vs `WORKER_HOME`) without depending on signals that often
 * aren't available — webhooks may be queued behind a signature rotation, and
 * Everee's iframe posts EMB-201 over `host MessagePort` / `webkit.messageHandlers`,
 * neither of which exists in a browser tab.
 *
 * Returns ONLY status flags, never PII. The full record is exposed via
 * `evereeAdminGetWorker` for admin debugging.
 *
 * On positive detection we mirror `status: 'onboarding_complete'` onto
 * `tenants/{tid}/everee_workers/{entityId__userId}` (UX-only field) so the
 * next page load can short-circuit without re-hitting Everee.
 */
export const evereeGetMyOnboardingStatus = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const evereeWorkerId = typeof d?.evereeWorkerId === 'string' ? d.evereeWorkerId : '';
  const targetUserId = typeof d?.userId === 'string' ? d.userId : request.auth?.uid ?? '';
  if (!tenantId || !entityId || !evereeWorkerId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId, evereeWorkerId required');
  }
  if (!canSelfOrManageEveree(request.auth as any, tenantId, targetUserId)) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }
  const config = await requireEvereeEnabledEntity(tenantId, entityId);

  let raw: Record<string, unknown> = {};
  try {
    raw = (await evereeRequest<Record<string, unknown>>(
      config,
      'GET',
      `/api/v2/workers/${encodeURIComponent(evereeWorkerId)}`,
    )) ?? {};
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn('[evereeGetMyOnboardingStatus] api_call_failed', {
      tenantId,
      entityId,
      evereeWorkerId,
      message: msg,
    });
    // Soft-fail: caller treats `null` as "couldn't determine" and falls back
    // to its existing client-side detection. We don't surface PII or expose
    // raw API errors to the worker UI.
    return {
      ok: false as const,
      onboardingComplete: null as boolean | null,
      accountClaimed: null as boolean | null,
      reason: 'everee_api_call_failed' as const,
    };
  }

  const onboardingComplete = isEvereeOnboardingComplete(raw);
  const accountClaimed = pickBoolean(raw, [
    'accountClaimed',
    'isAccountClaimed',
    ['account', 'claimed'],
    ['onboarding', 'accountClaimed'],
  ]);

  if (onboardingComplete) {
    try {
      const linkRef = admin
        .firestore()
        .doc(`tenants/${tenantId}/everee_workers/${entityId}__${targetUserId}`);
      await linkRef.set(
        {
          status: 'onboarding_complete',
          // Distinct timestamp from `onboardingCompletedAt` (webhook-set) so we
          // can tell mirrored-from-API vs canonical webhook events apart.
          apiObservedOnboardingCompleteAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (e: unknown) {
      logger.warn('[evereeGetMyOnboardingStatus] mirror_write_failed', {
        tenantId,
        entityId,
        evereeWorkerId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
    // Flip the entity_employments lifecycle so the Work Readiness chip turns
    // green for this entity (idempotent; never reverses terminal statuses).
    await mirrorEvereeOnboardingCompleteToEmployments({
      tenantId,
      entityId,
      userId: targetUserId,
    });
  }

  return {
    ok: true as const,
    onboardingComplete,
    accountClaimed,
  };
});

/**
 * Best-effort detection of "is this Everee worker done with onboarding?" given
 * the raw `GET /api/v2/workers/{id}` response. Everee's published worker schema
 * has shifted shape across pilot revisions, so we check several common paths.
 */
function isEvereeOnboardingComplete(raw: Record<string, unknown>): boolean {
  if (pickBoolean(raw, [
    'onboardingComplete',
    'isOnboarded',
    'hasCompletedOnboarding',
    ['onboarding', 'complete'],
    ['onboarding', 'isComplete'],
  ])) {
    return true;
  }
  // String status fields — accept any "done"-ish synonym.
  const statusCandidates: unknown[] = [
    raw.onboardingStatus,
    raw.workerStatus,
    raw.status,
    (raw.onboarding as Record<string, unknown> | undefined)?.status,
    (raw.account as Record<string, unknown> | undefined)?.status,
  ];
  for (const c of statusCandidates) {
    if (typeof c !== 'string') continue;
    const s = c.trim().toUpperCase();
    if (
      s === 'COMPLETE' ||
      s === 'COMPLETED' ||
      s === 'DONE' ||
      s === 'ACTIVE' ||
      s === 'ONBOARDING_COMPLETE'
    ) {
      return true;
    }
  }
  return false;
}

function pickBoolean(
  obj: Record<string, unknown>,
  paths: Array<string | string[]>,
): boolean | null {
  for (const p of paths) {
    const segments = Array.isArray(p) ? p : [p];
    let cur: unknown = obj;
    for (const seg of segments) {
      if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[seg];
      } else {
        cur = undefined;
        break;
      }
    }
    if (typeof cur === 'boolean') return cur;
  }
  return null;
}

/**
 * Idempotently mirror Everee's "onboarding complete" signal to
 * `tenants/{tenantId}/entity_employments` (and the related `user_employments`
 * rows). This is what flips the Work Readiness chip for this entity from
 * `Onboarding` (yellow) to `Active` (green) in recruiter tables and the
 * record header.
 *
 * Driven from `evereeGetMyOnboardingStatus` (worker self-fetch) and
 * `evereeAdminGetWorker` (recruiter Everee data card load) so the chip stays
 * in sync regardless of which surface observes the completion first — this
 * is the same end-state the `worker.onboarding-completed` webhook would
 * reach, but Everee's webhook delivery is occasionally delayed in pilot, so
 * we never want the UI to lag the live API.
 *
 * Strong terminal statuses (`terminated`, `inactive`, `blocked`) are
 * preserved — completion never resurrects a closed employment.
 */
async function mirrorEvereeOnboardingCompleteToEmployments(args: {
  tenantId: string;
  entityId: string;
  userId: string;
}): Promise<void> {
  const { tenantId, entityId, userId } = args;
  if (!tenantId || !entityId || !userId) return;

  const db = admin.firestore();
  const STRONG = new Set(['terminated', 'inactive', 'blocked']);
  const now = admin.firestore.FieldValue.serverTimestamp();

  try {
    const entityEmpQuery = await db
      .collection(`tenants/${tenantId}/entity_employments`)
      .where('userId', '==', userId)
      .where('entityId', '==', entityId)
      .limit(2)
      .get();

    for (const docSnap of entityEmpQuery.docs) {
      const data = docSnap.data() as Record<string, unknown>;
      const statusNow = String(data.status || '').trim().toLowerCase();
      // Skip mirror writes for strong/terminal lifecycle states — Everee
      // completion can race a recruiter-driven termination; the stronger
      // signal wins.
      if (STRONG.has(statusNow)) continue;

      const alreadyComplete =
        data.onboardingComplete === true && data.active === true && statusNow === 'active';
      const fragment: Record<string, unknown> = {
        evereeOnboardingStatus: 'complete',
        payrollOnboardingCompletedAt: data.payrollOnboardingCompletedAt ?? now,
        updatedAt: now,
      };
      if (!alreadyComplete) {
        fragment.onboardingComplete = true;
        fragment.active = true;
        fragment.status = 'active';
        fragment.employmentState = 'active';
        if (data.onboardingCompletedAt == null) fragment.onboardingCompletedAt = now;
        if (data.hiredAt == null) fragment.hiredAt = now;
      }
      await docSnap.ref.set(fragment, { merge: true });
    }
  } catch (e: unknown) {
    logger.warn('[mirrorEvereeOnboardingCompleteToEmployments] entity_employments_mirror_failed', {
      tenantId,
      entityId,
      userId,
      message: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    const userEmpQuery = await db
      .collection(`tenants/${tenantId}/user_employments`)
      .where('userId', '==', userId)
      .where('entityId', '==', entityId)
      .limit(10)
      .get();
    for (const docSnap of userEmpQuery.docs) {
      const data = docSnap.data() as Record<string, unknown>;
      if (data.evereeOnboardingStatus === 'complete' && data.payrollOnboardingCompletedAt != null) {
        continue;
      }
      await docSnap.ref.set(
        {
          payrollOnboardingCompletedAt: data.payrollOnboardingCompletedAt ?? now,
          evereeOnboardingStatus: 'complete',
          updatedAt: now,
        },
        { merge: true },
      );
    }
  } catch (e: unknown) {
    logger.warn('[mirrorEvereeOnboardingCompleteToEmployments] user_employments_mirror_failed', {
      tenantId,
      entityId,
      userId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export const evereeAdminGetWorker = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const evereeWorkerId = typeof d?.evereeWorkerId === 'string' ? d.evereeWorkerId : '';
  // Subject-of-record. Defaults to caller (worker self-fetch); recruiters/admins
  // may pass any uid. Keeps the gate a single comparison instead of duplicating
  // the role check in every caller. The body of `userId` doesn't have to match
  // the Everee worker's external_user_id — we only use it to widen the gate
  // when the caller is the worker themselves.
  const targetUserId = typeof d?.userId === 'string' ? d.userId : request.auth?.uid ?? '';
  if (!tenantId || !entityId || !evereeWorkerId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId, evereeWorkerId required');
  }
  if (!canSelfOrManageEveree(request.auth as any, tenantId, targetUserId)) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }
  const config = await requireEvereeEnabledEntity(tenantId, entityId);
  try {
    const response = await evereeRequest<unknown>(
      config,
      'GET',
      `/api/v2/workers/${encodeURIComponent(evereeWorkerId)}`,
    );
    // When the live Everee record reports onboarding-complete, flip the
    // matching `entity_employments` row so the Work Readiness chip turns
    // green for this entity. Idempotent and best-effort; never blocks the
    // response, never reverses terminal statuses (handled in the helper).
    if (response && typeof response === 'object') {
      const flat = response as Record<string, unknown>;
      const candidate =
        (flat.worker as Record<string, unknown> | undefined) ||
        (flat.data as Record<string, unknown> | undefined) ||
        flat;
      if (isEvereeOnboardingComplete(candidate)) {
        await mirrorEvereeOnboardingCompleteToEmployments({
          tenantId,
          entityId,
          userId: targetUserId,
        });
      }
    }
    return { ok: true as const, evereeWorkerId, evereeTenantId: config.evereeTenantId, response };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[evereeAdminGetWorker] failed', {
      tenantId,
      entityId,
      evereeWorkerId,
      message: msg,
    });
    const safe =
      msg.length > 480 ? `${msg.slice(0, 480)}…` : msg || 'Could not fetch worker from Everee';
    throw new HttpsError('failed-precondition', safe);
  }
});

/**
 * Parse the HTTP status that `evereeRequest` embeds in its thrown Error
 * message (shape: `Everee API GET /path: <status> <body>`). Used by the
 * tax-form callables to distinguish "this worker isn't a contractor / W-2
 * yet" (404 — render the section as not-applicable) from real upstream
 * failures we want the panel to surface.
 */
function parseEvereeErrorStatus(message: string): number | null {
  const match = /:\s*(\d{3})\b/.exec(message);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Worker-signed file index (`GET /api/v2/workers/files`). Endpoint locked
 * after pilot — single call, paginated by `size`. Default 100 covers the
 * worst pilot scenario (full annual tax pack + onboarding + policies).
 *
 * Wrapper shape preserved for backward compat: callers continue to read
 * `result.ok`. `attempts` always returns `[]` so legacy diagnostic UIs
 * render the empty case until we delete those branches.
 */
export const evereeAdminGetWorkerDocuments = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const evereeWorkerId = typeof d?.evereeWorkerId === 'string' ? d.evereeWorkerId : '';
  const targetUserId = typeof d?.userId === 'string' ? d.userId : request.auth?.uid ?? '';
  if (!tenantId || !entityId || !evereeWorkerId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId, evereeWorkerId required');
  }
  if (!canSelfOrManageEveree(request.auth as any, tenantId, targetUserId)) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }
  const config = await requireEvereeEnabledEntity(tenantId, entityId);

  const path = `/api/v2/workers/files?worker-id=${encodeURIComponent(evereeWorkerId)}&size=100`;
  try {
    const response = await evereeRequest<Record<string, unknown>>(config, 'GET', path);
    const items = Array.isArray(response?.items) ? (response.items as unknown[]) : [];
    return {
      ok: true as const,
      evereeWorkerId,
      evereeTenantId: config.evereeTenantId,
      files: items,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn('[evereeAdminGetWorkerDocuments] api_call_failed', {
      tenantId,
      entityId,
      evereeWorkerId,
      message: message.slice(0, 240),
    });
    return {
      ok: false as const,
      evereeWorkerId,
      files: [] as unknown[],
      error: message.slice(0, 240),
    };
  }
});

/**
 * W-9 (contractor 1099) signed taxpayer-info pull. Returns the raw response
 * so the panel can render whichever Everee field names happen to be
 * authoritative this revision (we render defensively client-side). 404 ⇒
 * worker is W-2 (no W-9 applicable) — return `{ applicable: false }` so the
 * "Tax Forms" UI hides the W-9 card cleanly. Any other failure ⇒
 * `{ applicable: true, error }` so the panel can surface an inline alert.
 */
export const evereeAdminGetWorkerW9 = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const evereeWorkerId = typeof d?.evereeWorkerId === 'string' ? d.evereeWorkerId : '';
  const targetUserId = typeof d?.userId === 'string' ? d.userId : request.auth?.uid ?? '';
  if (!tenantId || !entityId || !evereeWorkerId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId, evereeWorkerId required');
  }
  if (!canSelfOrManageEveree(request.auth as any, tenantId, targetUserId)) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }
  const config = await requireEvereeEnabledEntity(tenantId, entityId);
  try {
    const response = await evereeRequest<unknown>(
      config,
      'GET',
      `/api/v2/workers/${encodeURIComponent(evereeWorkerId)}/w9-info`,
    );
    return { ok: true as const, applicable: true as const, response };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const status = parseEvereeErrorStatus(message);
    if (status === 404) {
      return { ok: false as const, applicable: false as const };
    }
    logger.warn('[evereeAdminGetWorkerW9] api_call_failed', {
      tenantId,
      entityId,
      evereeWorkerId,
      status,
      message: message.slice(0, 240),
    });
    return {
      ok: false as const,
      applicable: true as const,
      error: message.slice(0, 240),
    };
  }
});

/**
 * W-4 (employee withholding) settings pull. Symmetric to W-9: 404 ⇒
 * `{ applicable: false }` (worker is a contractor / W-2 not yet completed),
 * other failures ⇒ `{ applicable: true, error }`.
 */
export const evereeAdminGetWorkerW4 = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const evereeWorkerId = typeof d?.evereeWorkerId === 'string' ? d.evereeWorkerId : '';
  const targetUserId = typeof d?.userId === 'string' ? d.userId : request.auth?.uid ?? '';
  if (!tenantId || !entityId || !evereeWorkerId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId, evereeWorkerId required');
  }
  if (!canSelfOrManageEveree(request.auth as any, tenantId, targetUserId)) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }
  const config = await requireEvereeEnabledEntity(tenantId, entityId);
  try {
    const response = await evereeRequest<unknown>(
      config,
      'GET',
      `/api/v2/workers/${encodeURIComponent(evereeWorkerId)}/w-4-tax-withholding-settings`,
    );
    return { ok: true as const, applicable: true as const, response };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const status = parseEvereeErrorStatus(message);
    if (status === 404) {
      return { ok: false as const, applicable: false as const };
    }
    logger.warn('[evereeAdminGetWorkerW4] api_call_failed', {
      tenantId,
      entityId,
      evereeWorkerId,
      status,
      message: message.slice(0, 240),
    });
    return {
      ok: false as const,
      applicable: true as const,
      error: message.slice(0, 240),
    };
  }
});
