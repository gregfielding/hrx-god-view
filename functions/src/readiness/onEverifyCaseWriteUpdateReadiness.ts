/**
 * Phase A trigger — bridge `tenants/{tid}/everify_cases/{caseId}` writes
 * into `employee_readiness_items.{...}.e_verify.status`.
 *
 * Closes Critical hole #1 (E-Verify branch) per
 * `docs/READINESS_EXECUTION_MATRIX.md` §6 / §7.
 *
 * E-Verify is Select-only. The case doc carries `tenantId`, `entityId`,
 * and `userId` directly — all the context we need to look up exactly
 * one readiness item. No multi-entity fan-out (unlike background
 * checks).
 *
 * Short-circuits unless `status` actually changed.
 *
 * @see shared/readinessStatusFromEverify.ts
 * @see updateReadinessItemStatus.ts
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import {
  everifyToReadinessStatus,
  type EverifyHrxStatus,
} from '../shared/readinessStatusFromEverify';
import { updateReadinessItemStatus } from './updateReadinessItemStatus';

if (!admin.apps.length) {
  admin.initializeApp();
}

function pickString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t === '' ? null : t;
}

export const onEverifyCaseWriteUpdateReadiness = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/everify_cases/{caseId}',
    region: 'us-central1',
    maxInstances: 5,
    memory: '512MiB',
    retry: false,
  },
  async (event) => {
    const tenantId = String(event.params.tenantId);
    const caseId = String(event.params.caseId);

    const beforeData = event.data?.before?.exists
      ? ((event.data.before.data() ?? {}) as Record<string, unknown>)
      : null;
    const afterData = event.data?.after?.exists
      ? ((event.data.after.data() ?? {}) as Record<string, unknown>)
      : null;

    if (!afterData) {
      logger.info('onEverifyCaseWriteUpdateReadiness: case deleted, no-op', {
        tenantId,
        caseId,
      });
      return;
    }

    // Short-circuit unless `status` actually moved. Other field changes
    // (lastCheckedAt, public summary, etc.) shouldn't trigger a write.
    if (beforeData && beforeData.status === afterData.status) return;

    const userId = pickString(afterData.userId);
    const entityId = pickString(afterData.entityId);
    if (!userId || !entityId) {
      logger.warn('onEverifyCaseWriteUpdateReadiness: missing userId or entityId', {
        tenantId,
        caseId,
        userId,
        entityId,
      });
      return;
    }

    const status = afterData.status as EverifyHrxStatus | null | undefined;
    const newStatus = everifyToReadinessStatus({ hrxStatus: status });

    const result = await updateReadinessItemStatus({
      tenantId,
      workerUid: userId,
      hiringEntityId: entityId,
      requirementType: 'e_verify',
      newStatus,
      source: 'everify_poller',
      externalRef: caseId,
    });

    logger.info('onEverifyCaseWriteUpdateReadiness: reconciled', {
      tenantId,
      caseId,
      userId,
      entityId,
      caseStatus: status,
      readinessStatus: newStatus,
      changed: result.changed,
    });
  },
);
