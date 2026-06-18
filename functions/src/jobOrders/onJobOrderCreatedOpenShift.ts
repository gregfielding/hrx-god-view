/**
 * onJobOrderCreatedOpenShift — auto-create a standing "open shift" whenever a
 * new Job Order is created, with start date = creation date.
 *
 * An open shift is the default placement container for a JO's ongoing crew
 * (see memory: open-shift-feature-design-decisions). Creating one on every
 * new JO means recruiters always have somewhere to drop their standing crew
 * without hand-building a shift first.
 *
 * Idempotent (skips if the JO already has an open shift) and eligibility-gated
 * (`isOpenShiftTriggerEligible`: non-terminal JOs; gig JOs excluded by
 * default). Mirrors the manual EditShiftForm open-shift doc shape.
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

import {
  ensureOpenShiftForJobOrder,
  isOpenShiftTriggerEligible,
  todayUtcIso,
  OPEN_SHIFT_JOB_TYPE_SCOPE_DEFAULT,
} from './openShiftFromJobOrder';

if (!admin.apps.length) {
  admin.initializeApp();
}

export const onJobOrderCreatedOpenShift = onDocumentCreated(
  // 512MiB floor: the 256MiB default OOMs on cold start (large module bundle).
  { document: 'tenants/{tenantId}/job_orders/{jobOrderId}', memory: '512MiB' },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const jobOrderId = event.params.jobOrderId as string;
    const jobOrder = event.data?.data();
    if (!jobOrder) return;

    const elig = isOpenShiftTriggerEligible(jobOrder, {
      scope: OPEN_SHIFT_JOB_TYPE_SCOPE_DEFAULT,
    });
    if (!elig.eligible) {
      logger.debug('onJobOrderCreatedOpenShift: skipped', { tenantId, jobOrderId, reason: elig.reason });
      return;
    }

    try {
      const result = await ensureOpenShiftForJobOrder(admin.firestore(), {
        tenantId,
        jobOrderId,
        jobOrder,
        startDate: todayUtcIso(),
        createdBy: 'system:onJobOrderCreatedOpenShift',
      });
      logger.info('onJobOrderCreatedOpenShift', {
        tenantId,
        jobOrderId,
        outcome: result.outcome,
        shiftId: result.shiftId,
      });
    } catch (err) {
      logger.error('onJobOrderCreatedOpenShift failed', {
        tenantId,
        jobOrderId,
        error: (err as Error)?.message,
      });
    }
  },
);
