/**
 * **AG.1 — Attach existing auto-group to new JOs under the same child.**
 *
 * Companion to AG.0 (`gigJobOrderFromChildAccount.ts` + `ensureAutoUserGroup.ts`).
 *
 * AG.0 only attaches an auto-group on the auto-created gig JO that runs alongside
 * an auto-created child account. AG.1 closes the gap for **every other JO** under
 * an auto-created child:
 *
 *   - Recruiter manually creates a second gig JO under "Las Vegas Forklift"
 *     for a different shift pattern → the existing
 *     `auto_{childAccountId}_forklift_driver` group is auto-attached to the new JO.
 *   - Recruiter promotes the gig role to a permanent placement JO under the
 *     same child → same group, same auto-attach.
 *   - Recruiter recreates a JO they archived → group re-attaches on the fresh doc.
 *
 * The trigger fires on **every** `job_orders/{jobOrderId}` create — manual UI flow,
 * `quickAddJobOrderCallable`, admin tools, future API endpoints. One hook covers
 * every JO-creation path without us having to chase call sites.
 *
 * ### Why we don't just put this in the JO create call site
 *
 *   - There are several call sites (RecruiterJobOrderDetail, callables, the wizard).
 *   - The trigger is idempotent — re-runs do nothing because `autoCreatedUserGroupId`
 *     is already set after the first run.
 *   - Manual JO creation is rarer than the trigger overhead. Latency is fine.
 *
 * ### Skip rules (cheapest first)
 *
 *   1. No `recruiterAccountId` → exit. Nothing to look up against.
 *   2. `autoCreatedUserGroupId` already set → exit. AG.0 already handled it (or a
 *      previous run of this trigger did).
 *   3. `autoCreatedFrom === 'autoCreateGigJobOrders'` → exit. This is the AG.0
 *      auto-JO path; AG.0's follow-up `.update()` will set `autoCreatedUserGroupId`
 *      shortly. We don't want to race that update — letting AG.0 own the field
 *      keeps the audit trail clean (auto-JO + dedicated auto-group are paired).
 *   4. Query `userGroups` for `autoCreatedFrom.childAccountId == recruiterAccountId`.
 *      v1 returns 0 or 1 result (one default job title per National). Future
 *      multi-title fan-out: every match goes into `autoMessagingUserGroupIds`,
 *      and the first (sorted by doc id) becomes the JO's `autoCreatedUserGroupId`.
 *
 * ### What it writes
 *
 *   - `autoCreatedUserGroupId`: first matching auto-group's id. The JO is now
 *     tied to that group for posting-sync purposes (`createPostFromJobOrder` and
 *     `syncJobOrderToLinkedPostings` already read this field).
 *   - `autoMessagingUserGroupIds`: union-merge of all matching auto-group ids.
 *     The egress side (`runJobOrderAutoMessagingForShift`) reads this list, so
 *     new shifts on this JO fan out to group members.
 *   - `updatedAt` / `updatedBy`: stamped with the system actor literal.
 *
 * ### What it doesn't do
 *
 *   - Doesn't create groups. That's `ensureAutoUserGroup`'s job (AG.0 only).
 *   - Doesn't touch the linked posting directly. Posting sync is already wired
 *     via `jobsBoardService.syncJobOrderToLinkedPostings`, which the JO update
 *     call sites already invoke.
 *   - Doesn't run on JO updates / writes — only on create. A recruiter editing
 *     `recruiterAccountId` post-creation is a rare edge case and explicitly
 *     out of scope for v1.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

import { lookupAutoUserGroupsForChild } from '../userGroups/ensureAutoUserGroup';

if (!admin.apps.length) {
  admin.initializeApp();
}

const SYSTEM_ACTOR = 'system_auto_user_group';

const LOG = {
  skippedNoData: 'attachAutoUserGroup: skipped_no_data',
  skippedNoChild: 'attachAutoUserGroup: skipped_no_recruiter_account_id',
  skippedAlreadySet: 'attachAutoUserGroup: skipped_already_set',
  skippedAutoCreated: 'attachAutoUserGroup: skipped_ag0_auto_created_jo',
  skippedNoGroup: 'attachAutoUserGroup: skipped_no_auto_group_for_child',
  attached: 'attachAutoUserGroup: attached',
  failed: 'attachAutoUserGroup: failed',
} as const;

type SkipReason =
  | 'skipped_no_data'
  | 'skipped_no_recruiter_account_id'
  | 'skipped_already_set'
  | 'skipped_ag0_auto_created_jo'
  | 'skipped_no_auto_group_for_child'
  | null;

/**
 * Pure decision: should AG.1 run for this JO doc? Exported for unit tests so the
 * skip-rule order is asserted independently of Firestore.
 *
 * Returns `null` when the trigger should proceed (and run the group lookup),
 * or a skip reason string when it should bail without a query.
 */
export function decideShouldAttachAutoUserGroup(jobOrder: Record<string, unknown> | undefined): SkipReason {
  if (!jobOrder || typeof jobOrder !== 'object') return 'skipped_no_data';

  const childAccountId = typeof jobOrder.recruiterAccountId === 'string'
    ? jobOrder.recruiterAccountId.trim()
    : '';
  if (!childAccountId) return 'skipped_no_recruiter_account_id';

  const alreadyAttached = typeof jobOrder.autoCreatedUserGroupId === 'string'
    && jobOrder.autoCreatedUserGroupId.trim() !== '';
  if (alreadyAttached) return 'skipped_already_set';

  // AG.0 marker — set on the initial JO write, BEFORE the follow-up .update() that
  // attaches the dedicated auto-group. Letting AG.0 own that update keeps the audit
  // (auto-JO ↔ auto-group pair) tidy and avoids racing the two writes.
  if (jobOrder.autoCreatedFrom === 'autoCreateGigJobOrders') return 'skipped_ag0_auto_created_jo';

  return null;
}

export const onJobOrderCreatedAttachAutoUserGroup = onDocumentCreated(
  'tenants/{tenantId}/job_orders/{jobOrderId}',
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const jobOrderId = event.params.jobOrderId as string;
    const data = event.data?.data() as Record<string, unknown> | undefined;

    const skip = decideShouldAttachAutoUserGroup(data);
    if (skip) {
      // Quiet log — these are the common cases (most JOs aren't under an
      // auto-created child, or AG.0 owns the attach already).
      switch (skip) {
        case 'skipped_no_data':
          logger.warn(LOG.skippedNoData, { tenantId, jobOrderId });
          break;
        case 'skipped_no_recruiter_account_id':
          logger.debug(LOG.skippedNoChild, { tenantId, jobOrderId });
          break;
        case 'skipped_already_set':
          logger.debug(LOG.skippedAlreadySet, {
            tenantId,
            jobOrderId,
            autoCreatedUserGroupId: data?.autoCreatedUserGroupId,
          });
          break;
        case 'skipped_ag0_auto_created_jo':
          logger.debug(LOG.skippedAutoCreated, { tenantId, jobOrderId });
          break;
      }
      return;
    }

    const childAccountId = (data!.recruiterAccountId as string).trim();

    try {
      const db = admin.firestore();
      const groupIds = await lookupAutoUserGroupsForChild({ db, tenantId, childAccountId });
      if (groupIds.length === 0) {
        logger.debug(LOG.skippedNoGroup, { tenantId, jobOrderId, childAccountId });
        return;
      }

      // First (sorted) becomes the canonical denorm pointer; all of them get
      // union-merged into the auto-message recipients list. Posting sync
      // (`syncJobOrderToLinkedPostings`) reads `autoCreatedUserGroupId` and copies
      // it down into the linked posting's `autoAddToUserGroups` — that path Just Works
      // once we set the field here.
      const primaryGroupId = groupIds[0];

      await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).update({
        autoCreatedUserGroupId: primaryGroupId,
        autoMessagingUserGroupIds: admin.firestore.FieldValue.arrayUnion(...groupIds),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: SYSTEM_ACTOR,
      });

      logger.info(LOG.attached, {
        tenantId,
        jobOrderId,
        childAccountId,
        autoCreatedUserGroupId: primaryGroupId,
        attachedGroupCount: groupIds.length,
      });
    } catch (err) {
      // Never throw — a failed attach should not block whatever workflow created
      // the JO. The next manual edit on the JO will trigger
      // `syncJobOrderToLinkedPostings` and (if the recruiter notices the missing
      // group) they can attach manually. Future: a backfill callable parallel to
      // `backfillGigJobOrdersForNationalAccount` could re-run this for misses.
      logger.error(LOG.failed, { tenantId, jobOrderId, childAccountId, err: String(err) });
    }
  },
);
