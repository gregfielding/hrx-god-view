/**
 * **AG.1.1 — Re-sync auto-user-group when a JO is moved between child accounts.**
 *
 * Sister trigger to `onJobOrderCreatedAttachAutoUserGroup` (AG.1) and the AG.0
 * gig-JO creation flow. AG.1 only runs on `onDocumentCreated`; this one watches
 * for `recruiterAccountId` edits on existing JOs and:
 *
 *   - Detaches the old child's auto-group from `autoMessagingUserGroupIds`
 *     (and `autoCreatedUserGroupId`).
 *   - Attaches the new child's auto-group(s) — same shape AG.1 writes.
 *
 * **What does NOT trigger this:**
 *
 *   - Updates that don't touch `recruiterAccountId` (most edits).
 *   - Updates where the value didn't actually change (recruiter clicks save
 *     with no diff).
 *   - The AG.0 follow-up `.update()` that stamps `autoCreatedUserGroupId`
 *     after the JO write — `recruiterAccountId` doesn't change in that update,
 *     so we never see it.
 *   - Updates where the new `recruiterAccountId` is empty/null. We detach the
 *     old auto-group and clear `autoCreatedUserGroupId` (no replacement).
 *
 * **Manual `autoMessagingUserGroupIds` entries are preserved.** We compute the
 * next array as `(currentList - oldAutoGroupId) ∪ newAutoGroupIds`, deduped.
 * Recruiter-added groups stay; only the previously-attached *auto* group is
 * removed.
 *
 * **Out of scope (deferred):**
 *
 *   - Following the move on the **linked posting** side. The posting's
 *     `autoAddToUserGroups` was last set by `createPostFromJobOrder` /
 *     `syncJobOrderToLinkedPostings`. After this trigger updates the JO's
 *     `autoCreatedUserGroupId`, the next `syncJobOrderToLinkedPostings`
 *     run will re-assert the new value (recruiter saves a shift, edits the
 *     JO, etc.). We don't proactively re-sync postings here because:
 *       1. Posting state is recruiter-owned (they explicitly attach groups
 *          per posting); the JO's auto-group is just one input.
 *       2. The JO move is rare; double-triggering posting writes adds noise
 *          to the audit trail.
 *     If real-time posting re-sync is needed later, call
 *     `syncJobOrderToLinkedPostings` here — it's already idempotent.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

import { lookupAutoUserGroupsForChild } from '../userGroups/ensureAutoUserGroup';

if (!admin.apps.length) {
  admin.initializeApp();
}

const SYSTEM_ACTOR = 'system_auto_user_group';

const LOG = {
  skippedNoChange: 'syncAutoUserGroup: skipped_no_change',
  skippedNoData: 'syncAutoUserGroup: skipped_no_data',
  detached: 'syncAutoUserGroup: detached_only',
  swapped: 'syncAutoUserGroup: swapped',
  attached: 'syncAutoUserGroup: attached',
  noOp: 'syncAutoUserGroup: noop_no_old_or_new',
  failed: 'syncAutoUserGroup: failed',
} as const;

/**
 * Pure decision: did `recruiterAccountId` actually change between two doc states?
 * Exported for unit tests so the early-out filter is asserted independently of
 * Firestore. Treats whitespace-only and missing values as equivalent to empty.
 */
export function recruiterAccountIdChanged(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): boolean {
  const norm = (raw: unknown): string =>
    typeof raw === 'string' ? raw.trim() : '';
  return norm(before?.recruiterAccountId) !== norm(after?.recruiterAccountId);
}

/**
 * Compute the next state of the auto-group fields given a recruiterAccountId
 * change. Pure — exported for unit tests. Returns `null` when no write is
 * needed (no old auto-group AND no new auto-groups).
 *
 * Semantics:
 *   - Drop `oldAutoGroupId` from `autoMessagingUserGroupIds` (manual entries
 *     and other auto entries are preserved).
 *   - Add every id in `newAutoGroupIds` (deduped).
 *   - Set `autoCreatedUserGroupId` to the first new id, or `null` if there
 *     are no new ones (the JO is no longer pinned to any auto-group).
 */
export function computeAutoUserGroupSyncPatch(args: {
  currentList: string[];
  oldAutoGroupId: string | null;
  newAutoGroupIds: string[];
}): { autoCreatedUserGroupId: string | null; autoMessagingUserGroupIds: string[] } | null {
  const { oldAutoGroupId, newAutoGroupIds } = args;
  const currentList = Array.isArray(args.currentList)
    ? args.currentList.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    : [];

  const noChange = !oldAutoGroupId && newAutoGroupIds.length === 0;
  if (noChange) return null;

  const filtered = oldAutoGroupId
    ? currentList.filter((id) => id !== oldAutoGroupId)
    : currentList.slice();
  const nextList = Array.from(new Set([...filtered, ...newAutoGroupIds]));
  const nextPrimary = newAutoGroupIds.length > 0 ? newAutoGroupIds[0] : null;
  return {
    autoCreatedUserGroupId: nextPrimary,
    autoMessagingUserGroupIds: nextList,
  };
}

export const onJobOrderUpdatedSyncAutoUserGroup = onDocumentUpdated(
  'tenants/{tenantId}/job_orders/{jobOrderId}',
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const jobOrderId = event.params.jobOrderId as string;

    const before = event.data?.before?.data() as Record<string, unknown> | undefined;
    const after = event.data?.after?.data() as Record<string, unknown> | undefined;
    if (!after) {
      logger.warn(LOG.skippedNoData, { tenantId, jobOrderId });
      return;
    }

    if (!recruiterAccountIdChanged(before, after)) {
      // Most updates land here — quiet exit, no log noise.
      return;
    }

    const oldAutoGroupId =
      typeof before?.autoCreatedUserGroupId === 'string' && before.autoCreatedUserGroupId.trim() !== ''
        ? before.autoCreatedUserGroupId.trim()
        : null;
    const newChildAccountId =
      typeof after.recruiterAccountId === 'string' ? after.recruiterAccountId.trim() : '';

    try {
      const db = admin.firestore();

      const newAutoGroupIds = newChildAccountId
        ? await lookupAutoUserGroupsForChild({ db, tenantId, childAccountId: newChildAccountId })
        : [];

      const currentList = Array.isArray(after.autoMessagingUserGroupIds)
        ? (after.autoMessagingUserGroupIds as unknown[]).filter(
            (x): x is string => typeof x === 'string',
          )
        : [];

      const patch = computeAutoUserGroupSyncPatch({
        currentList,
        oldAutoGroupId,
        newAutoGroupIds,
      });

      if (!patch) {
        logger.debug(LOG.noOp, { tenantId, jobOrderId, oldAutoGroupId, newChildAccountId });
        return;
      }

      await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).update({
        autoCreatedUserGroupId: patch.autoCreatedUserGroupId,
        autoMessagingUserGroupIds: patch.autoMessagingUserGroupIds,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: SYSTEM_ACTOR,
      });

      // Pick the most informative log channel for the resulting transition.
      const verb =
        oldAutoGroupId && newAutoGroupIds.length > 0
          ? LOG.swapped
          : newAutoGroupIds.length > 0
            ? LOG.attached
            : LOG.detached;
      logger.info(verb, {
        tenantId,
        jobOrderId,
        oldAutoGroupId,
        newChildAccountId,
        newAutoGroupIds,
      });
    } catch (err) {
      // Never throw — a sync failure should not block whatever workflow was
      // editing the JO. The next manual save / `syncJobOrderToLinkedPostings`
      // pass will eventually re-assert the right state.
      logger.error(LOG.failed, {
        tenantId,
        jobOrderId,
        oldAutoGroupId,
        newChildAccountId,
        err: String(err),
      });
    }
  },
);
