/**
 * Claim Shift payroll-readiness gate (Greg 2026-09-11) — Firestore + Everee
 * glue around the pure `evaluateClaimReadiness` (claimShiftPolicy.ts).
 *
 * To claim, the worker's payroll must be finished at the hiring entity that
 * runs the shift (docs/claude/project_events_onboarding_claim_readiness.md):
 *   - C1 Events, never hired there → start 1099 on-call onboarding on this tap
 *     and refuse with `setup_required` / stage `started`. Notifications are
 *     suppressed: the client routes the worker straight into payroll setup,
 *     and `respondToAssignment` binds no Twilio/SendGrid secrets.
 *   - Hired, cached signals say not done → ask Everee live before refusing
 *     (webhooks lag). A positive read mirrors completion (same writes as
 *     `evereeGetMyOnboardingStatus`) and the claim continues.
 *   - Any other entity with no employment → `ineligible` / reason `not_hired`.
 * A job order with no resolvable hiring entity skips the gate (logged).
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import { HttpsError } from 'firebase-functions/v2/https';

import { claimError, evaluateClaimReadiness } from './claimShiftPolicy';
import type { ClaimSetupStage } from './claimShiftPolicy';

const SETUP_STARTED_MSG =
  "Set up payroll to claim this shift. We've started it for you — add your tax form and direct deposit (a few minutes).";
const SETUP_IN_PROGRESS_MSG = 'Finish your payroll setup to claim shifts — it only takes a few minutes.';

export function resolveClaimHiringEntityId(
  jobOrder: Record<string, unknown>,
  posting: Record<string, unknown> | null | undefined,
): string {
  return String(jobOrder.entityId || posting?.hiringEntityId || '').trim();
}

export async function assertClaimPayrollReady(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  uid: string;
  jobOrderId: string;
  jobOrder: Record<string, unknown>;
  posting: Record<string, unknown> | null;
}): Promise<void> {
  const { db, tenantId, uid, jobOrderId } = args;
  const entityId = resolveClaimHiringEntityId(args.jobOrder, args.posting);
  if (!entityId) {
    logger.warn('[claimReadiness] no hiring entity on job order or posting — gate skipped', { tenantId, jobOrderId });
    return;
  }

  const [employmentSnap, linkSnap] = await Promise.all([
    db.collection(`tenants/${tenantId}/entity_employments`).where('userId', '==', uid).get(),
    db.doc(`tenants/${tenantId}/everee_workers/${entityId}__${uid}`).get(),
  ]);
  const employments = employmentSnap.docs
    .map((d) => (d.data() || {}) as Record<string, unknown>)
    .filter((e) => String(e.entityId || '') === entityId);
  const link = linkSnap.exists ? ((linkSnap.data() || {}) as Record<string, unknown>) : null;

  const decision = evaluateClaimReadiness({ entityId, employments, link });
  switch (decision.kind) {
    case 'ready':
      return;
    case 'not_hired':
      throw claimError('ineligible', 'This shift is for workers already hired with this company.', {
        reason: 'not_hired',
        entityId,
      });
    case 'employment_ended':
      throw claimError('ineligible', 'You are not able to work with this company right now.', {
        reason: 'employment_ended',
        entityId,
      });
    case 'start_onboarding': {
      try {
        const { runStartOnCallEmploymentFlow } = await import('../onboarding/startOnCallEmployment');
        await runStartOnCallEmploymentFlow({
          tenantId,
          userId: uid,
          entityId,
          workerType: 'entity_default',
          triggerSource: 'claim_intent',
          initiatedByUid: uid,
          suppressNotifications: true,
        });
        logger.info('[claimReadiness] onboarding started from claim', { tenantId, uid, entityId, jobOrderId });
      } catch (e: unknown) {
        // The worker still lands in payroll setup; the next claim tap retries.
        logger.error('[claimReadiness] start onboarding failed', {
          tenantId,
          uid,
          entityId,
          jobOrderId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      throw claimError('setup_required', SETUP_STARTED_MSG, { entityId, stage: 'started' });
    }
    case 'setup_in_progress': {
      if (await evereeConfirmsOnboardingComplete({ db, tenantId, uid, entityId, link })) return;
      throw claimError('setup_required', SETUP_IN_PROGRESS_MSG, { entityId, stage: 'in_progress' });
    }
  }
}

/** Live Everee read; mirrors completion on a positive answer. Any failure → false (refuse). */
async function evereeConfirmsOnboardingComplete(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  uid: string;
  entityId: string;
  link: Record<string, unknown> | null;
}): Promise<boolean> {
  const { db, tenantId, uid, entityId, link } = args;
  const evereeWorkerId = String(link?.evereeWorkerId || '').trim();
  if (!evereeWorkerId || process.env.EVEREE_ENABLED !== 'true') return false;
  try {
    const [{ getEvereeConfigForEntity }, { evereeRequest }, everee] = await Promise.all([
      import('../integrations/everee/evereeConfig'),
      import('../integrations/everee/evereeHttp'),
      import('../integrations/everee/evereeCallables'),
    ]);
    const config = await getEvereeConfigForEntity(tenantId, entityId);
    if (!config) return false;
    const raw =
      (await evereeRequest<Record<string, unknown>>(
        config,
        'GET',
        `/api/v2/workers/${encodeURIComponent(evereeWorkerId)}`,
      )) ?? {};
    if (!everee.inspectEvereeOnboardingState(raw).complete) return false;

    await db.doc(`tenants/${tenantId}/everee_workers/${entityId}__${uid}`).set(
      {
        status: 'onboarding_complete',
        apiObservedOnboardingCompleteAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await everee.mirrorEvereeOnboardingCompleteToEmployments({ tenantId, entityId, userId: uid });
    logger.info('[claimReadiness] Everee confirmed onboarding complete — claim continues', { tenantId, uid, entityId });
    return true;
  } catch (e: unknown) {
    logger.warn('[claimReadiness] live Everee check failed — treating as not ready', {
      tenantId,
      uid,
      entityId,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

export interface ClaimPrepareResult {
  success: true;
  ready: boolean;
  stage: 'ready' | ClaimSetupStage;
  entityId: string | null;
}

/** Maps the gate's outcome to the `claim_prepare` response; rethrows every other refusal. */
export function claimPrepareResultFrom(outcome: { passed: true; entityId: string | null } | { passed: false; error: unknown }): ClaimPrepareResult {
  if (!('error' in outcome)) return { success: true, ready: true, stage: 'ready', entityId: outcome.entityId };
  const err = outcome.error;
  const details = err instanceof HttpsError ? (err.details as { code?: unknown; stage?: unknown; entityId?: unknown } | undefined) : undefined;
  if (details?.code === 'setup_required') {
    return {
      success: true,
      ready: false,
      stage: details.stage === 'started' ? 'started' : 'in_progress',
      entityId: typeof details.entityId === 'string' ? details.entityId : null,
    };
  }
  throw err;
}

/**
 * `respondToAssignment` decision `claim_prepare` (step 5, 2026-09-11): runs ONLY
 * the payroll-readiness gate for a claim-enabled posting and books nothing —
 * the "Finish setup to claim" button calls it so a C1 Events worker's
 * onboarding starts (and a finished-in-Everee worker is confirmed live) before
 * the client routes to payroll setup or opens the claim sheet. Not-hired /
 * ended refusals throw exactly like a claim.
 */
export async function prepareClaimForWorker(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  uid: string;
  jobOrderId: string;
  jobPostId?: string | null;
}): Promise<ClaimPrepareResult> {
  const { db, tenantId, uid, jobOrderId } = args;
  const jobOrderSnap = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get();
  if (!jobOrderSnap.exists) throw new HttpsError('not-found', 'Job order not found');
  const jobOrder = (jobOrderSnap.data() || {}) as Record<string, unknown>;
  let posting: Record<string, unknown> | null = null;
  if (args.jobPostId) {
    const postSnap = await db.doc(`tenants/${tenantId}/job_postings/${args.jobPostId}`).get();
    const data = (postSnap.data() || {}) as Record<string, unknown>;
    if (postSnap.exists && String(data.jobOrderId || '') === jobOrderId) posting = data;
  }
  try {
    await assertClaimPayrollReady({ db, tenantId, uid, jobOrderId, jobOrder, posting });
    return claimPrepareResultFrom({ passed: true, entityId: resolveClaimHiringEntityId(jobOrder, posting) || null });
  } catch (error: unknown) {
    return claimPrepareResultFrom({ passed: false, error });
  }
}
