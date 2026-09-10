/**
 * Hourly job-order hiring plan sweep (Greg 2026-09-10, OnTrac). Rides
 * scheduledOrchestrator as the `job_order_hiring_plan_sweep` subtask — no
 * Cloud Run service of its own.
 *
 * For each OPEN job order with `hiringPlan.enabled`:
 *   1. gather the JO's live applicants (applications on the JO or on its
 *      postings; submitted / accepted / confirmed / waitlisted);
 *   2. run the user-based Tier 3 → 2 promotion for them (tenant mode
 *      'automatic' only) so a qualifying applicant can be hired this hour;
 *   3. read tier, scorecard, employment at the JO's hiring entity, and
 *      screening state for the JO's package;
 *   4. selectHiringPlanActions → on-call onboarding with the package, or a
 *      screening-only order for applicants already employed;
 *   5. write run stats to job_orders/{jo}/hiring_plan/state — never to the
 *      JO doc itself, which eight triggers listen on.
 *
 * Duplicate safety:
 *   - employment and screening are re-read every run, and a successful
 *     onboarding is remembered on the attempt log, so a worker the plan
 *     hired is a pool member and never re-onboarded (re-running the on-call
 *     flow would re-send the payroll invite);
 *   - a package order is placed only when there is no completed, still-valid
 *     order for the same package and no in-flight order of any package (the
 *     in-flight-duplicate class of the 2026-06-03 Dempsey incident);
 *     AccuSource's own duplicate guard still runs underneath;
 *   - attempts are logged per worker at job_orders/{jo}/hiring_plan_hires/
 *     {uid}: a failure waits RETRY_AFTER_MS, MAX_ATTEMPTS failures or a
 *     screening pause leave the worker for a recruiter.
 *
 * previewJobOrderHiringPlan runs the same gathering and selection as a dry
 * run: no promotions, onboarding, orders or state writes.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  evaluateScreeningSatisfiedServer,
  mergeScreeningPackageFromLayers,
  requestedEquivalencyKey,
} from '../compliance/screeningAutomationShared';
import type { BgLike, ScreeningPackageMergeResult } from '../compliance/screeningAutomationShared';
import { writeOnboardingAutomationDispatchLog } from '../messaging/onboardingAutomationDispatchLog';
import { runStartOnCallEmploymentFlow } from '../onboarding/startOnCallEmployment';
import {
  extractTierScoreSignals,
  normalizeTierAutomationConfig,
  scoreTierPromotion,
} from '../shared/workerTierScoring';
import {
  promoteToTier2IfQualified,
  resolveGlobalTier,
  screeningCompletionsFromOrders,
} from './applicantPromotion';
import type { TierConfig } from './applicantPromotion';
import { normalizeHiringPlan, selectHiringPlanActions } from './jobOrderHiringPlan';
import type { HiringPlanAction, HiringPlanCandidate } from './jobOrderHiringPlan';

const SYSTEM_ACTOR = 'system:job_order_hiring_plan';
const LIVE_APPLICATION_STATUSES = new Set(['submitted', 'accepted', 'confirmed', 'waitlisted']);
const INACTIVE_EMPLOYMENT_STATUSES = new Set(['terminated', 'inactive']);
const TERMINAL_ORDER_STATUSES = new Set(['canceled', 'cancelled', 'error', 'expired']);
const SCREENING_PAUSE_CODES = new Set(['screening_already_satisfied', 'screening_items_already_passed']);
const MAX_PLANS_PER_TENANT = 50;
const MAX_APPLICATIONS_PER_JOB_ORDER = 1000;
const MAX_PROMOTION_CHECKS_PER_JOB_ORDER = 300;
const MAX_ACTIONS_PER_JOB_ORDER_PER_RUN = 15;
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const SWEEP_BUDGET_MS = 90_000;

export interface HiringPlanSweepTotals {
  tenants: number;
  plans: number;
  applicants: number;
  promoted: number;
  onboardsStarted: number;
  screeningsOrdered: number;
  failures: number;
  errors: number;
}

export interface HiringPlanRunResult {
  stats: Record<string, unknown>;
  actions: HiringPlanAction[];
}

const emptyTotals = (): HiringPlanSweepTotals => ({
  tenants: 0,
  plans: 0,
  applicants: 0,
  promoted: 0,
  onboardsStarted: 0,
  screeningsOrdered: 0,
  failures: 0,
  errors: 0,
});

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function toMillis(v: unknown): number | null {
  if (v && typeof (v as { toMillis?: unknown }).toMillis === 'function') {
    return (v as admin.firestore.Timestamp).toMillis();
  }
  if (typeof v === 'string' || typeof v === 'number') {
    const n = new Date(v).getTime();
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function readData(
  db: admin.firestore.Firestore,
  path: string,
): Promise<Record<string, unknown> | null> {
  const snap = await db.doc(path).get();
  return snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null;
}

const workerName = (u: Record<string, unknown>, uid: string): string =>
  `${str(u.firstName)} ${str(u.lastName)}`.trim() || str(u.displayName) || uid;

interface PlanApplicant {
  userId: string;
  applicationId: string;
  appliedAtMs: number;
}

/** One row per worker (their earliest live application) across the JO and its postings. */
async function collectApplicants(
  db: admin.firestore.Firestore,
  tenantId: string,
  jobOrderId: string,
): Promise<{ applicants: PlanApplicant[]; truncated: boolean }> {
  const apps = db.collection(`tenants/${tenantId}/applications`);
  const postings = await db
    .collection(`tenants/${tenantId}/job_postings`)
    .where('jobOrderId', '==', jobOrderId)
    .limit(100)
    .get();
  const snaps: admin.firestore.QuerySnapshot[] = [
    await apps.where('jobOrderId', '==', jobOrderId).limit(MAX_APPLICATIONS_PER_JOB_ORDER).get(),
  ];
  for (const ids of chunk(postings.docs.map((d) => d.id), 30)) {
    // eslint-disable-next-line no-await-in-loop
    snaps.push(await apps.where('jobId', 'in', ids).limit(MAX_APPLICATIONS_PER_JOB_ORDER).get());
  }
  const truncated = snaps.some((s) => s.size >= MAX_APPLICATIONS_PER_JOB_ORDER);

  const byUser = new Map<string, PlanApplicant>();
  for (const snap of snaps) {
    snap.forEach((d) => {
      const a = d.data() as Record<string, unknown>;
      if (!LIVE_APPLICATION_STATUSES.has(str(a.status).toLowerCase())) return;
      const userId = str(a.userId ?? a.candidateId ?? a.uid);
      if (!userId) return;
      const appliedAtMs =
        toMillis(a.submittedAt) ?? toMillis(a.appliedAt) ?? toMillis(a.createdAt) ?? Number.MAX_SAFE_INTEGER;
      const prev = byUser.get(userId);
      if (!prev || appliedAtMs < prev.appliedAtMs) byUser.set(userId, { userId, applicationId: d.id, appliedAtMs });
    });
  }
  return { applicants: [...byUser.values()], truncated };
}

function isCompletedOrder(o: Record<string, unknown>): boolean {
  const s = str(o.hrxStatus);
  return o.orderCompleted === true || o.finalReportReady === true || s === 'completed' || s === 'report_ready';
}

function isTerminalOrder(o: Record<string, unknown>): boolean {
  return (
    o.expired === true ||
    TERMINAL_ORDER_STATUSES.has(str(o.providerStatus).toLowerCase()) ||
    TERMINAL_ORDER_STATUSES.has(str(o.hrxStatus).toLowerCase())
  );
}

function screeningStateFor(
  orders: Array<Record<string, unknown>>,
  packageKey: string | null,
): { satisfied: boolean; inFlight: boolean } {
  const inFlight = orders.some((o) => !isCompletedOrder(o) && !isTerminalOrder(o));
  const satisfied =
    packageKey != null &&
    orders.some(
      (o) =>
        evaluateScreeningSatisfiedServer(o as BgLike, {
          requestedEquivalencyKey: packageKey,
          enforceEquivalency: true,
          enforceValidityWindow: true,
        }).satisfied,
    );
  return { satisfied, inFlight };
}

interface AttemptRecord {
  attempts: number;
  lastAttemptAtMs: number | null;
  status: string;
  onboarded: boolean;
}

function isBlocked(rec: AttemptRecord | undefined, nowMs: number): boolean {
  if (!rec || rec.status === 'ok') return false;
  if (rec.status === 'screening_paused' || rec.attempts >= MAX_ATTEMPTS) return true;
  return rec.lastAttemptAtMs != null && nowMs - rec.lastAttemptAtMs < RETRY_AFTER_MS;
}

async function orderScreeningOnly(
  db: admin.firestore.Firestore,
  args: {
    tenantId: string;
    userId: string;
    entityId: string;
    jobOrderId: string;
    packageId: string;
    packageName: string;
  },
): Promise<string> {
  const { tenantId, userId, entityId, jobOrderId, packageId, packageName } = args;
  const entity = (await readData(db, `tenants/${tenantId}/entities/${entityId}`)) ?? {};
  const entityName = str(entity.name) || str(entity.legalName) || entityId;
  const userSnap = await db.doc(`users/${userId}`).get();
  const u: admin.firestore.DocumentData = userSnap.data() ?? {};
  const candidate = {
    firstName: String(u.firstName || ''),
    lastName: String(u.lastName || ''),
    email: String(u.email || ''),
    phone: String(u.phoneE164 || u.phone || ''),
    dateOfBirth: u.dateOfBirth ?? u.dob,
  };
  const { createBackgroundCheckInternal } = await import('../integrations/accusource/createBackgroundCheck');
  const result = await createBackgroundCheckInternal(
    {
      tenantId,
      accountId: str(entity.accusourceAccountId) || str(entity.accountId) || undefined,
      accountName: entityName,
      candidateId: userId,
      candidateName:
        [candidate.firstName, candidate.lastName].filter(Boolean).join(' ').trim() || candidate.email || userId,
      requestedPackageId: packageId,
      requestedPackageName: packageName || undefined,
      candidate,
    },
    SYSTEM_ACTOR,
    { type: 'callable', auth: {} },
  );
  await db.collection('backgroundChecks').doc(result.backgroundCheckId).set(
    {
      automationSource: 'job_order_hiring_plan',
      automationTenantId: tenantId,
      automationHiringEntityId: entityId,
      automationJobOrderId: jobOrderId,
    },
    { merge: true },
  );
  await writeOnboardingAutomationDispatchLog({
    tenantId,
    eventType: 'on_call_screening_ordered',
    correlationKey: `job_order_hiring_plan_screening__${tenantId}__${result.backgroundCheckId}`,
    assignmentId: '',
    userId,
    outcome: 'sent',
    hiringEntityId: entityId,
    details: {
      backgroundCheckId: result.backgroundCheckId,
      packageId,
      jobOrderId,
      source: 'job_order_hiring_plan',
    },
  });
  return result.backgroundCheckId;
}

type ActionOutcome = 'onboarded' | 'screening_ordered' | 'screening_paused' | 'failed';

async function executeAction(
  db: admin.firestore.Firestore,
  args: {
    tenantId: string;
    jobOrderId: string;
    jobOrderLabel: string;
    entityId: string;
    pkg: ScreeningPackageMergeResult;
    action: HiringPlanAction;
    candidate: HiringPlanCandidate;
    name: string;
    logExists: boolean;
  },
): Promise<ActionOutcome> {
  const { tenantId, jobOrderId, entityId, pkg, action, candidate } = args;
  const FieldValue = admin.firestore.FieldValue;
  const logRef = db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}/hiring_plan_hires/${action.userId}`);
  await logRef.set(
    {
      userId: action.userId,
      applicationId: action.applicationId,
      name: args.name,
      tier: action.tier,
      kind: action.kind,
      status: 'started',
      attempts: FieldValue.increment(1),
      lastAttemptAt: FieldValue.serverTimestamp(),
      error: FieldValue.delete(),
      ...(args.logExists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  );

  const needsPackage = !candidate.screeningDone;
  try {
    if (action.kind === 'onboard_and_screen') {
      const result = await runStartOnCallEmploymentFlow({
        tenantId,
        userId: action.userId,
        entityId,
        workerType: 'entity_default',
        initiatedByUid: SYSTEM_ACTOR,
        triggerSource: 'job_order_hiring_plan',
        applicationId: action.applicationId,
        note: `Hiring plan for job order ${args.jobOrderLabel} (Tier ${action.tier})`,
        screeningPackageId: needsPackage && pkg.packageId ? pkg.packageId : null,
        screeningPackageName: needsPackage && pkg.packageId ? pkg.packageName || null : null,
        enforceOnCallOnboardingPolicy: true,
      });
      await logRef.set(
        {
          status: 'ok',
          onboarded: true,
          onboardedAt: FieldValue.serverTimestamp(),
          pipelineId: result.pipelineId,
          screeningRequested: Boolean(needsPackage && pkg.packageId),
          completedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return 'onboarded';
    }

    if (!pkg.packageId) {
      await logRef.set(
        {
          status: 'screening_paused',
          error: `The screening package "${pkg.packageName}" has no AccuSource package id — pick it again on the job order.`,
          completedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return 'screening_paused';
    }
    const backgroundCheckId = await orderScreeningOnly(db, {
      tenantId,
      userId: action.userId,
      entityId,
      jobOrderId,
      packageId: pkg.packageId,
      packageName: pkg.packageName,
    });
    await logRef.set(
      { status: 'ok', backgroundCheckId, completedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return 'screening_ordered';
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const code =
      e instanceof HttpsError ? str(((e.details ?? {}) as Record<string, unknown>).code) : '';
    const paused = SCREENING_PAUSE_CODES.has(code);
    await logRef.set(
      {
        status: paused ? 'screening_paused' : 'failed',
        error: message,
        completedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    logger.warn('jobOrderHiringPlanSweep: action failed', {
      tenantId,
      jobOrderId,
      userId: action.userId,
      kind: action.kind,
      paused,
      error: message,
    });
    return paused ? 'screening_paused' : 'failed';
  }
}

async function runPlanForJobOrder(
  db: admin.firestore.Firestore,
  args: {
    tenantId: string;
    jobOrderId: string;
    jobOrder: Record<string, unknown>;
    tierConfig: TierConfig;
    deadline: number;
    totals: HiringPlanSweepTotals;
    dryRun: boolean;
  },
): Promise<HiringPlanRunResult> {
  const { tenantId, jobOrderId, jobOrder, tierConfig, deadline, totals, dryRun } = args;
  const finish = async (
    stats: Record<string, unknown>,
    actions: HiringPlanAction[] = [],
  ): Promise<HiringPlanRunResult> => {
    if (!dryRun) {
      await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}/hiring_plan/state`).set({
        jobOrderId,
        lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
        stats,
      });
    }
    return { stats, actions };
  };

  const plan = normalizeHiringPlan(jobOrder.hiringPlan);
  const jobOrderLabel = str(jobOrder.jobOrderName) || str(jobOrder.jobTitle) || jobOrderId;
  const status = str(jobOrder.status).toLowerCase();
  if (status !== 'open') {
    return finish({ skipReason: `the job order is ${status || 'not open'}` });
  }

  const accountId = str(jobOrder.recruiterAccountId) || str(jobOrder.accountId);
  const account = accountId ? await readData(db, `tenants/${tenantId}/accounts/${accountId}`) : null;
  const parentId = str(account?.parentAccountId);
  const parent = parentId ? await readData(db, `tenants/${tenantId}/accounts/${parentId}`) : null;
  const entityId =
    str(jobOrder.hiringEntityId) || str(account?.hiringEntityId) || str(parent?.hiringEntityId);
  if (!entityId) {
    return finish({ skipReason: 'no hiring entity is set on the job order or its account' });
  }
  let pkg = mergeScreeningPackageFromLayers(jobOrder, undefined, account ?? undefined);
  if (!pkg.packageId && !pkg.packageName && parent) {
    pkg = mergeScreeningPackageFromLayers(undefined, undefined, parent);
  }
  const packageKey =
    pkg.packageId || pkg.packageName ? requestedEquivalencyKey(pkg.packageId, pkg.packageName) : null;

  const { applicants, truncated } = await collectApplicants(db, tenantId, jobOrderId);
  totals.applicants += applicants.length;
  if (truncated) logger.warn('jobOrderHiringPlanSweep: applicants truncated', { tenantId, jobOrderId });
  const uids = applicants.map((a) => a.userId);

  const users = new Map<string, Record<string, unknown>>();
  for (const ids of chunk(uids, 100)) {
    // eslint-disable-next-line no-await-in-loop
    const snaps = await db.getAll(...ids.map((id) => db.doc(`users/${id}`)));
    snaps.forEach((s) => {
      if (s.exists) users.set(s.id, (s.data() ?? {}) as Record<string, unknown>);
    });
  }

  const ordersByUid = new Map<string, Array<Record<string, unknown>>>();
  const employedUids = new Set<string>();
  for (const ids of chunk(uids, 30)) {
    // eslint-disable-next-line no-await-in-loop
    const [orderSnap, employmentSnap] = await Promise.all([
      db.collection('backgroundChecks').where('candidateId', 'in', ids).get(),
      db.collection(`tenants/${tenantId}/entity_employments`).where('userId', 'in', ids).get(),
    ]);
    orderSnap.forEach((d) => {
      const o = d.data() as Record<string, unknown>;
      if (str(o.tenantId) && str(o.tenantId) !== tenantId) return;
      const uid = str(o.candidateId);
      ordersByUid.set(uid, [...(ordersByUid.get(uid) ?? []), o]);
    });
    employmentSnap.forEach((d) => {
      const r = d.data() as Record<string, unknown>;
      if ((str(r.entityId) || str(r.hiringEntityId)) !== entityId) return;
      if (INACTIVE_EMPLOYMENT_STATUSES.has(str(r.status).toLowerCase())) return;
      employedUids.add(str(r.userId));
    });
  }

  const attempts = new Map<string, AttemptRecord>();
  const logSnap = await db.collection(`tenants/${tenantId}/job_orders/${jobOrderId}/hiring_plan_hires`).get();
  logSnap.forEach((d) => {
    const r = d.data() as Record<string, unknown>;
    attempts.set(d.id, {
      attempts: Number(r.attempts) || 0,
      lastAttemptAtMs: toMillis(r.lastAttemptAt),
      status: str(r.status),
      onboarded: r.onboarded === true,
    });
  });

  const now = new Date();
  const nowMs = now.getTime();
  let promoted = 0;
  let promotionChecks = 0;
  const candidates: HiringPlanCandidate[] = [];
  const names = new Map<string, string>();
  for (const a of applicants) {
    const u = users.get(a.userId);
    if (!u) continue;
    const orders = ordersByUid.get(a.userId) ?? [];
    const completions = screeningCompletionsFromOrders(orders);

    if (
      !dryRun &&
      tierConfig.mode === 'automatic' &&
      resolveGlobalTier(u) === 3 &&
      promotionChecks < MAX_PROMOTION_CHECKS_PER_JOB_ORDER
    ) {
      promotionChecks++;
      try {
        // eslint-disable-next-line no-await-in-loop
        const didPromote = await promoteToTier2IfQualified(db, {
          tenantId,
          uid: a.userId,
          userData: u,
          tierConfig,
          contextLabel: `job order ${jobOrderLabel}`,
          completions,
        });
        if (didPromote) {
          promoted++;
          u.workerTiers = { ...((u.workerTiers as Record<string, unknown>) ?? {}), global: 2 };
        }
      } catch (e: unknown) {
        totals.errors++;
        logger.error('jobOrderHiringPlanSweep: promotion failed', {
          tenantId,
          uid: a.userId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const rec = attempts.get(a.userId);
    const screening = screeningStateFor(orders, packageKey);
    const score = scoreTierPromotion(
      extractTierScoreSignals(u, {
        backgroundCheckCompleted: completions.bg,
        drugScreenCompleted: completions.drug,
        appInstalled: null,
      }),
      tierConfig,
      now,
    ).total;
    candidates.push({
      userId: a.userId,
      applicationId: a.applicationId,
      tier: resolveGlobalTier(u),
      score,
      appliedAtMs: a.appliedAtMs,
      employed: employedUids.has(a.userId) || rec?.onboarded === true,
      screeningDone: packageKey == null || screening.satisfied || screening.inFlight,
      blocked: isBlocked(rec, nowMs),
    });
    names.set(a.userId, workerName(u, a.userId));
  }
  totals.promoted += promoted;

  const selection = selectHiringPlanActions(plan, candidates);
  const candidateByUid = new Map(candidates.map((c) => [c.userId, c]));
  const outcomes: Record<ActionOutcome, number> = {
    onboarded: 0,
    screening_ordered: 0,
    screening_paused: 0,
    failed: 0,
  };
  let deferred = 0;
  if (!dryRun) {
    for (let i = 0; i < selection.actions.length; i++) {
      if (i >= MAX_ACTIONS_PER_JOB_ORDER_PER_RUN || Date.now() > deadline) {
        deferred = selection.actions.length - i;
        break;
      }
      const action = selection.actions[i];
      // eslint-disable-next-line no-await-in-loop
      const outcome = await executeAction(db, {
        tenantId,
        jobOrderId,
        jobOrderLabel,
        entityId,
        pkg,
        action,
        candidate: candidateByUid.get(action.userId)!,
        name: names.get(action.userId) ?? action.userId,
        logExists: attempts.has(action.userId),
      });
      outcomes[outcome]++;
    }
  }
  totals.onboardsStarted += outcomes.onboarded;
  totals.screeningsOrdered += outcomes.screening_ordered;
  totals.failures += outcomes.failed + outcomes.screening_paused;

  return finish(
    {
      applicants: applicants.length,
      tier1: selection.tier1,
      tier2: selection.tier2,
      tier3: selection.tier3,
      promoted,
      poolTarget: selection.poolTarget,
      maxHires: selection.maxHires,
      tier2Quota: selection.tier2Quota,
      alreadyHired: selection.alreadyHired,
      projectedPool: selection.projectedPool,
      plannedActions: selection.actions.length,
      onboardsStarted: outcomes.onboarded,
      screeningsOrdered: outcomes.screening_ordered,
      screeningPaused: outcomes.screening_paused,
      failures: outcomes.failed,
      blockedSkipped: selection.blockedSkipped,
      deferred,
      truncated,
      hiringEntityId: entityId,
      screeningPackageId: pkg.packageId || null,
      screeningPackageName: pkg.packageName || null,
      tierPromotionMode: tierConfig.mode,
    },
    selection.actions,
  );
}

async function loadTierConfig(db: admin.firestore.Firestore, tenantId: string): Promise<TierConfig> {
  const snap = await db.doc(`tenants/${tenantId}/settings/tierAutomation`).get();
  return normalizeTierAutomationConfig(snap.data());
}

export async function previewJobOrderHiringPlan(
  db: admin.firestore.Firestore,
  tenantId: string,
  jobOrderId: string,
  planOverride?: Record<string, unknown>,
): Promise<HiringPlanRunResult> {
  const snap = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get();
  if (!snap.exists) throw new Error(`Job order ${jobOrderId} not found`);
  const jobOrder = (snap.data() ?? {}) as Record<string, unknown>;
  const hiringPlan = planOverride
    ? { ...((jobOrder.hiringPlan as Record<string, unknown> | undefined) ?? {}), ...planOverride }
    : jobOrder.hiringPlan;
  return runPlanForJobOrder(db, {
    tenantId,
    jobOrderId,
    jobOrder: { ...jobOrder, hiringPlan },
    tierConfig: await loadTierConfig(db, tenantId),
    deadline: Number.POSITIVE_INFINITY,
    totals: emptyTotals(),
    dryRun: true,
  });
}

export async function runJobOrderHiringPlanSweep(
  db: admin.firestore.Firestore,
): Promise<HiringPlanSweepTotals> {
  const totals = emptyTotals();
  const deadline = Date.now() + SWEEP_BUDGET_MS;
  const tenantsSnap = await db.collection('tenants').limit(100).get();
  for (const tenantDoc of tenantsSnap.docs) {
    const tenantId = tenantDoc.id;
    try {
      // eslint-disable-next-line no-await-in-loop
      const plansSnap = await db
        .collection(`tenants/${tenantId}/job_orders`)
        .where('hiringPlan.enabled', '==', true)
        .limit(MAX_PLANS_PER_TENANT)
        .get();
      if (plansSnap.empty) continue;
      totals.tenants++;
      // eslint-disable-next-line no-await-in-loop
      const tierConfig = await loadTierConfig(db, tenantId);

      for (const joDoc of plansSnap.docs) {
        if (Date.now() > deadline) {
          logger.warn('jobOrderHiringPlanSweep: time budget reached; remaining plans run next hour', {
            tenantId,
          });
          break;
        }
        totals.plans++;
        try {
          // eslint-disable-next-line no-await-in-loop
          await runPlanForJobOrder(db, {
            tenantId,
            jobOrderId: joDoc.id,
            jobOrder: joDoc.data() as Record<string, unknown>,
            tierConfig,
            deadline,
            totals,
            dryRun: false,
          });
        } catch (e: unknown) {
          totals.errors++;
          logger.error('jobOrderHiringPlanSweep: job order failed', {
            tenantId,
            jobOrderId: joDoc.id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    } catch (e: unknown) {
      totals.errors++;
      logger.error('jobOrderHiringPlanSweep: tenant failed', {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  logger.info('jobOrderHiringPlanSweep: done', { ...totals });
  return totals;
}
