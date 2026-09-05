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
    if (tier > 2) return;

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

    // Opt-in on the account, inherited from the national parent when absent.
    let optIn =
      (account.tierAutomation as Record<string, unknown> | undefined)?.autoOnboardTier2 === true;
    let parent: Record<string, unknown> | null = null;
    if (!optIn && parentAccountId) {
      parent = await readDocData(db, `tenants/${tenantId}/accounts/${parentAccountId}`);
      optIn =
        (parent?.tierAutomation as Record<string, unknown> | undefined)?.autoOnboardTier2 === true;
    }
    if (!optIn) return;

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
