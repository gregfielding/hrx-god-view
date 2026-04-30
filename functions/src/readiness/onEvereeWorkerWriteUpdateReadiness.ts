/**
 * Phase A trigger — bridge `tenants/{tid}/everee_workers/{entityId}__{userId}`
 * writes into `employeeReadinessItems.{...}.{requirementType}.status`.
 *
 * Closes Critical hole #1 (Everee branch) per
 * `docs/READINESS_EXECUTION_MATRIX.md` §6 / §7.
 *
 * **E.3 expansion** — when the doc carries a populated `readinessMirror`
 * snapshot (written by `computeEvereeReadinessMirror` via the cron /
 * webhook reconcile path), the trigger updates the seven Everee-owned
 * readiness items in addition to the legacy `everee_profile` /
 * `direct_deposit` updates:
 *
 *   - `direct_deposit` — mirror-driven (more authoritative than the
 *     legacy `bankAccount.verified` heuristic; the mirror considers
 *     Everee's `availablePaymentMethods.directDeposit` flag too).
 *   - `i9_section_1` — worker portion of I-9 (W-2 only via applicability).
 *   - `tax_w4` — withholding form (W-2 only via applicability).
 *   - `tax_w9` — taxpayer ID (1099 only via applicability).
 *   - `handbook_acknowledgement` — handbook signed.
 *   - `policy_acknowledgement` — at least one policy signed.
 *   - `tin_verification` — IRS TIN status (4-state machine, MISMATCH = `blocked`).
 *
 * `everee_profile` continues to come from the legacy translator over
 * `status` — the mirror doesn't express overall onboarding state in a
 * single field.
 *
 * Short-circuits unless either the legacy fingerprint (`status` +
 * `bankAccount.verified`) or the mirror semantic fingerprint changed.
 * Provenance fields (`lastEvereeSyncAt`, `lastEvereeSyncSource`) are
 * deliberately excluded from the fingerprint so a no-op cron sweep
 * doesn't re-fire the trigger.
 *
 * @see shared/readinessStatusFromEveree.ts (legacy translator)
 * @see shared/readinessStatusFromEvereeMirror.ts (E.3 mirror translator)
 * @see ./evereeWorkerReadinessPlan.ts (pure planner)
 * @see ./updateReadinessItemStatus.ts (idempotent per-item writer)
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import { planEvereeWorkerReadinessUpdates } from './evereeWorkerReadinessPlan';
import { updateReadinessItemStatus } from './updateReadinessItemStatus';

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Parse the composite doc id `${entityId}__${userId}`. Both halves are
 * required; we don't accept legacy non-composite ids since the Everee
 * webhook handler always writes the composite shape.
 */
function parseEvereeWorkerDocId(docId: string): { entityId: string; userId: string } | null {
  const idx = docId.indexOf('__');
  if (idx <= 0 || idx === docId.length - 2) return null;
  const entityId = docId.slice(0, idx).trim();
  const userId = docId.slice(idx + 2).trim();
  if (!entityId || !userId) return null;
  return { entityId, userId };
}

export const onEvereeWorkerWriteUpdateReadiness = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/everee_workers/{docId}',
    region: 'us-central1',
    maxInstances: 5,
    memory: '512MiB',
    retry: false,
  },
  async (event) => {
    const tenantId = String(event.params.tenantId);
    const docId = String(event.params.docId);

    const beforeData = event.data?.before?.exists
      ? ((event.data.before.data() ?? {}) as Record<string, unknown>)
      : null;
    const afterData = event.data?.after?.exists
      ? ((event.data.after.data() ?? {}) as Record<string, unknown>)
      : null;

    if (!afterData) {
      logger.info('onEvereeWorkerWriteUpdateReadiness: doc deleted, no-op', {
        tenantId,
        docId,
      });
      return;
    }

    const plan = planEvereeWorkerReadinessUpdates({
      before: beforeData,
      after: afterData,
    });

    if (!plan.shouldFire) return;

    const parsed = parseEvereeWorkerDocId(docId);
    if (!parsed) {
      logger.warn('onEvereeWorkerWriteUpdateReadiness: doc id not in entityId__userId format', {
        tenantId,
        docId,
      });
      return;
    }

    const { entityId, userId } = parsed;

    const results = await Promise.all(
      plan.updates.map((u) =>
        updateReadinessItemStatus({
          tenantId,
          workerUid: userId,
          hiringEntityId: entityId,
          requirementType: u.requirementType,
          newStatus: u.newStatus,
          source: 'everee_webhook',
          externalRef: docId,
        }),
      ),
    );

    const summary = plan.updates.map((u, i) => ({
      requirementType: u.requirementType,
      newStatus: u.newStatus,
      source: u.source,
      changed: results[i].changed,
      skippedReason: results[i].skippedReason,
    }));

    logger.info('onEvereeWorkerWriteUpdateReadiness: reconciled', {
      tenantId,
      docId,
      userId,
      entityId,
      mirrorPresent: plan.debug.mirrorPresent,
      legacyFingerprintChanged: plan.debug.legacyFingerprintChanged,
      mirrorFingerprintChanged: plan.debug.mirrorFingerprintChanged,
      updates: summary,
    });
  },
);
