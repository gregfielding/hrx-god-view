/**
 * revertSentTimesheetEntryToDraft — pull a single already-submitted
 * (`sent_to_everee`) TimesheetEntryV2 row back out of Everee and reset it
 * to `draft` so the recruiter can fix hours/rate/tips/bonus and resubmit.
 *
 * Mirrors the CSV importer's `voidImportTimesheetPayable`
 * (submitImportTimesheetBatch.ts) for the regular (non-CSV) Grid → Everee
 * flow, which had no equivalent until now — the only prior "undo"
 * mechanism there was the additive-only adjustment path
 * (submitTimesheetAdjustments.ts), which layers a correction on top
 * rather than fixing a wrong original submission.
 *
 * Scope / safety:
 *   - ONLY entries with status === 'sent_to_everee' are eligible. `paid`
 *     is refused outright — once the reconciler cron (reconcileTimesheetBatches.ts)
 *     or the payment webhook has confirmed Everee actually paid it,
 *     deleting the payable/worked-shift would desync real money from
 *     HRX's record; that correction has to go through the adjustment
 *     path instead (submitTimesheetAdjustment).
 *   - Deletes whatever Everee objects the entry recorded: the worked
 *     shift (W-2 wage, `everee.workedShiftId`) via `deleteWorkedShift`
 *     with `correctionAuthorized: true`, AND each payable in
 *     `everee.payableExternalIds` (ancillary W-2 payables, or the sole
 *     contractor payable) via `deletePayable`. A W-2 entry can have both
 *     populated at once — this deletes both, unlike the CSV path where
 *     `kind` cleanly discriminates one or the other.
 *   - On success, resets status to 'draft', clears sentToEvereeAt + the
 *     everee sub-fields that referenced the now-deleted Everee objects,
 *     and stamps an audit trail (revertedBy/revertedAt), matching
 *     revertTimesheetEntriesToDraftCallable's convention.
 *   - Single entry per call (not bulk) — each entry can require up to
 *     several real Everee DELETE calls; keeping this one-at-a-time keeps
 *     partial-failure handling simple and auditable for what is
 *     inherently a real-money correction.
 *
 * Permission gate: canManageEveree — same gate as every other
 * Everee-mutating callable (createTimesheetBatch, submitImportTimesheetBatch,
 * voidImportTimesheetPayable, submitTimesheetAdjustment).
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { canManageEveree } from '../integrations/everee/evereeAccessGate';
import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';
import { deletePayable } from '../integrations/everee/evereePayables';
import { deleteWorkedShift } from '../integrations/everee/evereeWorkedShifts';

const db = () => admin.firestore();

export interface RevertSentTimesheetEntryToDraftInput {
  tenantId: string;
  entryId: string;
}

export interface RevertSentTimesheetEntryToDraftResult {
  ok: true;
  entryId: string;
  deletedWorkedShift: boolean;
  deletedPayableCount: number;
  /** Non-fatal — a payable/shift that Everee already reports gone (404)
   *  is treated as already-deleted, not an error. */
  alreadyGoneCount: number;
}

function normalize(raw: unknown): RevertSentTimesheetEntryToDraftInput {
  if (!raw || typeof raw !== 'object') {
    throw new HttpsError('invalid-argument', 'Input must be an object.');
  }
  const data = raw as Record<string, unknown>;
  const tenantId = typeof data.tenantId === 'string' ? data.tenantId.trim() : '';
  const entryId = typeof data.entryId === 'string' ? data.entryId.trim() : '';
  if (!tenantId || !entryId) {
    throw new HttpsError('invalid-argument', 'tenantId and entryId are required.');
  }
  return { tenantId, entryId };
}

/** True when the error looks like Everee's "already gone" 404 — treat as
 *  success rather than failing the whole revert on a stale reference. */
function isNotFoundError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /\b404\b|not[_ ]?found/i.test(msg);
}

export const revertSentTimesheetEntryToDraftCallable = onCall(
  { cors: true, timeoutSeconds: 60 },
  async (request): Promise<RevertSentTimesheetEntryToDraftResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }
    const actorUid = request.auth.uid;
    const input = normalize(request.data);

    if (!(await canManageEveree(request.auth as any, input.tenantId))) {
      throw new HttpsError('permission-denied', 'Not allowed to revert Everee submissions for this tenant.');
    }

    const entryRef = db().doc(`tenants/${input.tenantId}/timesheet_entries/${input.entryId}`);
    const snap = await entryRef.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', `Entry ${input.entryId} not found.`);
    }
    const data = snap.data() ?? {};
    const status = typeof data.status === 'string' ? data.status : '';
    if (status === 'paid') {
      throw new HttpsError(
        'failed-precondition',
        'This entry has already been paid by Everee — reverting to draft would desync real money from the record. Use the adjustment path (submitTimesheetAdjustment) to correct a paid entry instead.',
      );
    }
    if (status !== 'sent_to_everee') {
      throw new HttpsError(
        'failed-precondition',
        `Entry status is '${status}', not 'sent_to_everee'. Nothing to revert.`,
      );
    }

    const hiringEntityId = typeof data.hiringEntityId === 'string' ? data.hiringEntityId : '';
    if (!hiringEntityId) {
      throw new HttpsError('failed-precondition', 'Entry is missing hiringEntityId.');
    }
    const config = await getEvereeConfigForEntity(input.tenantId, hiringEntityId);
    if (!config?.evereeTenantId) {
      throw new HttpsError('failed-precondition', 'Entity is not configured for Everee.');
    }

    const everee = (data.everee as Record<string, unknown>) ?? {};
    const workedShiftIdRaw = everee.workedShiftId;
    const payableExternalIds = Array.isArray(everee.payableExternalIds)
      ? (everee.payableExternalIds as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];

    let deletedWorkedShift = false;
    let deletedPayableCount = 0;
    let alreadyGoneCount = 0;

    if (workedShiftIdRaw !== undefined && workedShiftIdRaw !== null) {
      const workedShiftId = Number(workedShiftIdRaw);
      if (workedShiftId > 0) {
        try {
          await deleteWorkedShift(config, workedShiftId, { correctionAuthorized: true });
          deletedWorkedShift = true;
        } catch (e) {
          if (isNotFoundError(e)) {
            alreadyGoneCount++;
          } else {
            logger.error('[revertSentTimesheetEntryToDraft] deleteWorkedShift failed', {
              tenantId: input.tenantId,
              entryId: input.entryId,
              workedShiftId,
              err: e instanceof Error ? e.message : String(e),
            });
            throw new HttpsError(
              'internal',
              `Failed to delete Everee worked shift ${workedShiftId}: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      }
    }

    for (const externalId of payableExternalIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await deletePayable(config, externalId);
        deletedPayableCount++;
      } catch (e) {
        if (isNotFoundError(e)) {
          alreadyGoneCount++;
        } else {
          logger.error('[revertSentTimesheetEntryToDraft] deletePayable failed', {
            tenantId: input.tenantId,
            entryId: input.entryId,
            externalId,
            err: e instanceof Error ? e.message : String(e),
          });
          throw new HttpsError(
            'internal',
            `Failed to delete Everee payable ${externalId}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    await entryRef.set(
      {
        status: 'draft',
        sentToEvereeAt: admin.firestore.FieldValue.delete(),
        revertedBy: actorUid,
        revertedAt: now,
        everee: {
          workedShiftId: admin.firestore.FieldValue.delete(),
          payableExternalIds: admin.firestore.FieldValue.delete(),
          status: 'VOIDED',
        },
        updatedAt: now,
        updatedBy: actorUid,
      },
      { merge: true },
    );

    logger.info('[revertSentTimesheetEntryToDraft] reverted', {
      tenantId: input.tenantId,
      entryId: input.entryId,
      actorUid,
      deletedWorkedShift,
      deletedPayableCount,
      alreadyGoneCount,
    });

    return {
      ok: true,
      entryId: input.entryId,
      deletedWorkedShift,
      deletedPayableCount,
      alreadyGoneCount,
    };
  },
);
