/**
 * Worker dashboard action items V1 — Firestore triggers + recruiter callable.
 *
 * Six triggers fan out to the recompute helper any time one of the inputs
 * the model reads changes. Each trigger is intentionally narrow on the
 * "what changed" gate so we don't pay for a recompute on every unrelated
 * write.
 *
 * Mirrors the convention in `homeSnapshotTrigger.ts` (region us-central1,
 * `DEFAULT_FIRESTORE_TRIGGER_MEMORY`, no retry, capped maxInstances).
 *
 * The brief `docs/WORKER_ACTION_ITEMS_V2_CURSOR_BRIEF.md` calls for the
 * applications trigger on `applications/{id}` but the actual Firestore path
 * in this repo is `tenants/{tenantId}/applications/{id}` (verified across
 * `useWorkerAiPrescreenSurfaceSignals`, `gigShiftApplicationLimits`, etc.) —
 * so the trigger uses that path and resolves the worker uid from
 * `userId` / `candidateId`.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { isC1WorkerScope } from './c1WorkerScope';
import { DEFAULT_FIRESTORE_TRIGGER_MEMORY } from '../utils/functionRuntimeDefaults';
import {
  recomputeWorkerDashboardActionItemsForUser,
  resolveWorkerDashboardSnapshotTenantId,
} from './workerDashboardActionItemsRecompute';

if (!admin.apps.length) admin.initializeApp();

const REGION = 'us-central1' as const;
const MAX_INSTANCES = 5 as const;

// ---------------------------------------------------------------------------
// 1. users/{uid} — recompute when a predicate-input field changes.
// ---------------------------------------------------------------------------

interface UserPredicateFingerprint {
  dob: unknown;
  phone: unknown;
  phoneVerified: unknown;
  last4SSN: unknown;
  addressInfo: Record<string, unknown> | null;
  workerProfilePhoto: unknown;
  avatar: unknown;
  emergencyContact: Record<string, unknown> | null;
  smsOptIn: unknown;
  smsBlockedSystem: unknown;
  smsSystemUnavailable: unknown;
  notificationsSmsUnavailable: unknown;
  dismissedActionItems: Record<string, unknown> | null;
  onboarding: Record<string, unknown> | null;
  workEligibilityAttestation: Record<string, unknown> | null;
  workEligibility: unknown;
  requireSponsorship: unknown;
  /** Tenant resolution can change which tenant we snapshot under. */
  activeTenantId: unknown;
  tenantId: unknown;
}

function predicateFingerprint(doc: Record<string, unknown> | null): UserPredicateFingerprint | null {
  if (!doc) return null;
  const wp = (doc.workerProfile as Record<string, unknown> | undefined) || {};
  const dashboard = (wp.dashboard as Record<string, unknown> | undefined) || {};
  const notifications = (doc.notificationSettings as Record<string, unknown> | undefined) || {};
  return {
    dob: doc.dob ?? doc.dateOfBirth ?? null,
    phone: doc.phone ?? null,
    phoneVerified: doc.phoneVerified ?? null,
    last4SSN: doc.last4SSN ?? null,
    addressInfo: (doc.addressInfo as Record<string, unknown>) || null,
    workerProfilePhoto: wp.photoUrl ?? null,
    avatar: doc.avatar ?? null,
    emergencyContact: (doc.emergencyContact as Record<string, unknown>) || null,
    smsOptIn: doc.smsOptIn ?? null,
    smsBlockedSystem: doc.smsBlockedSystem ?? null,
    smsSystemUnavailable: doc.smsSystemUnavailable ?? null,
    notificationsSmsUnavailable: notifications.smsUnavailable ?? null,
    dismissedActionItems:
      (dashboard.dismissedActionItems as Record<string, unknown>) || null,
    onboarding: (doc.onboarding as Record<string, unknown>) || null,
    workEligibilityAttestation:
      (doc.workEligibilityAttestation as Record<string, unknown>) || null,
    workEligibility: doc.workEligibility ?? null,
    requireSponsorship: doc.requireSponsorship ?? null,
    activeTenantId: doc.activeTenantId ?? null,
    tenantId: doc.tenantId ?? null,
  };
}

function predicateFingerprintChanged(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): boolean {
  const a = predicateFingerprint(before);
  const b = predicateFingerprint(after);
  return JSON.stringify(a) !== JSON.stringify(b);
}

export const syncWorkerDashboardActionItemsOnUserWrite = onDocumentWritten(
  {
    document: 'users/{uid}',
    region: REGION,
    maxInstances: MAX_INSTANCES,
    retry: false,
    memory: DEFAULT_FIRESTORE_TRIGGER_MEMORY,
  },
  async (event) => {
    const before = event.data?.before?.exists
      ? (event.data.before.data() as Record<string, unknown>)
      : null;
    const after = event.data?.after?.exists
      ? (event.data.after.data() as Record<string, unknown>)
      : null;
    const uid = event.params.uid as string;
    if (!after) return;
    if (!isC1WorkerScope(after)) return;
    if (!predicateFingerprintChanged(before, after)) return;

    try {
      await recomputeWorkerDashboardActionItemsForUser(admin.firestore(), uid, {
        reason: 'user_doc_predicate_changed',
      });
    } catch (err) {
      logger.error('workerDashboardActionItemsV1: user-doc trigger failed', {
        uid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

// ---------------------------------------------------------------------------
// 2. tenants/{tenantId}/assignments/{assignmentId} — recompute on
//    confirm-affecting writes.
// ---------------------------------------------------------------------------

interface AssignmentTriggerFingerprint {
  status: unknown;
  confirmedAt: unknown;
  declinedAt: unknown;
  startDate: unknown;
  startTime: unknown;
}

function assignmentFingerprint(
  doc: Record<string, unknown> | null,
): AssignmentTriggerFingerprint | null {
  if (!doc) return null;
  return {
    status: doc.status ?? null,
    confirmedAt: doc.confirmedAt ?? null,
    declinedAt: doc.declinedAt ?? null,
    startDate: doc.startDate ?? null,
    startTime: doc.startTime ?? null,
  };
}

function assignmentChangedForActionItems(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): boolean {
  const a = assignmentFingerprint(before);
  const b = assignmentFingerprint(after);
  return JSON.stringify(a) !== JSON.stringify(b);
}

export const syncWorkerDashboardActionItemsOnAssignmentWrite = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/assignments/{assignmentId}',
    region: REGION,
    maxInstances: MAX_INSTANCES,
    retry: false,
    memory: DEFAULT_FIRESTORE_TRIGGER_MEMORY,
  },
  async (event) => {
    const before = event.data?.before?.exists
      ? (event.data.before.data() as Record<string, unknown>)
      : null;
    const after = event.data?.after?.exists
      ? (event.data.after.data() as Record<string, unknown>)
      : null;
    const doc = after || before;
    if (!doc) return;
    const uid = String(doc.userId || '').trim();
    if (!uid) return;
    if (!assignmentChangedForActionItems(before, after)) return;
    const tenantId = event.params.tenantId as string;

    try {
      await recomputeWorkerDashboardActionItemsForUser(admin.firestore(), uid, {
        reason: 'assignment_changed',
        tenantId,
      });
    } catch (err) {
      logger.error('workerDashboardActionItemsV1: assignment trigger failed', {
        tenantId,
        assignmentId: event.params.assignmentId,
        uid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

// ---------------------------------------------------------------------------
// 3. backgroundChecks/{id} — recompute for the candidate + its tenantId.
// ---------------------------------------------------------------------------

interface BackgroundCheckTriggerFingerprint {
  hrxStatus: unknown;
  requestedPackageName: unknown;
  lastServiceComponentStatus: unknown;
  lastServiceComponentName: unknown;
  orderCompleted: unknown;
  finalReportReady: unknown;
  applicantPortalUrl: unknown;
  applicantPortalLink: unknown;
}

function backgroundCheckFingerprint(
  doc: Record<string, unknown> | null,
): BackgroundCheckTriggerFingerprint | null {
  if (!doc) return null;
  const lastComp = (doc.lastServiceComponent as Record<string, unknown> | undefined) || {};
  return {
    hrxStatus: doc.hrxStatus ?? null,
    requestedPackageName: doc.requestedPackageName ?? null,
    lastServiceComponentStatus: lastComp.status ?? null,
    lastServiceComponentName: lastComp.serviceName ?? null,
    orderCompleted: doc.orderCompleted ?? null,
    finalReportReady: doc.finalReportReady ?? null,
    applicantPortalUrl: doc.applicantPortalUrl ?? null,
    applicantPortalLink: doc.applicantPortalLink ?? null,
  };
}

function backgroundCheckChangedForActionItems(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): boolean {
  const a = backgroundCheckFingerprint(before);
  const b = backgroundCheckFingerprint(after);
  return JSON.stringify(a) !== JSON.stringify(b);
}

export const syncWorkerDashboardActionItemsOnBackgroundCheckWrite = onDocumentWritten(
  {
    document: 'backgroundChecks/{checkId}',
    region: REGION,
    maxInstances: MAX_INSTANCES,
    retry: false,
    memory: DEFAULT_FIRESTORE_TRIGGER_MEMORY,
  },
  async (event) => {
    const before = event.data?.before?.exists
      ? (event.data.before.data() as Record<string, unknown>)
      : null;
    const after = event.data?.after?.exists
      ? (event.data.after.data() as Record<string, unknown>)
      : null;
    const doc = after || before;
    if (!doc) return;
    const uid = String(doc.candidateId || '').trim();
    const tenantId = String(doc.tenantId || '').trim();
    if (!uid || !tenantId) return;
    if (!backgroundCheckChangedForActionItems(before, after)) return;

    try {
      await recomputeWorkerDashboardActionItemsForUser(admin.firestore(), uid, {
        reason: 'background_check_changed',
        tenantId,
      });
    } catch (err) {
      logger.error('workerDashboardActionItemsV1: backgroundCheck trigger failed', {
        tenantId,
        checkId: event.params.checkId,
        uid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

// ---------------------------------------------------------------------------
// 4. tenants/{tenantId}/everify_cases/{caseId} — recompute for `userId`.
// ---------------------------------------------------------------------------

export const syncWorkerDashboardActionItemsOnEverifyCaseWrite = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/everify_cases/{caseId}',
    region: REGION,
    maxInstances: MAX_INSTANCES,
    retry: false,
    memory: DEFAULT_FIRESTORE_TRIGGER_MEMORY,
  },
  async (event) => {
    const before = event.data?.before?.exists
      ? (event.data.before.data() as Record<string, unknown>)
      : null;
    const after = event.data?.after?.exists
      ? (event.data.after.data() as Record<string, unknown>)
      : null;
    const doc = after || before;
    if (!doc) return;
    const uid = String(doc.userId || '').trim();
    if (!uid) return;
    const beforeStatus = String(before?.status ?? '').toLowerCase();
    const afterStatus = String(after?.status ?? '').toLowerCase();
    if (beforeStatus === afterStatus && Boolean(before) === Boolean(after)) return;
    const tenantId = event.params.tenantId as string;

    try {
      await recomputeWorkerDashboardActionItemsForUser(admin.firestore(), uid, {
        reason: 'everify_case_changed',
        tenantId,
      });
    } catch (err) {
      logger.error('workerDashboardActionItemsV1: everify_case trigger failed', {
        tenantId,
        caseId: event.params.caseId,
        uid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

// ---------------------------------------------------------------------------
// 5. tenants/{tenantId}/applications/{id} — recompute on prescreen reminder
//    fields.
// ---------------------------------------------------------------------------

function applicationPrescreenChanged(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): boolean {
  const a = before || {};
  const b = after || {};
  if (a.workerAiPrescreenReminderLastOutcome !== b.workerAiPrescreenReminderLastOutcome) {
    return true;
  }
  // Reminder timestamps come back as Firestore Timestamps; compare by JSON.
  return (
    JSON.stringify(a.workerAiPrescreenReminderSentAt ?? null) !==
    JSON.stringify(b.workerAiPrescreenReminderSentAt ?? null)
  );
}

export const syncWorkerDashboardActionItemsOnApplicationWrite = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/applications/{applicationId}',
    region: REGION,
    maxInstances: MAX_INSTANCES,
    retry: false,
    memory: DEFAULT_FIRESTORE_TRIGGER_MEMORY,
  },
  async (event) => {
    const before = event.data?.before?.exists
      ? (event.data.before.data() as Record<string, unknown>)
      : null;
    const after = event.data?.after?.exists
      ? (event.data.after.data() as Record<string, unknown>)
      : null;
    const doc = after || before;
    if (!doc) return;
    const uid = String(doc.userId || doc.candidateId || '').trim();
    if (!uid) return;
    if (!applicationPrescreenChanged(before, after)) return;
    const tenantId = event.params.tenantId as string;

    try {
      await recomputeWorkerDashboardActionItemsForUser(admin.firestore(), uid, {
        reason: 'application_prescreen_changed',
        tenantId,
      });
    } catch (err) {
      logger.error('workerDashboardActionItemsV1: application trigger failed', {
        tenantId,
        applicationId: event.params.applicationId,
        uid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

// ---------------------------------------------------------------------------
// 6. users/{uid}/interviews/{id} — recompute on prescreen interview writes.
// ---------------------------------------------------------------------------

export const syncWorkerDashboardActionItemsOnInterviewWrite = onDocumentWritten(
  {
    document: 'users/{uid}/interviews/{interviewId}',
    region: REGION,
    maxInstances: MAX_INSTANCES,
    retry: false,
    memory: DEFAULT_FIRESTORE_TRIGGER_MEMORY,
  },
  async (event) => {
    const before = event.data?.before?.exists
      ? (event.data.before.data() as Record<string, unknown>)
      : null;
    const after = event.data?.after?.exists
      ? (event.data.after.data() as Record<string, unknown>)
      : null;
    const doc = after || before;
    if (!doc) return;
    const kind = String(doc.interviewKind || '');
    if (kind !== 'worker_ai_prescreen') return;
    const uid = event.params.uid as string;

    try {
      await recomputeWorkerDashboardActionItemsForUser(admin.firestore(), uid, {
        reason: 'interview_changed',
      });
    } catch (err) {
      logger.error('workerDashboardActionItemsV1: interview trigger failed', {
        uid,
        interviewId: event.params.interviewId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Callable — recruiter / QA force refresh. Mirrors `syncHrxReadinessSnapshotV1`.
// ---------------------------------------------------------------------------

async function assertCanForceRefresh(
  auth: { token?: Record<string, unknown>; uid: string },
  tenantId: string,
  uid: string,
): Promise<void> {
  if (auth?.token?.isHRX === true) return;
  // Worker can refresh their own snapshot — useful for the dashboard's
  // "Refresh" affordance and end-to-end tests.
  if (auth.uid === uid) return;

  const roles = (auth?.token?.roles || {}) as Record<string, { role?: string }>;
  const tenantRole = roles?.[tenantId]?.role;
  if (tenantRole && ['Recruiter', 'Manager', 'Admin'].includes(String(tenantRole))) return;

  const db = admin.firestore();
  const userSnap = await db.doc(`users/${auth.uid}`).get();
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'No permission to sync action items.');
  }
  const userData = (userSnap.data() || {}) as Record<string, unknown>;
  const tenantMeta =
    (userData.tenantIds as Record<string, Record<string, unknown>> | undefined)?.[tenantId] || {};
  const role = String(tenantMeta.role || userData.role || '')
    .trim()
    .toLowerCase();
  if (['recruiter', 'manager', 'admin'].includes(role)) return;
  const recruiterEnabled = Boolean(tenantMeta.recruiter ?? userData.recruiter);
  if (recruiterEnabled) return;
  const secRaw = tenantMeta.securityLevel ?? userData.securityLevel ?? '0';
  const sec = Number.parseInt(String(secRaw), 10);
  if (!Number.isNaN(sec) && sec >= 4) return;

  throw new HttpsError('permission-denied', 'No permission to sync action items.');
}

export const syncWorkerDashboardActionItemsV1 = onCall(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }
    const uid = String(request.data?.uid || '').trim();
    const tenantId = String(request.data?.tenantId || '').trim();
    if (!uid) throw new HttpsError('invalid-argument', 'uid is required.');
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');

    await assertCanForceRefresh(request.auth, tenantId, uid);

    try {
      const result = await recomputeWorkerDashboardActionItemsForUser(admin.firestore(), uid, {
        reason: 'callable_force_refresh',
        tenantId,
        skipScopeGate: true,
      });
      return {
        wrote: result.wrote,
        outOfScope: result.outOfScope,
        itemCount: result.snapshot?.items.length ?? 0,
        inputsHash: result.diagnostics?.inputsHash ?? null,
        tenantId,
      };
    } catch (err) {
      logger.error('workerDashboardActionItemsV1: callable failed', {
        uid,
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError('internal', 'Failed to recompute action items.');
    }
  },
);

// Export the resolver for tests / callable wrappers.
export { resolveWorkerDashboardSnapshotTenantId };
