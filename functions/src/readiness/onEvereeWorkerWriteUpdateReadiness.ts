/**
 * Phase A trigger — bridge `tenants/{tid}/everee_workers/{entityId}__{userId}`
 * writes into `employee_readiness_items.{...}.everee_profile.status` and
 * `.direct_deposit.status`.
 *
 * Closes Critical hole #1 (Everee branch) per
 * `docs/READINESS_EXECUTION_MATRIX.md` §6 / §7.
 *
 * The doc id encodes both the hiring entity and the worker uid, so we
 * parse it rather than relying on body fields. The translator returns
 * statuses for both readiness items in one call (see §5.3 of the matrix
 * — bank-account-verified flips direct_deposit independently of overall
 * Everee onboarding completion).
 *
 * Short-circuits unless either `status` or `bankAccount.verified`
 * actually changed.
 *
 * @see shared/readinessStatusFromEveree.ts
 * @see updateReadinessItemStatus.ts
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import {
  evereeToReadinessStatus,
  type EvereeWorkerStatus,
} from '../shared/readinessStatusFromEveree';
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

function pickBankVerified(data: Record<string, unknown> | null): boolean | undefined {
  if (!data) return undefined;
  const ba = data.bankAccount as Record<string, unknown> | null | undefined;
  if (ba && typeof ba.verified === 'boolean') return ba.verified;
  // Some Everee payloads land verification on a sibling field.
  if (typeof data.bankAccountVerified === 'boolean') return data.bankAccountVerified;
  return undefined;
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

    // Short-circuit unless one of the two driving inputs changed.
    const beforeFingerprint = `${beforeData?.status ?? ''}::${pickBankVerified(beforeData) ?? ''}`;
    const afterFingerprint = `${afterData.status ?? ''}::${pickBankVerified(afterData) ?? ''}`;
    if (beforeFingerprint === afterFingerprint) return;

    const parsed = parseEvereeWorkerDocId(docId);
    if (!parsed) {
      logger.warn('onEvereeWorkerWriteUpdateReadiness: doc id not in entityId__userId format', {
        tenantId,
        docId,
      });
      return;
    }

    const { entityId, userId } = parsed;
    const everee = evereeToReadinessStatus({
      status: (afterData.status as EvereeWorkerStatus | null | undefined) ?? null,
      bankAccountVerified: pickBankVerified(afterData),
    });

    const [profileResult, ddResult] = await Promise.all([
      updateReadinessItemStatus({
        tenantId,
        workerUid: userId,
        hiringEntityId: entityId,
        requirementType: 'everee_profile',
        newStatus: everee.evereeProfile,
        source: 'everee_webhook',
        externalRef: docId,
      }),
      updateReadinessItemStatus({
        tenantId,
        workerUid: userId,
        hiringEntityId: entityId,
        requirementType: 'direct_deposit',
        newStatus: everee.directDeposit,
        source: 'everee_webhook',
        externalRef: docId,
      }),
    ]);

    logger.info('onEvereeWorkerWriteUpdateReadiness: reconciled', {
      tenantId,
      docId,
      userId,
      entityId,
      evereeProfileStatus: everee.evereeProfile,
      directDepositStatus: everee.directDeposit,
      profileChanged: profileResult.changed,
      directDepositChanged: ddResult.changed,
    });
  },
);
