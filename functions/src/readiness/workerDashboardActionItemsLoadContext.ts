/**
 * Worker dashboard action items V1 — Firestore loader (admin SDK).
 *
 * Builds the input bag the pure model in `workerDashboardActionItemsModel.ts`
 * expects. Mirrors the queries the web dashboard does today
 * (`src/pages/c1/workers/dashboard.tsx` + `useWorkerAiPrescreenSurfaceSignals`)
 * but uses the admin SDK so the readiness triggers can call it from a
 * Cloud Function.
 *
 * Caps and tenant scoping match the brief in
 * `docs/WORKER_ACTION_ITEMS_V2_CURSOR_BRIEF.md` §2.2.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import {
  C1_WORKER_AI_PRESCREEN_PATH,
  type WorkerDashboardActionItemsModelInput,
  type WorkerDashboardComplianceSignals,
  type WorkerDashboardPendingAssignment,
  type WorkerDashboardPrescreenSignals,
  type WorkerDashboardTempworksSignals,
} from './workerDashboardActionItemsModel';
import {
  WORKER_DASHBOARD_ACTION_ITEM_PRIORITY_SCORES,
  type WorkerDashboardActionItemV1,
} from './workerDashboardActionItemsTypes';

// ---------------------------------------------------------------------------
// Constants — keep aligned with web `dashboard.tsx` and
// `useWorkerAiPrescreenSurfaceSignals`.
// ---------------------------------------------------------------------------

const BACKGROUND_CHECKS_LIMIT = 25;
const EVERIFY_CASES_LIMIT = 25;
const APPLICATIONS_LIMIT = 40;
const INTERVIEWS_LIMIT = 60;
const PRESCREEN_FRESHNESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const ASSIGNMENT_AWAITING_STATUSES = new Set([
  'proposed',
  'pending',
  'offered',
  'pending_confirmation',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface WorkerDashboardActionItemsContext {
  modelInput: WorkerDashboardActionItemsModelInput;
  /** Diagnostic — recruiter QA / debugging. */
  diagnostics: {
    userDocExists: boolean;
    pendingAssignmentCount: number;
    backgroundCheckCount: number;
    everifyCaseCount: number;
    applicationsCount: number;
    interviewsCount: number;
    prescreenSuppressedByFreshness: boolean;
  };
}

export async function loadWorkerDashboardActionItemsContext(
  db: admin.firestore.Firestore,
  uid: string,
  tenantId: string,
  options?: { authAvatarUrl?: string | null },
): Promise<WorkerDashboardActionItemsContext> {
  if (!uid) throw new Error('loadWorkerDashboardActionItemsContext: uid required');
  if (!tenantId) throw new Error('loadWorkerDashboardActionItemsContext: tenantId required');

  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  const userDoc = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : null;

  const [
    pendingAssignments,
    backgroundChecks,
    everifyCases,
    prescreen,
  ] = await Promise.all([
    loadPendingAssignments(db, tenantId, uid),
    loadBackgroundChecks(db, tenantId, uid),
    loadEverifyCases(db, tenantId, uid),
    loadPrescreenSignals(db, tenantId, uid),
  ]);

  const compliance = deriveWorkerComplianceSignals(backgroundChecks, everifyCases);
  const tempworks = readTempworksOnboardingFromUserDoc(userDoc);

  const modelInput: WorkerDashboardActionItemsModelInput = {
    userDoc,
    pendingAssignments,
    tempworks,
    compliance,
    prescreen: prescreen.signals,
    authAvatarUrl: options?.authAvatarUrl ?? null,
    tenantId,
  };

  return {
    modelInput,
    diagnostics: {
      userDocExists: Boolean(userDoc),
      pendingAssignmentCount: pendingAssignments.length,
      backgroundCheckCount: backgroundChecks.length,
      everifyCaseCount: everifyCases.length,
      applicationsCount: prescreen.diagnostics.applicationsCount,
      interviewsCount: prescreen.diagnostics.interviewsCount,
      prescreenSuppressedByFreshness: prescreen.diagnostics.suppressedByFreshness,
    },
  };
}

// ---------------------------------------------------------------------------
// Pending assignments — `tenants/{tid}/assignments` where userId == uid AND
// status awaiting AND no confirmedAt/declinedAt.
// ---------------------------------------------------------------------------

async function loadPendingAssignments(
  db: admin.firestore.Firestore,
  tenantId: string,
  uid: string,
): Promise<WorkerDashboardPendingAssignment[]> {
  try {
    const snap = await db
      .collection(`tenants/${tenantId}/assignments`)
      .where('userId', '==', uid)
      .get();
    const out: WorkerDashboardPendingAssignment[] = [];
    snap.forEach((doc) => {
      const data = doc.data() as Record<string, unknown>;
      if (!assignmentDocNeedsWorkerConfirmation(data)) return;
      out.push({ assignmentId: doc.id, startAtMs: assignmentStartAtMs(data) });
    });
    return out;
  } catch (err) {
    logger.warn('workerDashboardActionItemsV1: assignments query failed', {
      tenantId,
      uid,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Mirrors `assignmentDocNeedsWorkerConfirmation` in `src/utils/workerJobRequirementSignals.ts`. */
export function assignmentDocNeedsWorkerConfirmation(data: Record<string, unknown>): boolean {
  const st = String(data.status || '').toLowerCase();
  if (!ASSIGNMENT_AWAITING_STATUSES.has(st)) return false;
  if (data.confirmedAt || data.declinedAt) return false;
  return true;
}

function assignmentStartAtMs(data: Record<string, unknown>): number {
  const startDate = data.startDate;
  const startTime = (data.startTime as string) || '00:00';
  if (!startDate) return 0;
  let dateStr = '';
  if (typeof startDate === 'string') {
    dateStr = startDate;
  } else if (typeof (startDate as { toDate?: () => Date }).toDate === 'function') {
    try {
      dateStr = (startDate as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
    } catch {
      dateStr = '';
    }
  }
  if (!dateStr) return 0;
  const iso = `${dateStr}T${String(startTime).slice(0, 5)}:00`;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

// ---------------------------------------------------------------------------
// Background checks — top-level `backgroundChecks` where candidateId == uid
// AND tenantId == tenantId.
// ---------------------------------------------------------------------------

async function loadBackgroundChecks(
  db: admin.firestore.Firestore,
  tenantId: string,
  uid: string,
): Promise<Array<Record<string, unknown>>> {
  try {
    const snap = await db
      .collection('backgroundChecks')
      .where('candidateId', '==', uid)
      .where('tenantId', '==', tenantId)
      .limit(BACKGROUND_CHECKS_LIMIT)
      .get();
    return snap.docs.map((d) => d.data() as Record<string, unknown>);
  } catch (err) {
    logger.warn('workerDashboardActionItemsV1: backgroundChecks query failed', {
      tenantId,
      uid,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// E-Verify cases — `tenants/{tid}/everify_cases` where userId == uid.
// ---------------------------------------------------------------------------

async function loadEverifyCases(
  db: admin.firestore.Firestore,
  tenantId: string,
  uid: string,
): Promise<Array<Record<string, unknown>>> {
  try {
    const snap = await db
      .collection(`tenants/${tenantId}/everify_cases`)
      .where('userId', '==', uid)
      .limit(EVERIFY_CASES_LIMIT)
      .get();
    return snap.docs.map((d) => d.data() as Record<string, unknown>);
  } catch (err) {
    logger.warn('workerDashboardActionItemsV1: everify_cases query failed', {
      tenantId,
      uid,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Compliance derivation — port of
// `src/utils/workerComplianceActionDerivers.ts:deriveWorkerComplianceSignals`.
// ---------------------------------------------------------------------------

const EVERIFY_WORKER_ACTION_STATUSES = new Set(['tnc', 'further_action_required']);

function serviceLineLooksDrug(name: unknown): boolean {
  const n = String(name || '').toLowerCase();
  return (
    n.includes('drug') ||
    n.includes('urine') ||
    n.includes('9 panel') ||
    n.includes('5 panel') ||
    n.includes('dot drug')
  );
}

function statusSuggestsDrugReschedule(status: unknown): boolean {
  const s = String(status || '').toLowerCase();
  return (
    s.includes('no show') ||
    s.includes('no-show') ||
    s.includes('missed') ||
    s.includes('reschedule') ||
    s.includes('expired appointment')
  );
}

function statusSuggestsDrugScheduleNeeded(status: unknown): boolean {
  const s = String(status || '').toLowerCase();
  if (!s) return false;
  return (
    s.includes('schedule') ||
    s.includes('scheduling') ||
    s.includes('appointment needed') ||
    s.includes('needs appointment')
  );
}

const HRX_NO_PORTAL_CTA_STATUSES = new Set([
  'completed',
  'report_ready',
  'drug_report_ready',
  'canceled',
  'error',
]);

function shouldShowApplicantPortalCta(rec: Record<string, unknown>): boolean {
  const hrx = String(rec.hrxStatus || '').toLowerCase();
  if (!hrx || hrx === 'draft' || hrx === 'queued') return false;
  if (HRX_NO_PORTAL_CTA_STATUSES.has(hrx)) return false;
  if (rec.orderCompleted === true || rec.finalReportReady === true) return false;
  if (hrx !== 'awaiting_applicant') return false;
  const url =
    typeof rec.applicantPortalUrl === 'string' && rec.applicantPortalUrl.trim().length > 0
      ? rec.applicantPortalUrl.trim()
      : typeof rec.applicantPortalLink === 'string' && rec.applicantPortalLink.trim().length > 0
        ? rec.applicantPortalLink.trim()
        : '';
  return Boolean(url);
}

export function deriveWorkerComplianceSignals(
  backgroundChecks: Array<Record<string, unknown>>,
  everifyCases: Array<Record<string, unknown>>,
): WorkerDashboardComplianceSignals {
  let backgroundApplicantAction = false;
  let backgroundIssueAction = false;
  let drugScheduleRequired = false;
  let drugRescheduleRequired = false;
  let everifyWorkerAction = false;

  for (const ev of everifyCases) {
    const st = String(ev.status || '').toLowerCase();
    if (EVERIFY_WORKER_ACTION_STATUSES.has(st)) everifyWorkerAction = true;
  }

  for (const c of backgroundChecks) {
    const hrx = String(c.hrxStatus || '').toLowerCase();
    if (hrx === 'error') {
      backgroundIssueAction = true;
      continue;
    }

    const pkg = String(c.requestedPackageName || '').toLowerCase();
    const pkgDrug = serviceLineLooksDrug(pkg);

    const last = (c.lastServiceComponent || null) as Record<string, unknown> | null;
    const lastName = last?.serviceName;
    const lastStatus = last?.status;
    const lineDrug = pkgDrug || serviceLineLooksDrug(lastName);

    if (lineDrug && lastStatus != null && statusSuggestsDrugReschedule(lastStatus)) {
      drugRescheduleRequired = true;
    }
    if (lineDrug && lastStatus != null && statusSuggestsDrugScheduleNeeded(lastStatus)) {
      drugScheduleRequired = true;
    }

    if (hrx === 'awaiting_applicant') {
      if (lineDrug) {
        drugScheduleRequired = true;
      } else if (shouldShowApplicantPortalCta(c)) {
        backgroundApplicantAction = true;
      }
    }

    const svcMap = (c.providerServiceOrderStatus || null) as
      | Record<string, Record<string, unknown>>
      | null;
    if (svcMap && typeof svcMap === 'object') {
      for (const entry of Object.values(svcMap)) {
        const sn = entry?.serviceName;
        const st = entry?.status;
        if (!serviceLineLooksDrug(sn)) continue;
        if (statusSuggestsDrugReschedule(st)) drugRescheduleRequired = true;
        if (statusSuggestsDrugScheduleNeeded(st)) drugScheduleRequired = true;
      }
    }
  }

  if (drugRescheduleRequired) drugScheduleRequired = false;

  return {
    backgroundApplicantAction,
    backgroundIssueAction,
    drugScheduleRequired,
    drugRescheduleRequired,
    everifyWorkerAction,
  };
}

// ---------------------------------------------------------------------------
// TempWorks — port of
// `src/utils/workerJobRequirementSignals.ts:readTempworksOnboardingFromUserDoc`.
// ---------------------------------------------------------------------------

export function readTempworksOnboardingFromUserDoc(
  userDoc: Record<string, unknown> | null,
): WorkerDashboardTempworksSignals | undefined {
  if (!userDoc) return undefined;
  const ob = (userDoc.onboarding as Record<string, unknown>) || {};
  const required = ob.tempworksOnboardingRequired === true;
  if (!required) return undefined;
  const recruiterVerified = ob.tempworksRecruiterVerified === true || ob.tempworksVerified === true;
  const startedAt = ob.tempworksStartedAt;
  let started = false;
  if (startedAt != null && startedAt !== '') {
    if (typeof startedAt === 'string') started = startedAt.trim().length > 0;
    else if (typeof startedAt === 'number') started = Number.isFinite(startedAt);
    else if (
      typeof startedAt === 'object' &&
      typeof (startedAt as { toMillis?: () => number }).toMillis === 'function'
    ) {
      started = true;
    }
  }
  const onboardingUrl =
    typeof ob.tempworksOnboardingUrl === 'string' && ob.tempworksOnboardingUrl.trim()
      ? ob.tempworksOnboardingUrl.trim()
      : null;
  return { required, recruiterVerified, started, onboardingUrl };
}

// ---------------------------------------------------------------------------
// AI Prescreen — port of `useWorkerAiPrescreenSurfaceSignals` +
// `buildWorkerAiPrescreenDashboardActions`. Returns at most one card.
// ---------------------------------------------------------------------------

interface PrescreenLoaderResult {
  signals: WorkerDashboardPrescreenSignals;
  diagnostics: {
    applicationsCount: number;
    interviewsCount: number;
    suppressedByFreshness: boolean;
  };
}

async function loadPrescreenSignals(
  db: admin.firestore.Firestore,
  tenantId: string,
  uid: string,
): Promise<PrescreenLoaderResult> {
  try {
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    const tenantData = (tenantSnap.exists ? tenantSnap.data() : {}) as Record<string, unknown>;
    const outreachOn = tenantData.workerAiPrescreenOutreachEnabled !== false;

    const appCol = db.collection(`tenants/${tenantId}/applications`);
    const [byUserId, byCandidateId] = await Promise.all([
      appCol.where('userId', '==', uid).limit(APPLICATIONS_LIMIT).get(),
      appCol.where('candidateId', '==', uid).limit(APPLICATIONS_LIMIT).get(),
    ]);

    const merged = new Map<string, { id: string; data: Record<string, unknown> }>();
    byUserId.docs.forEach((d) =>
      merged.set(d.id, { id: d.id, data: d.data() as Record<string, unknown> }),
    );
    byCandidateId.docs.forEach((d) =>
      merged.set(d.id, { id: d.id, data: d.data() as Record<string, unknown> }),
    );
    const applications = Array.from(merged.values());

    const interviewsSnap = await db
      .collection(`users/${uid}/interviews`)
      .limit(INTERVIEWS_LIMIT)
      .get();
    const interviews = interviewsSnap.docs.map((d) => d.data() as Record<string, unknown>);

    const completedApplicationIds = interviewApplicationIdsFromUserInterviews(interviews);
    const latestPrescreenAtMs = latestWorkerAiPrescreenInterviewAtMs(interviews);
    const nowMs = Date.now();
    const suppressedByFreshness =
      latestPrescreenAtMs > 0 && nowMs - latestPrescreenAtMs < PRESCREEN_FRESHNESS_WINDOW_MS;

    if (!outreachOn || suppressedByFreshness) {
      return {
        signals: { items: [] },
        diagnostics: {
          applicationsCount: applications.length,
          interviewsCount: interviews.length,
          suppressedByFreshness,
        },
      };
    }

    // Container fetch parity — only consider applications whose container
    // (job_order or group) actually requires prescreen. Tenant-level value
    // is the default.
    const jobOrderIds = new Set<string>();
    const groupIds = new Set<string>();
    for (const a of applications) {
      const jo = String(a.data.jobOrderId || '').trim();
      const gid = String(a.data.groupId || '').trim();
      if (jo) jobOrderIds.add(jo);
      if (gid) groupIds.add(gid);
    }
    const jobOrderDocs = new Map<string, Record<string, unknown>>();
    const groupDocs = new Map<string, Record<string, unknown>>();
    await Promise.all([
      ...Array.from(jobOrderIds).map(async (id) => {
        try {
          const s = await db.doc(`tenants/${tenantId}/job_orders/${id}`).get();
          if (s.exists) jobOrderDocs.set(id, s.data() as Record<string, unknown>);
        } catch {
          /* ignore — fall back to tenant default */
        }
      }),
      ...Array.from(groupIds).map(async (id) => {
        try {
          const s = await db.doc(`tenants/${tenantId}/groups/${id}`).get();
          if (s.exists) groupDocs.set(id, s.data() as Record<string, unknown>);
        } catch {
          /* ignore — fall back to tenant default */
        }
      }),
    ]);

    const requiredForApplication = (app: { id: string; data: Record<string, unknown> }): boolean => {
      const jo = String(app.data.jobOrderId || '').trim();
      const gid = String(app.data.groupId || '').trim();
      const container = jo
        ? jobOrderDocs.get(jo) || null
        : gid
          ? groupDocs.get(gid) || null
          : null;
      return mergeResolvedHiringInterviewRequired(tenantData, container);
    };

    const item = pickPrescreenDashboardItem(applications, completedApplicationIds);
    if (!item) {
      return {
        signals: { items: [] },
        diagnostics: {
          applicationsCount: applications.length,
          interviewsCount: interviews.length,
          suppressedByFreshness: false,
        },
      };
    }
    const filtered = (() => {
      const aid = item.qaEvaluatedFields?.applicationId;
      if (typeof aid !== 'string' || !aid) return [item];
      const row = merged.get(aid);
      if (!row) return [item];
      return requiredForApplication(row) ? [item] : [];
    })();

    return {
      signals: { items: filtered },
      diagnostics: {
        applicationsCount: applications.length,
        interviewsCount: interviews.length,
        suppressedByFreshness: false,
      },
    };
  } catch (err) {
    logger.warn('workerDashboardActionItemsV1: prescreen load failed', {
      tenantId,
      uid,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      signals: { items: [] },
      diagnostics: { applicationsCount: 0, interviewsCount: 0, suppressedByFreshness: false },
    };
  }
}

function tsMillis(v: unknown): number {
  if (v == null) return 0;
  const t = v as { toMillis?: () => number };
  if (typeof t.toMillis === 'function') {
    try {
      return t.toMillis();
    } catch {
      return 0;
    }
  }
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return 0;
}

function interviewApplicationIdsFromUserInterviews(
  rows: Array<Record<string, unknown>>,
): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (String(r.interviewKind || '') !== 'worker_ai_prescreen') continue;
    const aid = String(r.applicationId || '').trim();
    if (aid) out.add(aid);
  }
  return out;
}

function latestWorkerAiPrescreenInterviewAtMs(rows: Array<Record<string, unknown>>): number {
  let latest = 0;
  for (const r of rows) {
    if (String(r.interviewKind || '') !== 'worker_ai_prescreen') continue;
    const t = tsMillis(r.submittedAt) || tsMillis(r.timestamp) || tsMillis(r.createdAt);
    if (t > latest) latest = t;
  }
  return latest;
}

function pickPrescreenDashboardItem(
  applications: Array<{ id: string; data: Record<string, unknown> }>,
  completedApplicationIds: Set<string>,
): WorkerDashboardActionItemV1 | null {
  const submitted = applications.filter(
    (a) => String(a.data.status || '').toLowerCase() === 'submitted',
  );
  const candidates = submitted.filter((a) => {
    if (!a.data.workerAiPrescreenReminderSentAt) return false;
    if (completedApplicationIds.has(a.id)) return false;
    const outcome = String(a.data.workerAiPrescreenReminderLastOutcome || '');
    return (
      outcome === 'eligible_invite' ||
      outcome === 'ineligible_nudge' ||
      outcome === 'combined_first_touch'
    );
  });
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      tsMillis(a.data.workerAiPrescreenReminderSentAt) -
      tsMillis(b.data.workerAiPrescreenReminderSentAt),
  );
  const pick = candidates[0];
  const outcome = String(pick.data.workerAiPrescreenReminderLastOutcome || '');

  if (outcome === 'eligible_invite' || outcome === 'combined_first_touch') {
    return {
      id: 'worker_ai_prescreen_interview',
      category: 'important',
      titleKey: 'dashboard.actionItems.aiPrescreenInterviewTitle',
      descriptionKey: 'dashboard.actionItems.aiPrescreenInterviewDescription',
      primaryLabelKey: 'dashboard.actionItems.aiPrescreenInterviewPrimary',
      primaryKind: 'navigate',
      href: `${C1_WORKER_AI_PRESCREEN_PATH}?applicationId=${encodeURIComponent(pick.id)}&entry=dashboard_cta`,
      priorityScore: WORKER_DASHBOARD_ACTION_ITEM_PRIORITY_SCORES.worker_ai_prescreen_interview,
      sourceReason: 'AI pre-screen SMS sent; interview not completed for application',
      qaEvaluatedFields: { applicationId: pick.id },
    };
  }

  return {
    id: 'worker_ai_prescreen_complete_profile',
    category: 'important',
    titleKey: 'dashboard.actionItems.aiPrescreenProfileTitle',
    descriptionKey: 'dashboard.actionItems.aiPrescreenProfileDescription',
    primaryLabelKey: 'dashboard.actionItems.aiPrescreenProfilePrimary',
    primaryKind: 'navigate',
    href: '/c1/workers/profile',
    priorityScore:
      WORKER_DASHBOARD_ACTION_ITEM_PRIORITY_SCORES.worker_ai_prescreen_complete_profile,
    sourceReason: 'AI pre-screen profile-completion SMS sent',
    qaEvaluatedFields: { applicationId: pick.id },
  };
}

/**
 * Mirrors `mergeResolvedHiringInterview` (web). Tenant default → container
 * override. Default is `true` when neither side specifies — matches the
 * client default in `src/utils/mergeResolvedHiringInterview.ts`.
 */
function mergeResolvedHiringInterviewRequired(
  tenant: Record<string, unknown>,
  container: Record<string, unknown> | null,
): boolean {
  let required = true;
  for (const doc of [tenant, container]) {
    if (!doc) continue;
    const hc = doc.hiringConfig as Record<string, unknown> | undefined;
    if (!hc || typeof hc !== 'object') continue;
    const interview = hc.interview as Record<string, unknown> | undefined;
    if (!interview || typeof interview !== 'object') continue;
    if (typeof interview.workerAiPrescreenRequired === 'boolean') {
      required = interview.workerAiPrescreenRequired;
    }
  }
  return required;
}
