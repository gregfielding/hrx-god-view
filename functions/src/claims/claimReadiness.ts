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

import { claimError, evaluateClaimReadiness } from './claimShiftPolicy';

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
