/**
 * One-shot callable: copy national account cascading defaults onto child
 * accounts using fill-empty semantics only (never overwrites existing child
 * values).
 *
 * **Greg, 2026-05-04** — also walks every job order owned by the National or
 * any of its children and stamps `hiringEntityId` onto JOs whose own value is
 * empty. For active JOs (those with a captured `snapshot`), the same value is
 * mirrored into `snapshot.hiringEntityId` so snapshot-aware readers
 * (`getEffectiveJobOrderField`) pick it up immediately. Shifts read hiring
 * entity through the JO and need no separate write.
 *
 * Fill-empty everywhere: JOs (or snapshots) that already carry a hiring entity
 * keep their value — those are deliberate overrides for special-case payroll
 * /transition EOR scenarios.
 *
 * Auth: same as Push-to-Active (security level 5+ on the tenant).
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { gateTenantStaffMinLevel } from '../jobOrders/pushToActive';
import { buildChildCascadePatch } from './nationalChildCascadeMerge';
import { decideHiringEntitySyncForDoc } from '../jobOrders/syncHiringEntityFromNationalAccount';

if (!admin.apps.length) {
  admin.initializeApp();
}

const FieldValue = admin.firestore.FieldValue;

const SYSTEM_ACTOR = 'system_sync_national_cascade';
const MAX_AUDIT = 500;
const FIRESTORE_IN_CHUNK = 30;

export interface SyncNationalCascadeAuditEntry {
  childAccountId: string;
  displayName: string;
  action: 'updated' | 'skipped_unchanged' | 'failed';
  reason?: string;
}

export interface SyncNationalCascadeJobOrderAuditEntry {
  jobOrderId: string;
  displayName: string;
  action:
    | 'updated_top'
    | 'updated_top_and_snapshot'
    | 'updated_snapshot_only'
    | 'skipped_existing'
    | 'skipped_same_value'
    | 'skipped_no_national_he'
    | 'failed';
  previousHiringEntityId: string | null;
  reason?: string;
}

export interface SyncNationalCascadingDefaultsResult {
  summary: {
    nationalAccountId: string;
    childAccountsScanned: number;
    childAccountsUpdated: number;
    childAccountsSkippedUnchanged: number;
    childAccountsFailed: number;
    /** Total job orders scanned across the National + every child. */
    jobOrdersScanned: number;
    /** JOs whose top-level `hiringEntityId` was updated. */
    jobOrdersUpdated: number;
    /** Active JOs whose `snapshot.hiringEntityId` was also re-stamped. */
    jobOrderSnapshotsUpdated: number;
    /** JOs left untouched because they already had a hiring entity. */
    jobOrdersSkipped: number;
    /** JOs that errored out (network / permission / etc.). */
    jobOrdersFailed: number;
  };
  audit: SyncNationalCascadeAuditEntry[];
  jobOrderAudit: SyncNationalCascadeJobOrderAuditEntry[];
}

export async function runSyncNationalCascadingDefaultsToChildren(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  nationalAccountId: string;
}): Promise<SyncNationalCascadingDefaultsResult> {
  const { db, tenantId, nationalAccountId } = args;

  const parentRef = db.doc(`tenants/${tenantId}/accounts/${nationalAccountId}`);
  const parentSnap = await parentRef.get();
  if (!parentSnap.exists) {
    throw new HttpsError('not-found', 'National account not found');
  }
  const parent = parentSnap.data() ?? {};
  if (parent.accountType !== 'national') {
    throw new HttpsError(
      'failed-precondition',
      'Account must be a national account',
    );
  }

  const summary: SyncNationalCascadingDefaultsResult['summary'] = {
    nationalAccountId,
    childAccountsScanned: 0,
    childAccountsUpdated: 0,
    childAccountsSkippedUnchanged: 0,
    childAccountsFailed: 0,
    jobOrdersScanned: 0,
    jobOrdersUpdated: 0,
    jobOrderSnapshotsUpdated: 0,
    jobOrdersSkipped: 0,
    jobOrdersFailed: 0,
  };

  const audit: SyncNationalCascadeAuditEntry[] = [];
  const pushAudit = (entry: SyncNationalCascadeAuditEntry): void => {
    audit.push(entry);
    if (audit.length > MAX_AUDIT) audit.shift();
  };

  const jobOrderAudit: SyncNationalCascadeJobOrderAuditEntry[] = [];
  const pushJobOrderAudit = (entry: SyncNationalCascadeJobOrderAuditEntry): void => {
    jobOrderAudit.push(entry);
    if (jobOrderAudit.length > MAX_AUDIT) jobOrderAudit.shift();
  };

  const nationalHiringEntityId =
    typeof parent.hiringEntityId === 'string' ? parent.hiringEntityId.trim() : '';

  /**
   * Include legacy auto-created children that pre-date the `accountType: 'child'`
   * stamp (`autoChildAccountFromCompanyLocation.ts:251`). Matching on
   * `parentAccountId` alone is safe — the national parent itself can never
   * appear here because its own `parentAccountId` is unset.
   */
  const childrenSnap = await db
    .collection(`tenants/${tenantId}/accounts`)
    .where('parentAccountId', '==', nationalAccountId)
    .get();

  const childAccountIds: string[] = [];

  for (const childDoc of childrenSnap.docs) {
    const child = childDoc.data() ?? {};
    if (child.accountType === 'national') continue;
    childAccountIds.push(childDoc.id);

    summary.childAccountsScanned += 1;
    const childName =
      typeof child.name === 'string' && child.name.trim()
        ? child.name.trim()
        : childDoc.id;

    try {
      const patch = buildChildCascadePatch({ child, parent });
      if (!patch) {
        summary.childAccountsSkippedUnchanged += 1;
        pushAudit({
          childAccountId: childDoc.id,
          displayName: childName,
          action: 'skipped_unchanged',
        });
        continue;
      }

      await childDoc.ref.update({
        ...patch,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: SYSTEM_ACTOR,
        cascadingFilledFromNationalAt: FieldValue.serverTimestamp(),
        cascadingFilledFromNationalId: nationalAccountId,
      });
      summary.childAccountsUpdated += 1;
      pushAudit({
        childAccountId: childDoc.id,
        displayName: childName,
        action: 'updated',
      });
    } catch (err) {
      summary.childAccountsFailed += 1;
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn('syncNationalCascadingDefaults: child_failed', {
        tenantId,
        nationalAccountId,
        childAccountId: childDoc.id,
        error: reason,
      });
      pushAudit({
        childAccountId: childDoc.id,
        displayName: childName,
        action: 'failed',
        reason,
      });
    }
  }

  // ── Pass 2: job orders owned by the National + each child ────────
  // Walk every JO whose `recruiterAccountId` is in
  // `[nationalAccountId, ...childAccountIds]`. Fill-empty on
  // `hiringEntityId`; if the JO has a captured snapshot, mirror the
  // value into `snapshot.hiringEntityId` so snapshot-aware readers
  // (`getEffectiveJobOrderField`) and shifts (which look up hiring
  // entity through the JO) pick it up immediately.
  if (nationalHiringEntityId) {
    const accountIdsForJoQuery = [nationalAccountId, ...childAccountIds];
    const chunks: string[][] = [];
    for (let i = 0; i < accountIdsForJoQuery.length; i += FIRESTORE_IN_CHUNK) {
      chunks.push(accountIdsForJoQuery.slice(i, i + FIRESTORE_IN_CHUNK));
    }

    const stamp = (): Record<string, unknown> => ({
      hiringEntityId: nationalHiringEntityId,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: SYSTEM_ACTOR,
      hiringEntityIdSyncedFrom: nationalAccountId,
      hiringEntityIdSyncedAt: FieldValue.serverTimestamp(),
    });

    for (const chunk of chunks) {
      let jobOrdersSnap;
      try {
        jobOrdersSnap = await db
          .collection(`tenants/${tenantId}/job_orders`)
          .where('recruiterAccountId', 'in', chunk)
          .get();
      } catch (err) {
        // Treat the whole chunk as failed so the operator sees the
        // error in the audit; one JO per chunk-failure is enough
        // signal to investigate (e.g. missing index, permission).
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn('syncNationalCascadingDefaults: job_order_chunk_failed', {
          tenantId,
          nationalAccountId,
          chunk,
          error: reason,
        });
        summary.jobOrdersFailed += 1;
        pushJobOrderAudit({
          jobOrderId: chunk.join(','),
          displayName: `chunk(${chunk.length})`,
          action: 'failed',
          previousHiringEntityId: null,
          reason,
        });
        continue;
      }

      for (const joDoc of jobOrdersSnap.docs) {
        summary.jobOrdersScanned += 1;
        const jo = joDoc.data() ?? {};
        const joName =
          typeof jo.jobOrderName === 'string' && jo.jobOrderName.trim()
            ? jo.jobOrderName.trim()
            : typeof jo.jobOrderNumber === 'string' && jo.jobOrderNumber.trim()
              ? `JO #${jo.jobOrderNumber.trim()}`
              : typeof jo.jobTitle === 'string' && jo.jobTitle.trim()
                ? jo.jobTitle.trim()
                : joDoc.id;

        const decision = decideHiringEntitySyncForDoc({
          currentValue: jo.hiringEntityId,
          nationalHiringEntityId,
        });

        // Snapshot mirror — only relevant for active JOs that have
        // captured a snapshot. Always re-stamp the snapshot when we
        // touch the top-level value so downstream readers stay
        // coherent (a JO with `hiringEntityId === X` and
        // `snapshot.hiringEntityId === Y` is a foot-gun the §16.1
        // L2 reader hides).
        const snapshot =
          jo.snapshot && typeof jo.snapshot === 'object'
            ? (jo.snapshot as Record<string, unknown>)
            : null;
        const hasSnapshot =
          !!snapshot && snapshot.capturedAt !== undefined && snapshot.capturedAt !== null;
        const snapshotCurrent =
          hasSnapshot && typeof snapshot![ 'hiringEntityId' ] === 'string'
            ? (snapshot!['hiringEntityId'] as string).trim()
            : '';
        const snapshotMatchesNational = snapshotCurrent === nationalHiringEntityId;

        try {
          if (decision.kind === 'update') {
            const update = stamp();
            if (hasSnapshot) {
              (update as Record<string, unknown>)['snapshot.hiringEntityId'] =
                nationalHiringEntityId;
              (update as Record<string, unknown>)['snapshot.lastPushedAt'] =
                FieldValue.serverTimestamp();
            }
            await joDoc.ref.update(update);
            summary.jobOrdersUpdated += 1;
            if (hasSnapshot) summary.jobOrderSnapshotsUpdated += 1;
            pushJobOrderAudit({
              jobOrderId: joDoc.id,
              displayName: joName,
              action: hasSnapshot ? 'updated_top_and_snapshot' : 'updated_top',
              previousHiringEntityId: decision.previous,
            });
          } else if (
            decision.kind === 'skip_same_value' &&
            hasSnapshot &&
            !snapshotMatchesNational
          ) {
            // Top-level matches but the snapshot drifted (e.g. an old
            // `pushToActive` mid-flight, a manual snapshot patch, or
            // a snapshot captured before the National value was set).
            // Re-stamp the snapshot to bring the JO into a coherent
            // state — top-level is already correct so this can't
            // surprise an operator.
            await joDoc.ref.update({
              'snapshot.hiringEntityId': nationalHiringEntityId,
              'snapshot.lastPushedAt': FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
              updatedBy: SYSTEM_ACTOR,
            });
            summary.jobOrderSnapshotsUpdated += 1;
            pushJobOrderAudit({
              jobOrderId: joDoc.id,
              displayName: joName,
              action: 'updated_snapshot_only',
              previousHiringEntityId: decision.previous,
              reason: 'snapshot_drifted_from_top_level',
            });
          } else {
            summary.jobOrdersSkipped += 1;
            pushJobOrderAudit({
              jobOrderId: joDoc.id,
              displayName: joName,
              action:
                decision.kind === 'skip_same_value'
                  ? 'skipped_same_value'
                  : 'skipped_existing',
              previousHiringEntityId: decision.previous,
              reason:
                decision.kind === 'skip_same_value'
                  ? 'already_matches_national'
                  : 'has_custom_value',
            });
          }
        } catch (err) {
          summary.jobOrdersFailed += 1;
          const reason = err instanceof Error ? err.message : String(err);
          logger.warn('syncNationalCascadingDefaults: job_order_failed', {
            tenantId,
            nationalAccountId,
            jobOrderId: joDoc.id,
            error: reason,
          });
          pushJobOrderAudit({
            jobOrderId: joDoc.id,
            displayName: joName,
            action: 'failed',
            previousHiringEntityId: null,
            reason,
          });
        }
      }
    }
  } else {
    pushJobOrderAudit({
      jobOrderId: nationalAccountId,
      displayName: 'national_account',
      action: 'skipped_no_national_he',
      previousHiringEntityId: null,
      reason: 'national_account_has_no_hiring_entity',
    });
  }

  return { summary, audit, jobOrderAudit };
}

export const syncNationalCascadingDefaultsToChildrenCallable = onCall(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300,
    cors: true,
    invoker: 'public',
  },
  async (request): Promise<SyncNationalCascadingDefaultsResult> => {
    const data = (request.data || {}) as {
      tenantId?: string;
      nationalAccountId?: string;
    };
    const tenantId = data.tenantId?.trim() || '';
    const nationalAccountId = data.nationalAccountId?.trim() || '';
    if (!tenantId || !nationalAccountId) {
      throw new HttpsError(
        'invalid-argument',
        'tenantId and nationalAccountId are required',
      );
    }
    await gateTenantStaffMinLevel(
      request,
      tenantId,
      5,
      'Insufficient permissions. National → child cascade sync requires security level 5+ on the requested tenant.',
    );

    const db = admin.firestore();
    const result = await runSyncNationalCascadingDefaultsToChildren({
      db,
      tenantId,
      nationalAccountId,
    });

    logger.info('syncNationalCascadingDefaults: done', {
      tenantId,
      nationalAccountId,
      uid: request.auth?.uid,
      ...result.summary,
    });

    return result;
  },
);
