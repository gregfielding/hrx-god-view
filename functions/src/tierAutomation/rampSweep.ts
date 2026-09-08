/**
 * Hourly account ramp sweep (Greg 2026-09-07: "qualified, interviewed,
 * and onboarded labor pool… before our human recruiters ever start
 * working the account"). NOT a Cloud Function of its own (Cloud Run
 * cap) — rides scheduledOrchestrator as the `tier_ramp_sweep` subtask.
 *
 * The application trigger (tier2AutoOnboard via
 * onApplicationHiringSignalsChangedAutoOnboard) handles NEW applications
 * in real time. This sweep covers everything the trigger cannot:
 *   1. EXISTING applicants when an account's throttle is first flipped
 *      on (their applications predate the opt-in — no write, no trigger);
 *   2. budget-capped skips (the trigger deliberately does not stamp on
 *      cap, so the next sweep after midnight retries);
 *   3. account-scoped Tier 3→2 auto-promotion for ramp accounts
 *      (`autoPromoteApplicants`): the tenant-wide nightly sweep may sit
 *      in 'propose' mode, but a ramp account has explicitly asked for
 *      automatic movement of ITS applicant pool — same shared scorer,
 *      same threshold config, same promotion/audit shape, and human
 *      decisions on proposals (dismissed/approved) are still respected.
 *
 * COST: tenants without opted-in accounts cost two account queries per
 * hour. Pool scans are capped (chunked 'in' queries; per-account query
 * caps below) — ramp accounts are new business with small pools by
 * nature; caps are logged when hit so a giant account fails loud.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import {
  extractTierScoreSignals,
  normalizeTierAutomationConfig,
  scoreTierPromotion,
} from '../shared/workerTierScoring';
import { maybeAutoOnboardTierTwoApplicant, resolveAutoOnboardPolicy } from './tier2AutoOnboard';

const ENGINE_ACTOR = { id: 'hrx-tier-engine', name: 'HRX Tier Engine' };
const SWEEP_STATUSES = new Set(['submitted', 'waitlisted']);
const MAX_JOB_DOCS_PER_ACCOUNT = 300;
const MAX_APPLICATIONS_PER_ACCOUNT = 600;
const MAX_ONBOARDS_PER_ACCOUNT_PER_RUN = 40;

export interface RampSweepTotals {
  tenants: number;
  accounts: number;
  pooledApplications: number;
  promoted: number;
  onboardsAttempted: number;
  errors: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function resolveGlobalTier(data: Record<string, unknown>): number {
  const tiers = (data.workerTiers ?? {}) as Record<string, unknown>;
  const g = Number(tiers.global);
  return g === 1 || g === 2 ? g : 3;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function hasAppPushToken(db: admin.firestore.Firestore, uid: string): Promise<boolean> {
  const snap = await db
    .collection('users')
    .doc(uid)
    .collection('pushTokens')
    .where('platform', 'in', ['iOS', 'Android', 'ios', 'android'])
    .limit(1)
    .get();
  return !snap.empty;
}

/** AccuSource completions for one candidate (same signals the nightly sweep maps tenant-wide). */
async function screeningCompletionsFor(
  db: admin.firestore.Firestore,
  tenantId: string,
  uid: string,
): Promise<{ bg: boolean; drug: boolean }> {
  const snap = await db
    .collection('backgroundChecks')
    .where('tenantId', '==', tenantId)
    .where('candidateId', '==', uid)
    .limit(25)
    .get();
  let bg = false;
  let drug = false;
  for (const d of snap.docs) {
    const b = d.data() as Record<string, unknown>;
    const hrxStatus = String(b.hrxStatus ?? '');
    if (b.finalReportReady === true || b.orderCompleted === true || hrxStatus === 'report_ready' || hrxStatus === 'completed') {
      bg = true;
    }
    if (b.drugReportReady === true || hrxStatus === 'drug_report_ready') drug = true;
  }
  return { bg, drug };
}

interface PooledApplication {
  applicationId: string;
  application: Record<string, unknown>;
  userId: string;
}

/** Applications on any of the account-family's postings/JOs, live statuses, not yet auto-onboarded. */
async function collectPool(
  db: admin.firestore.Firestore,
  tenantId: string,
  accountIds: string[],
): Promise<{ pool: PooledApplication[]; truncated: boolean }> {
  let truncated = false;
  const joIds = new Set<string>();
  const postIds = new Set<string>();
  for (const ids of chunk(accountIds, 30)) {
    for (const field of ['recruiterAccountId', 'accountId']) {
      // eslint-disable-next-line no-await-in-loop
      const s = await db
        .collection(`tenants/${tenantId}/job_orders`)
        .where(field, 'in', ids)
        .limit(MAX_JOB_DOCS_PER_ACCOUNT)
        .get();
      if (s.size >= MAX_JOB_DOCS_PER_ACCOUNT) truncated = true;
      s.forEach((d) => joIds.add(d.id));
    }
    // eslint-disable-next-line no-await-in-loop
    const p = await db
      .collection(`tenants/${tenantId}/job_postings`)
      .where('accountId', 'in', ids)
      .limit(MAX_JOB_DOCS_PER_ACCOUNT)
      .get();
    if (p.size >= MAX_JOB_DOCS_PER_ACCOUNT) truncated = true;
    p.forEach((d) => postIds.add(d.id));
  }

  const byId = new Map<string, PooledApplication>();
  const addApps = (snap: admin.firestore.QuerySnapshot): void => {
    snap.forEach((d) => {
      const a = d.data() as Record<string, unknown>;
      if (!SWEEP_STATUSES.has(str(a.status).toLowerCase())) return;
      if (a.tierAutoOnboard) return; // already handled (or failed once — one attempt)
      const userId = str(a.userId ?? a.candidateId ?? a.uid);
      if (!userId) return;
      byId.set(d.id, { applicationId: d.id, application: a, userId });
    });
  };
  const apps = db.collection(`tenants/${tenantId}/applications`);
  for (const ids of chunk([...joIds], 30)) {
    if (byId.size >= MAX_APPLICATIONS_PER_ACCOUNT) { truncated = true; break; }
    // eslint-disable-next-line no-await-in-loop
    addApps(await apps.where('jobOrderId', 'in', ids).limit(MAX_APPLICATIONS_PER_ACCOUNT).get());
  }
  for (const ids of chunk([...postIds], 30)) {
    if (byId.size >= MAX_APPLICATIONS_PER_ACCOUNT) { truncated = true; break; }
    // eslint-disable-next-line no-await-in-loop
    addApps(await apps.where('jobId', 'in', ids).limit(MAX_APPLICATIONS_PER_ACCOUNT).get());
  }
  return { pool: [...byId.values()], truncated };
}

/** Account-scoped automatic Tier 3→2 promotion, same shape as the nightly sweep's automatic mode. */
async function maybePromoteForRamp(
  db: admin.firestore.Firestore,
  tenantId: string,
  uid: string,
  userData: Record<string, unknown>,
  tierConfig: ReturnType<typeof normalizeTierAutomationConfig>,
  accountLabel: string,
): Promise<boolean> {
  const proposalRef = db.doc(`tenants/${tenantId}/tier_promotion_proposals/${uid}`);
  const proposalSnap = await proposalRef.get();
  const proposalStatus = str((proposalSnap.data() ?? {}).status);
  // A human already ruled on this worker — the ramp never overrides.
  if (proposalStatus === 'dismissed' || proposalStatus === 'approved') return false;

  const now = new Date();
  const { bg, drug } = await screeningCompletionsFor(db, tenantId, uid);
  const baseOpts = { backgroundCheckCompleted: bg, drugScreenCompleted: drug };
  let card = scoreTierPromotion(
    extractTierScoreSignals(userData, { ...baseOpts, appInstalled: null }),
    tierConfig,
    now,
  );
  const appFactorActive = now.toISOString().slice(0, 10) >= tierConfig.appInstalledEffectiveFrom;
  if (appFactorActive && !card.qualifies && card.total + tierConfig.points.appInstalled >= tierConfig.threshold) {
    const installed = await hasAppPushToken(db, uid);
    card = scoreTierPromotion(
      extractTierScoreSignals(userData, { ...baseOpts, appInstalled: installed }),
      tierConfig,
      now,
    );
  }
  if (!card.qualifies) return false;

  const name =
    `${str(userData.firstName)} ${str(userData.lastName)}`.trim() || str(userData.displayName) || uid;
  const batch = db.batch();
  batch.update(db.doc(`users/${uid}`), {
    'workerTiers.global': 2,
    'workerTiers.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
    'workerTiers.lastChange': {
      from: 3,
      to: 2,
      at: admin.firestore.Timestamp.now(),
      byId: ENGINE_ACTOR.id,
      byName: ENGINE_ACTOR.name,
      source: 'auto_threshold',
      reason: `Scorecard ${card.total}/${card.maxPossible}, threshold ${card.threshold} (ramp account: ${accountLabel})`,
    },
  });
  batch.set(db.collection(`users/${uid}/activityLogs`).doc(), {
    action: 'Tier Change',
    actionType: 'security_change',
    description: `Tier changed from Tier 3 to Tier 2 by ${ENGINE_ACTOR.name} (ramp-account threshold promotion, ${accountLabel}) — scorecard ${card.total}/${card.maxPossible}, threshold ${card.threshold}`,
    severity: 'low',
    source: 'system',
    metadata: {
      targetType: 'workerTier',
      from: 3,
      to: 2,
      changeSource: 'auto_threshold',
      changedById: ENGINE_ACTOR.id,
      changedByName: ENGINE_ACTOR.name,
      rampAccount: accountLabel,
    },
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  batch.set(
    proposalRef,
    {
      uid,
      name,
      status: 'auto_applied',
      scorecard: {
        total: card.total,
        maxPossible: card.maxPossible,
        threshold: card.threshold,
        factors: card.factors.map((f) => ({ key: f.key, label: f.label, earned: f.earned, max: f.max, detail: f.detail })),
      },
      appliedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastEvaluatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: proposalSnap.exists
        ? ((proposalSnap.data() ?? {}).createdAt ?? admin.firestore.FieldValue.serverTimestamp())
        : admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await batch.commit();
  return true;
}

export async function runTierRampSweep(db: admin.firestore.Firestore): Promise<RampSweepTotals> {
  const totals: RampSweepTotals = {
    tenants: 0,
    accounts: 0,
    pooledApplications: 0,
    promoted: 0,
    onboardsAttempted: 0,
    errors: 0,
  };
  const tenantsSnap = await db.collection('tenants').limit(100).get();
  for (const tenantDoc of tenantsSnap.docs) {
    const tenantId = tenantDoc.id;
    try {
      const accountsCol = db.collection(`tenants/${tenantId}/accounts`);
      const [byTierField, byLegacy] = await Promise.all([
        accountsCol.where('tierAutomation.autoOnboardDownToTier', 'in', [1, 2]).get(),
        accountsCol.where('tierAutomation.autoOnboardTier2', '==', true).get(),
      ]);
      const optedIn = new Map<string, Record<string, unknown>>();
      byTierField.forEach((d) => optedIn.set(d.id, d.data() as Record<string, unknown>));
      byLegacy.forEach((d) => optedIn.set(d.id, d.data() as Record<string, unknown>));
      if (optedIn.size === 0) continue;
      totals.tenants++;

      const tierSettings = await db.doc(`tenants/${tenantId}/settings/tierAutomation`).get();
      const tierConfig = normalizeTierAutomationConfig(tierSettings.data());

      for (const [accountId, account] of optedIn) {
        // A child that merely INHERITS is swept via its parent (which is in
        // the opted-in set itself); an explicit downToTier 0 is a hard off.
        const policy = resolveAutoOnboardPolicy(accountId, account, '', null);
        if (policy.downToTier === 0) continue;
        totals.accounts++;
        const accountLabel = str(account.name) || accountId;
        let accountPromoted = 0;

        // Family = this account + direct children (children inherit).
        const familyIds = new Set<string>([accountId]);
        const childSnap = await accountsCol.where('parentAccountId', '==', accountId).limit(200).get();
        childSnap.forEach((d) => familyIds.add(d.id));
        for (const cid of Array.isArray(account.childAccountIds) ? account.childAccountIds : []) {
          if (typeof cid === 'string' && cid.trim()) familyIds.add(cid.trim());
        }

        const { pool, truncated } = await collectPool(db, tenantId, [...familyIds]);
        totals.pooledApplications += pool.length;
        if (truncated) {
          logger.warn('rampSweep: pool truncated by caps', { tenantId, accountId, pooled: pool.length });
        }

        // One user doc read per unique worker; tier ordering puts Tier 1
        // first so the daily budget goes to the best candidates.
        const users = new Map<string, Record<string, unknown>>();
        for (const p of pool) {
          if (users.has(p.userId)) continue;
          // eslint-disable-next-line no-await-in-loop
          const u = await db.doc(`users/${p.userId}`).get();
          if (u.exists) users.set(p.userId, (u.data() ?? {}) as Record<string, unknown>);
        }

        // Account-scoped promotion pass (Tier 3 → 2) before onboarding,
        // so freshly promoted workers onboard in this same run.
        if (policy.autoPromote) {
          for (const [uid, u] of users) {
            if (resolveGlobalTier(u) !== 3) continue;
            try {
              // eslint-disable-next-line no-await-in-loop
              const promoted = await maybePromoteForRamp(db, tenantId, uid, u, tierConfig, accountLabel);
              if (promoted) {
                totals.promoted++;
                accountPromoted++;
                u.workerTiers = { ...((u.workerTiers as Record<string, unknown>) ?? {}), global: 2 };
              }
            } catch (e) {
              totals.errors++;
              logger.error('rampSweep: promotion failed', { tenantId, uid, error: e instanceof Error ? e.message : String(e) });
            }
          }
        }

        const eligible = pool
          .filter((p) => {
            const u = users.get(p.userId);
            return u ? resolveGlobalTier(u) <= policy.downToTier : false;
          })
          .sort((a, b) => resolveGlobalTier(users.get(a.userId)!) - resolveGlobalTier(users.get(b.userId)!))
          .slice(0, MAX_ONBOARDS_PER_ACCOUNT_PER_RUN);

        for (const p of eligible) {
          totals.onboardsAttempted++;
          // Single code path with the application trigger: policy, entity,
          // package cascade, duplicate-order guard, DAILY BUDGET, stamp,
          // onboarding flow — all inside. Never throws.
          // eslint-disable-next-line no-await-in-loop
          await maybeAutoOnboardTierTwoApplicant(db, {
            tenantId,
            applicationId: p.applicationId,
            application: p.application,
          });
        }

        await db.doc(`tenants/${tenantId}/accounts/${accountId}`).set(
          {
            tierAutomation: {
              lastSweepAt: admin.firestore.FieldValue.serverTimestamp(),
              lastSweepStats: {
                pooledApplications: pool.length,
                promoted: accountPromoted,
                onboardsAttempted: eligible.length,
                truncated,
              },
            },
          },
          { merge: true },
        );
      }
    } catch (e) {
      totals.errors++;
      logger.error('rampSweep: tenant failed', { tenantId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  logger.info('rampSweep: done', { ...totals });
  return totals;
}
