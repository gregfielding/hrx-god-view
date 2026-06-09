/**
 * Phase A trigger — bridge `backgroundChecks/{checkId}` writes into
 * `employee_readiness_items.{...}.background_check` and `.drug_screen`
 * statuses.
 *
 * Closes Critical hole #1 (AccuSource branch) per
 * `docs/READINESS_EXECUTION_MATRIX.md` §6 / §7.
 *
 * The `backgroundChecks` collection is top-level (not tenant-scoped); we
 * read `tenantId` and `candidateId` from the doc body. A single check
 * applies to every entity employment a worker has under that tenant — a
 * passed background is a person-level fact. We update both
 * `background_check` and `drug_screen` items for every entity in
 * parallel since AccuSource bundles both screen types into the same
 * `providerServiceOrderStatus` map.
 *
 * Short-circuits unless one of the relevant fields actually changed:
 *   - `hrxStatus`
 *   - `markedCompleteOutsideHrx`
 *   - any service-line `adjudication.autoVerdict`
 *   - `expired` (R.10) — sweep-stamped expiry flag
 *
 * **R.10** — When `expired === true`, the handler short-circuits the
 * AccuSource translator entirely and forces readiness to `'expired'`. This
 * is the only path that emits `'expired'` to readiness items today, and
 * once flipped, only ordering a new check (a different doc) unblocks the
 * worker.
 *
 * @see shared/readinessStatusFromAccuSource.ts (translator)
 * @see updateReadinessItemStatus.ts (shared write helper)
 * @see readiness/dailyReconcileExpiredReadiness.ts (R.10 sweep)
 * @see docs/READINESS_R10_HANDOFF.md L3.R10
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import {
  accuSourceToReadinessStatus,
  type AccuSourceHrxStatus,
  type AccuSourceLineVerdict,
} from '../shared/readinessStatusFromAccuSource';
import type { EmployeeReadinessItemStatus } from '../shared/employeeReadinessItemV1';
import { updateReadinessItemStatusForEntities } from './updateReadinessItemStatus';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/** Pull the per-line verdicts out of the providerServiceOrderStatus map. */
function extractServiceVerdicts(
  pso: Record<string, unknown> | null | undefined,
): AccuSourceLineVerdict[] {
  if (!pso || typeof pso !== 'object') return [];
  const out: AccuSourceLineVerdict[] = [];
  for (const entry of Object.values(pso)) {
    if (!entry || typeof entry !== 'object') continue;
    const adjudication = (entry as Record<string, unknown>).adjudication as
      | Record<string, unknown>
      | null
      | undefined;
    const autoVerdict = adjudication?.autoVerdict;
    if (
      autoVerdict === 'PASSED' ||
      autoVerdict === 'FAILED' ||
      autoVerdict === 'NEEDS_REVIEW' ||
      autoVerdict === 'PENDING'
    ) {
      out.push(autoVerdict);
    }
  }
  return out;
}

/** Stringify the inputs that drive readiness status, for change detection. */
function readinessFingerprint(data: Record<string, unknown> | null): string {
  if (!data) return '';
  const verdicts = extractServiceVerdicts(
    data.providerServiceOrderStatus as Record<string, unknown> | null,
  )
    .slice()
    .sort()
    .join('|');
  return [
    data.hrxStatus ?? '',
    data.markedCompleteOutsideHrx ? '1' : '0',
    String(data.markedCompleteOutsideHrxVerdict ?? ''),
    verdicts,
    // **R.10** — `expired` flips drive a status change to `'expired'` via
    // the short-circuit below. Without this entry, a sweep write that only
    // toggles `expired:true` would be deduped here and never propagate to
    // readiness items.
    data.expired === true ? '1' : '0',
  ].join('::');
}

function pickString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t === '' ? null : t;
}

export const onBackgroundCheckWriteUpdateReadiness = onDocumentWritten(
  {
    document: 'backgroundChecks/{checkId}',
    region: 'us-central1',
    maxInstances: 5,
    memory: '512MiB',
    retry: false,
  },
  async (event) => {
    const checkId = String(event.params.checkId);
    const beforeData = event.data?.before?.exists
      ? ((event.data.before.data() ?? {}) as Record<string, unknown>)
      : null;
    const afterData = event.data?.after?.exists
      ? ((event.data.after.data() ?? {}) as Record<string, unknown>)
      : null;

    if (!afterData) {
      // Doc deleted. We don't roll back the readiness item — a deleted
      // background check probably means manual cleanup, and we don't
      // want to silently revert a worker from `complete_pass` to
      // `incomplete` without a CSA explicitly doing so. Log and bail.
      logger.info('onBackgroundCheckWriteUpdateReadiness: doc deleted, no-op', { checkId });
      return;
    }

    // Short-circuit unless the fields that drive readiness actually
    // changed. This trigger fires on every webhook merge — many of
    // those touch fields (lastWebhookAt, etc.) that don't affect status.
    const beforeFingerprint = readinessFingerprint(beforeData);
    const afterFingerprint = readinessFingerprint(afterData);
    if (beforeFingerprint === afterFingerprint) return;

    const tenantId = pickString(afterData.tenantId);
    const candidateId =
      pickString(afterData.candidateId) ?? pickString(afterData.userId);
    if (!tenantId || !candidateId) {
      logger.warn('onBackgroundCheckWriteUpdateReadiness: missing tenantId or candidateId', {
        checkId,
        tenantId,
        candidateId,
      });
      return;
    }

    // **R.10 short-circuit** — once a check is stamped `expired: true` by
    // the daily sweep, force readiness to `'expired'` and skip the
    // AccuSource translator entirely.
    //
    // Late-webhook semantics: if an AccuSource webhook arrives AFTER the
    // sweep stamped expiry (e.g. a re-screen result lands days late), this
    // short-circuit means readiness stays `'expired'` regardless of what
    // the webhook says. That is the right behavior — once expired, only
    // ordering a NEW check (which lives in a different `backgroundChecks`
    // doc and follows its own readiness flow) unblocks the worker. The
    // original check's late updates can't un-expire it. Don't second-guess
    // this: see `docs/READINESS_R10_HANDOFF.md` L3.R10.
    const newStatus: EmployeeReadinessItemStatus =
      afterData.expired === true
        ? 'expired'
        : accuSourceToReadinessStatus({
            hrxStatus: (afterData.hrxStatus as AccuSourceHrxStatus | null | undefined) ?? null,
            serviceVerdicts: extractServiceVerdicts(
              afterData.providerServiceOrderStatus as Record<string, unknown> | null,
            ),
            markedCompleteOutsideHrx: afterData.markedCompleteOutsideHrx === true,
            markedCompleteOutsideHrxVerdict:
              afterData.markedCompleteOutsideHrxVerdict === 'FAILED' ? 'FAILED' : 'PASSED',
          });

    // Find every entity employment for this worker in this tenant. A
    // background check is a person-level fact — once it passes, every
    // entity employment for that worker × tenant clears.
    const hiringEntityIds = await loadHiringEntityIds(tenantId, candidateId);
    if (hiringEntityIds.length === 0) {
      logger.info('onBackgroundCheckWriteUpdateReadiness: no entity_employments for worker, skipping', {
        checkId,
        tenantId,
        candidateId,
      });
      return;
    }

    // Update both `background_check` and `drug_screen` per entity. Same
    // status — AccuSource bundles them on the same order.
    const results = await Promise.all([
      updateReadinessItemStatusForEntities(
        {
          tenantId,
          workerUid: candidateId,
          requirementType: 'background_check',
          newStatus,
          source: 'accusource_webhook',
          externalRef: checkId,
        },
        hiringEntityIds,
      ),
      updateReadinessItemStatusForEntities(
        {
          tenantId,
          workerUid: candidateId,
          requirementType: 'drug_screen',
          newStatus,
          source: 'accusource_webhook',
          externalRef: checkId,
        },
        hiringEntityIds,
      ),
    ]);

    const totalChanged = results.flat().filter((r) => r.changed).length;
    logger.info('onBackgroundCheckWriteUpdateReadiness: reconciled', {
      checkId,
      tenantId,
      candidateId,
      newStatus,
      hiringEntityIds,
      totalChanged,
    });
  },
);

/**
 * Load every `hiringEntityId` for which this worker has an
 * `entity_employments` doc in the given tenant. Queries by both legacy
 * `userId` and modern `candidateId` shapes; dedupes hiringEntityIds
 * client-side. Empty array means the worker hasn't been associated with
 * any entity yet — caller should skip.
 */
async function loadHiringEntityIds(tenantId: string, workerUid: string): Promise<string[]> {
  const ref = db.collection(`tenants/${tenantId}/entity_employments`);
  const [byUserId, byCandidateId] = await Promise.all([
    ref.where('userId', '==', workerUid).get(),
    ref.where('candidateId', '==', workerUid).get(),
  ]);
  const out = new Set<string>();
  for (const snap of [byUserId, byCandidateId]) {
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const hid = pickString(data.hiringEntityId) ?? pickString(data.entityId);
      if (hid) out.add(hid);
    }
  }
  return Array.from(out);
}
