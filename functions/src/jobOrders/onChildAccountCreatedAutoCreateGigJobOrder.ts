/**
 * **§14 / #45** — Auto-Create Gig Job Orders trigger.
 *
 * Companion to the Auto-Create Child Accounts trigger
 * (`autoChildAccountFromCompanyLocation.ts`). When a new child account is
 * auto-created under a National Account that has BOTH toggles ON, this
 * trigger spawns a draft Gig job order for the new child.
 *
 * Pipeline:
 *
 *   crm_companies/{companyId}/locations/{locationId}            (location create)
 *     ─▶ onCompanyLocationCreated                                (mirror trigger)
 *     ─▶ maybeAutoCreateChildAccountForNewLocation               (auto-create)
 *           writes tenants/{tenantId}/accounts/{newChildId}
 *                 with autoCreatedFromCompanyLocation: true
 *     ─▶ THIS trigger fires on the new child doc
 *           ↳ if parent.autoCreateGigJobOrders === true
 *           ↳ delegates to createGigJobOrderForChildAccount (shared helper)
 *           ↳ notifies assigned recruiter(s)
 *
 * **Field-mapping is centralized.** The actual JO doc construction lives in
 * `gigJobOrderFromChildAccount.ts` so both this trigger and the §14b
 * backfill callable produce byte-identical-shape JOs. See that file for
 * the spec + design notes.
 *
 * Design principles:
 *
 *   - **Passive consumer of cascade**: hiringEntity, eVerifyRequired,
 *     screeningPackageId, additionalScreenings, and position pricing all
 *     flow down via the shared helper's cascade resolution. The trigger
 *     makes ZERO policy decisions about employment classification.
 *
 *   - **Auto-create-only entry point**: the trigger early-returns unless
 *     `child.autoCreatedFromCompanyLocation === true`. Manual child-account
 *     creation never spawns a gig JO — the recruiter is already in the
 *     JO-creation flow and we'd duplicate work.
 *
 *   - **Idempotent**: the shared helper checks for an existing auto-JO
 *     with the `autoCreatedFrom` marker before writing.
 *
 * Out of scope (per spec):
 *   - Multi-location children (one JO per child for v1).
 *   - Auto-activation / auto-publish.
 *   - Bulk historical backfill — covered by §14b's
 *     `backfillGigJobOrdersForNationalAccount` callable.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

import { createNotification } from '../utils/createNotification';
import {
  type AccountDoc,
  createGigJobOrderForChildAccount,
  trim,
} from './gigJobOrderFromChildAccount';

if (!admin.apps.length) {
  admin.initializeApp();
}

// Re-export the shared helper for tests + downstream callers that
// imported from this file before the §14b refactor.
export { createGigJobOrderForChildAccount } from './gigJobOrderFromChildAccount';

const LOG = {
  skippedNoParent: 'autoGigJobOrder: skipped_no_parent',
  skippedManualChild: 'autoGigJobOrder: skipped_manual_child_creation',
  skippedToggleOff: 'autoGigJobOrder: skipped_toggle_off',
  skippedDuplicate: 'autoGigJobOrder: skipped_duplicate_existing_auto_jo',
  created: 'autoGigJobOrder: created',
  notifyFailed: 'autoGigJobOrder: notify_recipient_failed',
  failed: 'autoGigJobOrder: failed',
} as const;

// ─────────────────────────────────────────────────────────────────────
// Pure decision unit — exported for unit tests
// ─────────────────────────────────────────────────────────────────────

export type ShouldCreateGigJobOrderDecision =
  | { kind: 'create' }
  | { kind: 'skip_no_data' }
  | { kind: 'skip_not_child' }
  | { kind: 'skip_no_parent' }
  | { kind: 'skip_manual_child' }
  | { kind: 'skip_parent_missing' }
  | { kind: 'skip_toggle_off' };

export interface DecideShouldCreateGigJobOrderArgs {
  child: AccountDoc | null | undefined;
  /** Parent doc data. `null` if parent doc doesn't exist. */
  parent: AccountDoc | null | undefined;
}

/**
 * Pure gating logic: should the trigger spawn a gig JO for this child
 * account? Decision priority mirrors the trigger flow (cheapest checks
 * first):
 *
 *   1. data missing
 *   2. wrong account type
 *   3. no parent linkage
 *   4. NOT auto-created (manual children never spawn a gig JO)
 *   5. parent doc missing
 *   6. parent toggle OFF
 *
 * Note: the §14b backfill callable does NOT use this decision — it
 * intentionally bypasses the `skip_manual_child` guard so historical
 * manually-created children still get a gig JO.
 */
export function decideShouldCreateGigJobOrder(
  args: DecideShouldCreateGigJobOrderArgs,
): ShouldCreateGigJobOrderDecision {
  const { child, parent } = args;

  if (!child) return { kind: 'skip_no_data' };
  if (child.accountType !== 'child') return { kind: 'skip_not_child' };
  if (!trim(child.parentAccountId)) return { kind: 'skip_no_parent' };
  if (child.autoCreatedFromCompanyLocation !== true) {
    return { kind: 'skip_manual_child' };
  }
  if (!parent) return { kind: 'skip_parent_missing' };
  if (parent.autoCreateGigJobOrders !== true) {
    return { kind: 'skip_toggle_off' };
  }
  return { kind: 'create' };
}

// ─────────────────────────────────────────────────────────────────────
// Notification dispatch
// ─────────────────────────────────────────────────────────────────────

/**
 * Surface "new gig JO needs review" to each assigned recruiter. Per-
 * recipient failures are logged and swallowed — a notification miss
 * should never fail the JO creation. The user-visible JO is the source
 * of truth for the recruiter's queue.
 */
async function notifyRecruitersOfAutoGigJobOrder(args: {
  tenantId: string;
  jobOrderId: string;
  childAccountName: string;
  recruiterUids: string[];
}): Promise<void> {
  const { tenantId, jobOrderId, childAccountName, recruiterUids } = args;
  if (recruiterUids.length === 0) return;

  const message = `New gig job order auto-created for ${childAccountName}. Review and activate when ready.`;

  await Promise.all(
    recruiterUids.map(async (uid) => {
      try {
        await createNotification({
          recipientType: 'user',
          recipientId: uid,
          type: 'auto_gig_job_order_created',
          message,
          actions: ['review', 'activate'],
          relatedId: jobOrderId,
        });
      } catch (err) {
        logger.warn(LOG.notifyFailed, {
          tenantId,
          jobOrderId,
          recruiterUid: uid,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────
// Trigger
// ─────────────────────────────────────────────────────────────────────

/**
 * Fires on `tenants/{tenantId}/accounts/{accountId}` create. Thin gating
 * wrapper around `createGigJobOrderForChildAccount` (the shared helper)
 * — keeps the helper testable in isolation while the trigger owns the
 * early-return decisions + notification dispatch.
 */
export const onChildAccountCreatedAutoCreateGigJobOrder = onDocumentCreated(
  'tenants/{tenantId}/accounts/{accountId}',
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const accountId = event.params.accountId as string;
    const child = event.data?.data() as AccountDoc | undefined;

    // Pre-parent-fetch decision: cheap fields only. Splitting the
    // decision into "before parent fetch" + "after parent fetch" so we
    // don't pay the parent doc read for every account-create event.
    const preDecision = decideShouldCreateGigJobOrder({
      child,
      parent: undefined,
    });
    if (
      preDecision.kind === 'skip_no_data' ||
      preDecision.kind === 'skip_not_child' ||
      preDecision.kind === 'skip_no_parent' ||
      preDecision.kind === 'skip_manual_child'
    ) {
      switch (preDecision.kind) {
        case 'skip_no_parent':
          logger.info(LOG.skippedNoParent, { tenantId, accountId });
          break;
        case 'skip_manual_child':
          logger.info(LOG.skippedManualChild, { tenantId, accountId });
          break;
        // skip_no_data + skip_not_child: silent — high-volume noise.
      }
      return;
    }

    const parentAccountId = trim(child!.parentAccountId);
    const db = admin.firestore();
    const parentSnap = await db
      .doc(`tenants/${tenantId}/accounts/${parentAccountId}`)
      .get();
    const parent = parentSnap.exists
      ? (parentSnap.data() as AccountDoc)
      : null;

    const postDecision = decideShouldCreateGigJobOrder({ child, parent });
    if (postDecision.kind !== 'create') {
      switch (postDecision.kind) {
        case 'skip_parent_missing':
          logger.warn(LOG.skippedNoParent, {
            tenantId,
            accountId,
            parentAccountId,
            reason: 'parent_doc_missing',
          });
          break;
        case 'skip_toggle_off':
          logger.info(LOG.skippedToggleOff, {
            tenantId,
            accountId,
            parentAccountId,
          });
          break;
      }
      return;
    }

    try {
      // `postDecision.kind === 'create'` narrows child + parent
      // semantically but TS can't follow it across the boolean call —
      // assert non-null.
      const result = await createGigJobOrderForChildAccount({
        tenantId,
        childAccountId: accountId,
        childAccount: child!,
        parentAccount: parent!,
        source: 'auto_create_trigger',
      });

      if (!result) {
        logger.info(LOG.skippedDuplicate, { tenantId, accountId });
        return;
      }

      logger.info(LOG.created, {
        tenantId,
        accountId,
        parentAccountId,
        jobOrderId: result.jobOrderId,
        jobOrderNumber: result.jobOrderNumber,
        assignedRecruiterCount: result.assignedRecruiterUids.length,
      });

      await notifyRecruitersOfAutoGigJobOrder({
        tenantId,
        jobOrderId: result.jobOrderId,
        childAccountName: result.childAccountName,
        recruiterUids: result.assignedRecruiterUids,
      });
    } catch (err) {
      logger.error(LOG.failed, {
        tenantId,
        accountId,
        parentAccountId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      // Don't rethrow — the child account already exists and the
      // recruiter can still create a JO manually. Re-firing this
      // trigger via doc rewrites isn't worth the duplicate-JO risk.
    }
  },
);
