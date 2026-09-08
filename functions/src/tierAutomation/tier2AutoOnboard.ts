/**
 * Tier 2 account auto-onboard (Greg 2026-09-04, the OnTrac end-goal):
 * when a Tier 1/2 worker's application lands on an account that opted in
 * (`tenants/{t}/accounts/{accountId}.tierAutomation.autoOnboardTier2`),
 * start onboarding + order the account's default screening immediately, so
 * that by the time the recruiter opens the applicant pool a slice of it is
 * already fully onboarded and screened. The HIRE stays a human decision —
 * this pre-onboards, it never places anyone on a shift.
 *
 * Rides `onApplicationHiringSignalsChangedAutoOnboard` (no new Cloud Run
 * service). Loop/duplicate safety:
 *  - the application doc is stamped `tierAutoOnboard` BEFORE the flow runs —
 *    the stamp gates re-entry, so the trigger re-firing on our own write (or
 *    any later write) is a no-op;
 *  - `runStartOnCallEmploymentFlow` short-circuits when the (user, entity)
 *    `entity_employments` row exists — no duplicate onboarding or invites;
 *  - a screening package is only passed when the worker has NO existing
 *    non-terminal backgroundChecks order (the in-flight-duplicate class the
 *    2026-06-03 Dempsey incident came from).
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import { mergeScreeningPackageFromLayers } from '../compliance/screeningAutomationShared';
import { runStartOnCallEmploymentFlow } from '../onboarding/startOnCallEmployment';

const SYSTEM_ACTOR = 'system:tier2_account_auto_onboard';
const TERMINAL_ORDER_STATUSES = new Set(['canceled', 'cancelled', 'error', 'expired']);

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Ramp-mode throttle (Greg 2026-09-07, "child account-specific"): the
 * account's `tierAutomation` map governs proactive onboarding spend.
 *   - autoOnboardDownToTier: 2 = onboard Tiers 1+2, 1 = Tier 1 only,
 *     0 = off. Absent falls back to the legacy boolean
 *     (autoOnboardTier2 === true ⇒ 2).
 *   - maxAutoOnboardsPerDay: budget guard, default 25 — this is real
 *     screening spend per head.
 *   - autoPromoteApplicants: hourly sweep may auto-apply qualifying
 *     Tier 3→2 promotions for this account's applicant pool (defaults
 *     ON whenever ramp is on; the tenant-wide sweep stays in its own
 *     mode).
 * Field-by-field inheritance: child explicit beats parent explicit
 * beats defaults. `policyAccountId` = the account whose config supplied
 * the tier setting — the daily budget counter lives THERE, so a
 * national-level opt-in caps spend across all children while a child
 * with its own config gets its own budget.
 */
export interface AutoOnboardPolicy {
  downToTier: 0 | 1 | 2;
  maxPerDay: number;
  autoPromote: boolean;
  policyAccountId: string;
}

export const DEFAULT_MAX_AUTO_ONBOARDS_PER_DAY = 25;

export function resolveAutoOnboardPolicy(
  accountId: string,
  account: Record<string, unknown> | null,
  parentAccountId: string,
  parent: Record<string, unknown> | null,
): AutoOnboardPolicy {
  const readTier = (doc: Record<string, unknown> | null): 0 | 1 | 2 | null => {
    const ta = (doc?.tierAutomation ?? null) as Record<string, unknown> | null;
    if (!ta) return null;
    const n = Number(ta.autoOnboardDownToTier);
    if (n === 0 || n === 1 || n === 2) return n;
    if (ta.autoOnboardTier2 === true) return 2;
    if (ta.autoOnboardTier2 === false) return 0;
    return null;
  };
  const readNum = (doc: Record<string, unknown> | null, key: string): number | null => {
    const ta = (doc?.tierAutomation ?? null) as Record<string, unknown> | null;
    const n = Number(ta?.[key]);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  const readBool = (doc: Record<string, unknown> | null, key: string): boolean | null => {
    const ta = (doc?.tierAutomation ?? null) as Record<string, unknown> | null;
    return typeof ta?.[key] === 'boolean' ? (ta[key] as boolean) : null;
  };
  const childTier = readTier(account);
  const tier = childTier ?? readTier(parent) ?? 0;
  const policyAccountId = childTier != null || !parentAccountId ? accountId : parentAccountId;
  return {
    downToTier: tier,
    maxPerDay:
      readNum(account, 'maxAutoOnboardsPerDay') ??
      readNum(parent, 'maxAutoOnboardsPerDay') ??
      DEFAULT_MAX_AUTO_ONBOARDS_PER_DAY,
    autoPromote:
      readBool(account, 'autoPromoteApplicants') ??
      readBool(parent, 'autoPromoteApplicants') ??
      tier > 0,
    policyAccountId,
  };
}

/**
 * Transactionally claim one slot of today's onboarding budget for the
 * policy account. Returns false (and writes nothing) when the cap is
 * reached — callers SKIP without stamping the application, so the hourly
 * sweep naturally retries tomorrow.
 */
export async function claimDailyOnboardSlot(
  db: admin.firestore.Firestore,
  tenantId: string,
  policyAccountId: string,
  maxPerDay: number,
): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`tenants/${tenantId}/accounts/${policyAccountId}/ramp_counters/${day}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = Number((snap.data() ?? {}).count) || 0;
    if (count >= maxPerDay) return false;
    tx.set(
      ref,
      { count: count + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
    return true;
  });
}

function resolveGlobalTier(data: Record<string, unknown>): number {
  const tiers = (data.workerTiers ?? {}) as Record<string, unknown>;
  const g = Number(tiers.global);
  return g === 1 || g === 2 ? g : 3;
}

async function readDocData(
  db: admin.firestore.Firestore,
  path: string,
): Promise<Record<string, unknown> | null> {
  try {
    const snap = await db.doc(path).get();
    return snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function maybeAutoOnboardTierTwoApplicant(
  db: admin.firestore.Firestore,
  args: {
    tenantId: string;
    applicationId: string;
    application: Record<string, unknown>;
  },
): Promise<void> {
  const { tenantId, applicationId, application } = args;
  try {
    // Re-entry gate: our own stamp (also blocks retries after failure — one
    // attempt per application; the recruiter path stays available).
    if (application.tierAutoOnboard) return;

    const userId = str(application.userId ?? application.candidateId ?? application.uid);
    if (!userId) return;

    const userData = await readDocData(db, `users/${userId}`);
    if (!userData) return;
    const tier = resolveGlobalTier(userData);
    if (tier > 2) return; // Tier 3 never auto-onboards regardless of policy

    // Application → account: posting first (carries accountId/parentAccountId),
    // job order as fallback.
    const jobId = str(application.jobId);
    const jobOrderId = str(application.jobOrderId);
    let accountId = '';
    let parentAccountId = '';
    let jobOrder: Record<string, unknown> | null = null;
    if (jobId) {
      const posting = await readDocData(db, `tenants/${tenantId}/job_postings/${jobId}`);
      accountId = str(posting?.accountId);
      parentAccountId = str(posting?.parentAccountId);
    }
    if (jobOrderId) {
      jobOrder = await readDocData(db, `tenants/${tenantId}/job_orders/${jobOrderId}`);
      if (!accountId) {
        accountId = str(
          jobOrder?.accountId ?? jobOrder?.recruiterAccountId ?? jobOrder?.entityId ?? jobOrder?.companyId,
        );
      }
    }
    if (!accountId) return;

    const account = await readDocData(db, `tenants/${tenantId}/accounts/${accountId}`);
    if (!account) return;
    if (!parentAccountId) parentAccountId = str(account.parentAccountId);

    // Policy on the account, inherited field-by-field from the national
    // parent (Greg 2026-09-07 throttle: Off / Tier 1 only / Tiers 1+2,
    // plus the daily budget).
    const parent = parentAccountId
      ? await readDocData(db, `tenants/${tenantId}/accounts/${parentAccountId}`)
      : null;
    const policy = resolveAutoOnboardPolicy(accountId, account, parentAccountId, parent);
    if (policy.downToTier === 0 || tier > policy.downToTier) return;

    const entityId = str(
      application.hiringEntityId ?? account.hiringEntityId ?? parent?.hiringEntityId,
    );
    if (!entityId) {
      logger.warn('tier2AutoOnboard: opted-in account but no hiring entity resolvable', {
        tenantId,
        applicationId,
        accountId,
      });
      return;
    }

    // Screening: standard cascade (job_order → account); only pass a package
    // when the worker has no existing non-terminal order.
    const merged = mergeScreeningPackageFromLayers(jobOrder ?? undefined, undefined, account);
    let screeningPackageId: string | null = merged.packageId || null;
    let screeningPackageName: string | null = merged.packageName || null;
    if (screeningPackageId) {
      const priorOrders = await db
        .collection('backgroundChecks')
        .where('tenantId', '==', tenantId)
        .where('candidateId', '==', userId)
        .limit(25)
        .get();
      const hasLiveOrder = priorOrders.docs.some((d) => {
        const s = String((d.data() as Record<string, unknown>).providerStatus ?? '')
          .trim()
          .toLowerCase();
        return !TERMINAL_ORDER_STATUSES.has(s);
      });
      if (hasLiveOrder) {
        screeningPackageId = null;
        screeningPackageName = null;
      }
    }

    // Budget guard LAST among the gates (never burn a slot on an
    // ineligible application). On cap: skip WITHOUT stamping, so the
    // hourly ramp sweep retries once tomorrow's budget opens.
    const gotSlot = await claimDailyOnboardSlot(
      db,
      tenantId,
      policy.policyAccountId,
      policy.maxPerDay,
    );
    if (!gotSlot) {
      logger.info('tier2AutoOnboard: daily budget reached — skipped without stamp', {
        tenantId,
        applicationId,
        accountId,
        policyAccountId: policy.policyAccountId,
        maxPerDay: policy.maxPerDay,
      });
      return;
    }

    // Stamp BEFORE running — the gate above makes any re-fire a no-op.
    await db.doc(`tenants/${tenantId}/applications/${applicationId}`).set(
      {
        tierAutoOnboard: {
          startedAt: admin.firestore.FieldValue.serverTimestamp(),
          tier,
          accountId,
          entityId,
          screeningPackageId,
        },
      },
      { merge: true },
    );

    const result = await runStartOnCallEmploymentFlow({
      tenantId,
      userId,
      entityId,
      workerType: 'entity_default',
      initiatedByUid: SYSTEM_ACTOR,
      triggerSource: 'auto_tier2_account',
      applicationId,
      note: `Tier ${tier} auto-onboard for account ${accountId}`,
      screeningPackageId,
      screeningPackageName,
      enforceOnCallOnboardingPolicy: true,
    });

    await db.doc(`tenants/${tenantId}/applications/${applicationId}`).set(
      {
        tierAutoOnboard: {
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          ok: true,
          pipelineId: (result as Record<string, unknown>)?.pipelineId ?? null,
        },
      },
      { merge: true },
    );

    logger.info('tier2AutoOnboard: onboarding started', {
      tenantId,
      applicationId,
      userId,
      tier,
      accountId,
      entityId,
      screeningPackageId,
    });
  } catch (e: unknown) {
    logger.error('tier2AutoOnboard: failed', {
      tenantId,
      applicationId,
      error: e instanceof Error ? e.message : String(e),
    });
    try {
      await db.doc(`tenants/${tenantId}/applications/${applicationId}`).set(
        {
          tierAutoOnboard: {
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          },
        },
        { merge: true },
      );
    } catch {
      // stamp best-effort only
    }
  }
}
