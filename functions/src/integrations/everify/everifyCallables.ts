/**
 * E-Verify callable Cloud Functions.
 * HRX E-Verify Master Plan §3.3
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { CALLABLE_BROWSER_CORS } from '../callableBrowserCors';
import { EverifyCreateCaseInput } from './everifySchemas';
import {
  EverifyErrorCode,
  OPEN_EVERIFY_CASE_STATUSES,
  requestHashCollisionBlocksCreate,
} from './everifyErrors';
import { resolveEligibility } from './everifyEligibility';
import { createAndSubmitCase, everifyCasePublicLinkageFromPrivate, upsertEverifyCasePublicMirror } from './everifyService';
import { getAccessToken } from './everifyAuth';
import { createDraftCase, submitCase } from './everifyRestClient';
import { resolveI9PayloadFromFixture } from './everifyI9Provider';
import { whitelistEverifyRaw } from './everifyRedaction';
import { EVERIFY_WS_USERNAME, EVERIFY_WS_PASSWORD } from './everifySecrets';
import { getEverifyAuthArchitectureDiagnostics } from './everifyConfig';
import { createEverifyCase } from './everifyCases';
import { EverifySoapEmployeeDataSchema, EverifySoapError } from './everifyTypes';
import { canManageOnboarding } from '../../onboarding/workerOnboardingPipeline';

const db = admin.firestore();

/**
 * Gen2 options for admin-only E-Verify callables (no ICA secrets on the handler).
 * Aligns with everifyListCases — default 256MiB + cold-start can fail Cloud Run health checks during deploy.
 */
const EVERIFY_ADMIN_ONCALL_OPTS = {
  enforceAppCheck: false as const,
  cors: CALLABLE_BROWSER_CORS,
  region: 'us-central1' as const,
  memory: '512MiB' as const,
  timeoutSeconds: 60,
};

function getIcaCredentials(): { username: string; password: string } | null {
  try {
    const u = EVERIFY_WS_USERNAME.value();
    const p = EVERIFY_WS_PASSWORD.value();
    if (u && p) return { username: u, password: p };
  } catch {
    // secrets not configured
  }
  return null;
}

export const everifyCreateCase = onCall(
  {
    enforceAppCheck: false,
    cors: CALLABLE_BROWSER_CORS,
    secrets: [EVERIFY_WS_USERNAME, EVERIFY_WS_PASSWORD],
    memory: '512MiB',
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated');
    }

    const raw = request.data as { tenantId?: unknown; userEmploymentId?: unknown };
    logger.info('[everifyCreateCase] invoked', {
      uid: auth.uid,
      tenantId: typeof raw.tenantId === 'string' ? raw.tenantId : undefined,
      userEmploymentId: typeof raw.userEmploymentId === 'string' ? raw.userEmploymentId : undefined,
    });

    const parsed = EverifyCreateCaseInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Invalid input', {
        details: parsed.error.flatten(),
      });
    }

    const { tenantId, entityId, userEmploymentId, assignmentId, i9Employee } = parsed.data;

    if (!(await canManageOnboarding(auth as any, tenantId, auth.uid))) {
      throw new HttpsError('permission-denied', EverifyErrorCode.UNAUTHORIZED);
    }

    if (!userEmploymentId && !assignmentId && !entityId) {
      throw new HttpsError('invalid-argument', 'Provide entityId, userEmploymentId, or assignmentId');
    }

    const eligibility = await resolveEligibility({
      tenantId,
      entityId,
      userEmploymentId,
      assignmentId,
    });

    if (!eligibility.eligible) {
      throw new HttpsError(
        'failed-precondition',
        eligibility.errorMessage || 'Not eligible for E-Verify',
        { code: eligibility.errorCode, blockingReasons: eligibility.blockingReasons }
      );
    }

    const casesRef = db.collection('tenants').doc(tenantId).collection('everify_cases');
    let openSnap: admin.firestore.QuerySnapshot;
    if (eligibility.userEmploymentId) {
      openSnap = await casesRef
        .where('userEmploymentId', '==', eligibility.userEmploymentId)
        .where('status', 'in', [...OPEN_EVERIFY_CASE_STATUSES])
        .limit(1)
        .get();
    } else {
      openSnap = await casesRef
        .where('userId', '==', eligibility.userId)
        .where('entityId', '==', eligibility.entityId)
        .where('status', 'in', [...OPEN_EVERIFY_CASE_STATUSES])
        .limit(1)
        .get();
    }
    if (!openSnap.empty) {
      throw new HttpsError(
        'already-exists',
        EverifyErrorCode.DUPLICATE_CASE,
        { existingCaseId: openSnap.docs[0].id }
      );
    }

    const dupHash = await casesRef.where('requestHash', '==', eligibility.requestHash).limit(1).get();
    if (!dupHash.empty) {
      const existingStatus = dupHash.docs[0].data()?.status;
      if (requestHashCollisionBlocksCreate(existingStatus)) {
        throw new HttpsError(
          'already-exists',
          EverifyErrorCode.DUPLICATE_CASE,
          { existingCaseId: dupHash.docs[0].id }
        );
      }
    }

    const email = auth.token?.email ?? '';
    const name = auth.token?.name ?? auth.token?.email ?? 'User';
    const phone10 = (auth.token?.phone_number ?? '').replace(/\D/g, '').slice(-10) || '0000000000';
    const caseCreator = { name, email, phone10 };

    let result: Awaited<ReturnType<typeof createAndSubmitCase>>;
    try {
      logger.info('[everifyCreateCase] starting', {
        tenantId,
        userEmploymentId: eligibility.userEmploymentId,
        userId: eligibility.userId,
      });
      result = await createAndSubmitCase({
        tenantId,
        entityId: eligibility.entityId!,
        userId: eligibility.userId!,
        jobOrderId: eligibility.jobOrderId,
        shiftId: eligibility.shiftId,
        assignmentId: eligibility.assignmentId,
        userEmploymentId: eligibility.userEmploymentId,
        startDate: eligibility.startDate,
        everifyCompanyId: eligibility.everifyCompanyId,
        requestHash: eligibility.requestHash,
        caseCreator,
        icaCredentials: getIcaCredentials(),
        legacyCredentials: null,
        i9Employee: i9Employee ?? null,
      });
    } catch (e: unknown) {
      if (e instanceof HttpsError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('[everifyCreateCase] createAndSubmitCase failed', {
        tenantId,
        userEmploymentId: eligibility.userEmploymentId,
        error: msg,
      });
      // Plain Error → client only saw "INTERNAL"; surface message for ops (ICA creds, USCIS API, etc.).
      throw new HttpsError(
        'failed-precondition',
        msg || 'E-Verify case creation failed. Check function logs and E-Verify secrets (EVERIFY_WS_*).',
      );
    }

    return {
      caseId: result.caseId,
      everifyCaseNumber: result.everifyCaseNumber,
      status: result.status,
    };
  }
);

export const everifyCheckEligibility = onCall(
  {
    enforceAppCheck: false,
    cors: CALLABLE_BROWSER_CORS,
    // Match everifyCreateCase: Gen2 cold-start loads the full functions bundle; 256MiB global default can OOM / miss healthcheck.
    memory: '512MiB',
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Must be authenticated');

    const parsed = EverifyCreateCaseInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Invalid input', {
        details: parsed.error.flatten(),
      });
    }

    const { tenantId, entityId, userEmploymentId, assignmentId } = parsed.data;

    if (!(await canManageOnboarding(auth as any, tenantId, auth.uid))) {
      throw new HttpsError('permission-denied', EverifyErrorCode.UNAUTHORIZED);
    }

    if (!userEmploymentId && !assignmentId && !entityId) {
      throw new HttpsError('invalid-argument', 'Provide entityId, userEmploymentId, or assignmentId');
    }

    const eligibility = await resolveEligibility({
      tenantId,
      entityId,
      userEmploymentId,
      assignmentId,
    });

    return {
      eligible: eligibility.eligible,
      blockingReasons: eligibility.blockingReasons,
      entityId: eligibility.entityId,
      userId: eligibility.userId,
      userEmploymentId: eligibility.userEmploymentId,
      assignmentId: eligibility.assignmentId,
    };
  }
);

/** Internal: verify ICA REST login only (no case create). HRX/admin only. Returns authArchitecture for ops. */
export const everifyPingAuth = onCall(
  {
    ...EVERIFY_ADMIN_ONCALL_OPTS,
    secrets: [EVERIFY_WS_USERNAME, EVERIFY_WS_PASSWORD],
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Must be authenticated');
    if (!(auth.token?.hrx || (auth.token?.roles && Object.values(auth.token.roles).some((r: unknown) => (r as { role?: string })?.role === 'Admin')))) {
      throw new HttpsError('permission-denied', 'HRX or Admin required');
    }
    const authArchitecture = getEverifyAuthArchitectureDiagnostics();
    const username = EVERIFY_WS_USERNAME.value();
    const password = EVERIFY_WS_PASSWORD.value();
    logger.info('[everifyPingAuth] ICA REST login attempt', {
      ...authArchitecture,
      wsUsernameLength: username ? String(username).length : 0,
      wsPasswordLength: password ? String(password).length : 0,
    });
    if (!username || !password) {
      return {
        ok: false,
        error: 'EVERIFY_WS_USERNAME / EVERIFY_WS_PASSWORD not set or empty in Secret Manager binding',
        authArchitecture,
        wsUsernameConfigured: Boolean(username && String(username).length > 0),
        wsPasswordConfigured: Boolean(password && String(password).length > 0),
      };
    }
    try {
      await getAccessToken({ username, password });
      logger.info('[everifyPingAuth] ICA REST login succeeded', {
        restLoginHost: authArchitecture.restLoginHost,
      });
      return { ok: true, authArchitecture };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('[everifyPingAuth] ICA REST login failed', {
        restLoginHost: authArchitecture.restLoginHost,
        message: msg.slice(0, 500),
      });
      return {
        ok: false,
        error: msg,
        authArchitecture,
        wsUsernameConfigured: true,
        wsPasswordConfigured: true,
      };
    }
  }
);

/** Dry run: create draft + submit with fixture payload. No Firestore writes. HRX/Admin only. */
export const everifyDryRunCreateAndSubmit = onCall(
  {
    enforceAppCheck: false,
    cors: CALLABLE_BROWSER_CORS,
    secrets: [EVERIFY_WS_USERNAME, EVERIFY_WS_PASSWORD],
    memory: '512MiB',
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Must be authenticated');
    if (!(auth.token?.hrx || (auth.token?.roles && Object.values(auth.token.roles).some((r: unknown) => (r as { role?: string })?.role === 'Admin')))) {
      throw new HttpsError('permission-denied', 'HRX or Admin required');
    }
    try {
      const username = EVERIFY_WS_USERNAME.value();
      const password = EVERIFY_WS_PASSWORD.value();
      if (!username || !password) {
        return { ok: false, error: 'EVERIFY_WS_USERNAME / EVERIFY_WS_PASSWORD not set' };
      }
      const creds = { username, password };
      const payload = resolveI9PayloadFromFixture();
      const draft = await createDraftCase(payload, creds);
      const caseNumber = draft.case_number;
      const submitted = await submitCase(caseNumber, creds);
      const providerStatus = submitted.case_status ?? draft.case_status ?? 'UNKNOWN';
      const eligibilityStatement = submitted.case_eligibility_statement ?? undefined;
      const rawWhitelisted = whitelistEverifyRaw(submitted);
      return {
        ok: true,
        caseNumber,
        providerStatus,
        eligibilityStatement,
        rawWhitelisted,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }
);

/** Admin: list/filter E-Verify cases */
export const everifyListCases = onCall(
  {
    enforceAppCheck: false,
    cors: CALLABLE_BROWSER_CORS,
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Must be authenticated');
    const { tenantId, status, limit = 50, startAfter } = (request.data || {}) as {
      tenantId: string;
      status?: string | string[];
      limit?: number;
      startAfter?: string;
    };
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId required');
    if (!(await canManageOnboarding(auth as any, tenantId, auth.uid))) {
      throw new HttpsError('permission-denied', EverifyErrorCode.UNAUTHORIZED);
    }

    let q: admin.firestore.Query = db
      .collection('tenants')
      .doc(tenantId)
      .collection('everify_cases')
      .orderBy('createdAt', 'desc')
      .limit(Math.min(limit, 200));
    if (startAfter) {
      const anchorSnap = await db.collection('tenants').doc(tenantId).collection('everify_cases').doc(startAfter).get();
      if (anchorSnap.exists) q = q.startAfter(anchorSnap);
    }
    const snap = await q.get();
    let cases = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (status) {
      const statuses = new Set(Array.isArray(status) ? status : [status]);
      cases = cases.filter((c) => statuses.has((c as { status?: string }).status));
    }
    return { cases, count: cases.length };
  }
);

function sanitizeEnqueueError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/NOT_FOUND|Queue/i.test(msg) && /queue/i.test(msg)) {
    return 'E-Verify task queue is missing or misconfigured in Cloud Tasks. Retry ran inline instead, or create the everify queue in us-central1.';
  }
  if (/PERMISSION_DENIED|permission/i.test(msg)) {
    return 'Cloud Tasks permission denied for this project. Retry ran inline if possible, or grant cloudtasks.tasks.create to the functions service account.';
  }
  return msg.length > 280 ? `${msg.slice(0, 277)}…` : msg;
}

/** Admin: retry creating E-Verify case (enqueue Cloud Task; falls back to synchronous create if enqueue skips or fails) */
export const everifyRetryCase = onCall(
  {
    enforceAppCheck: false,
    cors: CALLABLE_BROWSER_CORS,
    secrets: [EVERIFY_WS_USERNAME, EVERIFY_WS_PASSWORD],
    memory: '512MiB',
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Must be authenticated');
    const { tenantId, caseId, userEmploymentId } = (request.data || {}) as {
      tenantId: string;
      caseId: string;
      userEmploymentId?: string;
    };
    if (!tenantId || !caseId) throw new HttpsError('invalid-argument', 'tenantId and caseId required');
    if (!(await canManageOnboarding(auth as any, tenantId, auth.uid))) {
      throw new HttpsError('permission-denied', EverifyErrorCode.UNAUTHORIZED);
    }
    const caseRef = db.collection('tenants').doc(tenantId).collection('everify_cases').doc(caseId);
    const caseSnap = await caseRef.get();
    if (!caseSnap.exists) throw new HttpsError('not-found', 'Case not found');
    const caseData = caseSnap.data() || {};
    // Case doc is authoritative (user_employments id). Clients sometimes send entity_employments id ({uid}__select).
    const empId =
      (caseData.userEmploymentId as string | undefined) || userEmploymentId || undefined;
    if (!empId) throw new HttpsError('invalid-argument', 'userEmploymentId required (missing on case and request)');

    const { enqueueEverifyTask } = await import('./everifyTriggers');
    const { processEverifyCaseFromEmploymentPayload } = await import('./everifyEmploymentProcessor');

    let enqueued = false;
    let enqueueNote: string | undefined;
    try {
      enqueued = await enqueueEverifyTask(tenantId, empId);
    } catch (err: unknown) {
      enqueueNote = sanitizeEnqueueError(err);
      logger.warn('everifyRetryCase: Cloud Tasks enqueue failed, using synchronous retry', {
        tenantId,
        userEmploymentId: empId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (enqueued) {
      return { ok: true, message: 'Retry enqueued', via: 'cloud_task' as const };
    }

    try {
      const sync = await processEverifyCaseFromEmploymentPayload({ tenantId, userEmploymentId: empId });
      if (sync.ok === false) {
        throw new HttpsError('failed-precondition', sync.reason);
      }
      return {
        ok: true,
        message: enqueueNote
          ? `Case created (inline retry). Task queue issue: ${enqueueNote}`
          : 'Case created (inline retry; task queue unavailable or not configured)',
        via: 'inline' as const,
        caseId: sync.caseId,
        everifyCaseNumber: sync.everifyCaseNumber,
        status: sync.status,
      };
    } catch (err: unknown) {
      if (err instanceof HttpsError) throw err;
      const detail = err instanceof Error ? err.message : String(err);
      logger.error('everifyRetryCase: synchronous retry failed', { tenantId, empId, detail });
      throw new HttpsError(
        'internal',
        enqueueNote
          ? `E-Verify retry failed: ${detail}. (Enqueue error: ${enqueueNote})`
          : `E-Verify retry failed: ${detail}`
      );
    }
  }
);

/** Admin: exception action (e.g. mark for manual review, close) */
export const everifyExceptionAction = onCall(
  EVERIFY_ADMIN_ONCALL_OPTS,
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Must be authenticated');
    const { tenantId, caseId, action, note } = (request.data || {}) as {
      tenantId: string;
      caseId: string;
      action: 'mark_manual_review' | 'close' | 'dismiss_error';
      note?: string;
    };
    if (!tenantId || !caseId || !action) throw new HttpsError('invalid-argument', 'tenantId, caseId, action required');
    if (!(await canManageOnboarding(auth as any, tenantId, auth.uid))) {
      throw new HttpsError('permission-denied', EverifyErrorCode.UNAUTHORIZED);
    }
    const caseRef = db.collection('tenants').doc(tenantId).collection('everify_cases').doc(caseId);
    const caseSnap = await caseRef.get();
    if (!caseSnap.exists) throw new HttpsError('not-found', 'Case not found');

    const now = admin.firestore.FieldValue.serverTimestamp();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (action === 'mark_manual_review') {
      updates['exceptionStatus'] = 'manual_review';
      updates['exceptionNote'] = note;
    } else if (action === 'close') {
      updates['status'] = 'closed';
      updates['closedAt'] = now;
    } else if (action === 'dismiss_error') {
      updates['exceptionStatus'] = 'dismissed';
      updates['error'] = null;
    }

    await caseRef.update(updates);
    return { ok: true, message: `Action ${action} applied` };
  }
);

/** Helper: append event and optionally update everifyCaseActions */
async function everifyCaseAction(
  tenantId: string,
  caseId: string,
  eventType: string,
  actionUpdates: Record<string, unknown>,
  actor: string
): Promise<void> {
  const caseRef = db.collection('tenants').doc(tenantId).collection('everify_cases').doc(caseId);
  const snap = await caseRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Case not found');
  const data = snap.data()!;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const actions = { ...((data.everifyCaseActions as Record<string, unknown>) || {}), ...actionUpdates };
  await caseRef.update({
    updatedAt: now,
    everifyCaseActions: actions,
  });
  await caseRef.collection('events').add({
    tenantId,
    entityId: data.entityId ?? null,
    userId: data.userId ?? null,
    userEmploymentId: data.userEmploymentId ?? null,
    assignmentId: data.assignmentId ?? null,
    type: eventType,
    actor,
    at: now,
  });
}

/** Admin: mark employee notified (TNC workflow) */
export const everifyMarkEmployeeNotified = onCall(
  EVERIFY_ADMIN_ONCALL_OPTS,
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Must be authenticated');
    const { tenantId, caseId } = (request.data || {}) as { tenantId: string; caseId: string };
    if (!tenantId || !caseId) throw new HttpsError('invalid-argument', 'tenantId and caseId required');
    if (!(await canManageOnboarding(auth as any, tenantId, auth.uid))) {
      throw new HttpsError('permission-denied', EverifyErrorCode.UNAUTHORIZED);
    }
    const actor = (auth.token?.email as string) || 'admin';
    await everifyCaseAction(tenantId, caseId, 'EMPLOYEE_NOTIFIED', { employeeNotifiedAt: admin.firestore.FieldValue.serverTimestamp() }, actor);
    return { ok: true, message: 'Employee notified recorded' };
  }
);

/** Admin: mark employee contests (TNC workflow) */
export const everifyMarkContested = onCall(
  EVERIFY_ADMIN_ONCALL_OPTS,
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Must be authenticated');
    const { tenantId, caseId } = (request.data || {}) as { tenantId: string; caseId: string };
    if (!tenantId || !caseId) throw new HttpsError('invalid-argument', 'tenantId and caseId required');
    if (!(await canManageOnboarding(auth as any, tenantId, auth.uid))) {
      throw new HttpsError('permission-denied', EverifyErrorCode.UNAUTHORIZED);
    }
    const actor = (auth.token?.email as string) || 'admin';
    await everifyCaseAction(tenantId, caseId, 'CONTESTED', { employeeContests: true }, actor);
    return { ok: true, message: 'Contested recorded' };
  }
);

/** Admin: mark referral initiated (TNC workflow) */
export const everifyMarkReferralInitiated = onCall(
  EVERIFY_ADMIN_ONCALL_OPTS,
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Must be authenticated');
    const { tenantId, caseId } = (request.data || {}) as { tenantId: string; caseId: string };
    if (!tenantId || !caseId) throw new HttpsError('invalid-argument', 'tenantId and caseId required');
    if (!(await canManageOnboarding(auth as any, tenantId, auth.uid))) {
      throw new HttpsError('permission-denied', EverifyErrorCode.UNAUTHORIZED);
    }
    const actor = (auth.token?.email as string) || 'admin';
    await everifyCaseAction(tenantId, caseId, 'REFERRAL_INITIATED', { referralInitiatedAt: admin.firestore.FieldValue.serverTimestamp() }, actor);
    return { ok: true, message: 'Referral initiated recorded' };
  }
);

/** Admin: close case manually (TNC workflow); also sets status and closedAt */
export const everifyCloseCaseManual = onCall(
  EVERIFY_ADMIN_ONCALL_OPTS,
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Must be authenticated');
    const { tenantId, caseId, note } = (request.data || {}) as { tenantId: string; caseId: string; note?: string };
    if (!tenantId || !caseId) throw new HttpsError('invalid-argument', 'tenantId and caseId required');
    if (!(await canManageOnboarding(auth as any, tenantId, auth.uid))) {
      throw new HttpsError('permission-denied', EverifyErrorCode.UNAUTHORIZED);
    }
    const caseRef = db.collection('tenants').doc(tenantId).collection('everify_cases').doc(caseId);
    const snap = await caseRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Case not found');
    const data = snap.data()!;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const actor = (auth.token?.email as string) || 'admin';
    const actions = { ...((data.everifyCaseActions as Record<string, unknown>) || {}), caseClosedAt: now, notes: note ?? (data.everifyCaseActions as { notes?: string })?.notes };
    const publicData = (data.public as Record<string, unknown>) || {};
    const newPublic = { ...publicData, status: 'closed', statusDisplay: 'Closed (manual)' };
    await caseRef.update({
      updatedAt: now,
      status: 'closed',
      closedAt: now,
      everifyCaseActions: actions,
      public: newPublic,
    });
    await upsertEverifyCasePublicMirror(
      tenantId,
      caseId,
      (data.userId as string) ?? null,
      newPublic,
      everifyCasePublicLinkageFromPrivate(data as Record<string, unknown>)
    );
    await caseRef.collection('events').add({
      tenantId,
      entityId: data.entityId ?? null,
      userId: data.userId ?? null,
      userEmploymentId: data.userEmploymentId ?? null,
      assignmentId: data.assignmentId ?? null,
      type: 'CASE_CLOSED_MANUAL',
      actor,
      at: now,
      data: note ? { note } : undefined,
    });
    return { ok: true, message: 'Case closed' };
  }
);

/**
 * SOAP ICA path: authenticate + submit basic case; persist SOAP XML (redacted) under everify_cases.
 * HRX or global Admin only — not for end-user UI yet.
 */
export const everifySoapCreateCase = onCall(
  {
    enforceAppCheck: false,
    cors: CALLABLE_BROWSER_CORS,
    secrets: [EVERIFY_WS_USERNAME, EVERIFY_WS_PASSWORD],
    memory: '512MiB',
  },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Must be authenticated');
    if (
      !(
        auth.token?.hrx ||
        (auth.token?.roles &&
          Object.values(auth.token.roles).some((r: unknown) => (r as { role?: string })?.role === 'Admin'))
      )
    ) {
      throw new HttpsError('permission-denied', 'HRX or Admin required');
    }

    const { tenantId, employeeData } = (request.data || {}) as {
      tenantId?: string;
      employeeData?: unknown;
    };
    if (!tenantId || typeof tenantId !== 'string') {
      throw new HttpsError('invalid-argument', 'tenantId required');
    }

    const parsed = EverifySoapEmployeeDataSchema.safeParse(employeeData);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Invalid employeeData', {
        details: parsed.error.flatten(),
      });
    }

    const username = EVERIFY_WS_USERNAME.value();
    const password = EVERIFY_WS_PASSWORD.value();
    if (!username || !password) {
      throw new HttpsError('failed-precondition', 'EVERIFY_WS_USERNAME / EVERIFY_WS_PASSWORD not configured');
    }

    try {
      const result = await createEverifyCase({
        tenantId,
        employeeData: parsed.data,
        credentials: { username, password },
      });
      return {
        caseNumber: result.caseNumber,
        caseStatus: result.caseStatus,
        rawResponse: result.rawResponse,
        firestoreCaseId: result.firestoreCaseId,
      };
    } catch (e: unknown) {
      if (e instanceof EverifySoapError) {
        throw new HttpsError(
          e.kind === 'auth' ? 'permission-denied' : 'internal',
          e.message,
          { kind: e.kind, detail: e.detail }
        );
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw new HttpsError('internal', msg);
    }
  }
);
