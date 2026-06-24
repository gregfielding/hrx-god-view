/**
 * Cascade staff instructions onto every newly-created job order.
 *
 * Staff instructions cascade Account → Child → Location → JO, but the JO Staff-
 * Instructions tab reads the JO doc's own `staffInstructions` field directly —
 * so a JO only shows inherited instructions if something physically stamps the
 * resolved value onto it. The auto-gig creation path
 * (`gigJobOrderFromChildAccount.ts`) does that inline for AG.0 gig JOs, but
 * **manually created** job orders (the recruiter UI, `quickAddJobOrderCallable`,
 * the wizard, future API endpoints) never inherited anything — they opened with
 * blank instructions.
 *
 * This trigger fires on EVERY `job_orders/{jobOrderId}` create — one hook covers
 * every creation path without chasing call sites (same rationale as AG.1's
 * `onJobOrderCreatedAttachAutoUserGroup`). It seeds blank instruction sections
 * from the account chain and records the cascade snapshot so the post-creation
 * "Sync staff instructions to job orders" button can later refresh them.
 *
 * Safe by construction:
 *   - Only FILLS blank sections — never overwrites instructions present at
 *     create time (auto-gig inline stamp, or text the creator typed in the form).
 *   - Never throws: a cascade miss must not block JO creation.
 *   - onCreate only, so the seed write (an `.update()`) can't re-trigger it.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

import { createLoaderContext } from '../shared/cascade/loaders';
import { seedCascadedStaffInstructionsOnCreate } from './syncStaffInstructionsToJobOrders';

if (!admin.apps.length) {
  admin.initializeApp();
}

const LOG = {
  skippedNoData: 'cascadeStaffInstructionsOnCreate: skipped_no_data',
  skippedNoAccount: 'cascadeStaffInstructionsOnCreate: skipped_no_recruiter_account_id',
  seeded: 'cascadeStaffInstructionsOnCreate: seeded',
  skippedNoCascade: 'cascadeStaffInstructionsOnCreate: skipped_no_cascade',
  skippedComplete: 'cascadeStaffInstructionsOnCreate: skipped_already_complete',
  failed: 'cascadeStaffInstructionsOnCreate: failed',
} as const;

export const onJobOrderCreatedCascadeStaffInstructions = onDocumentCreated(
  {
    document: 'tenants/{tenantId}/job_orders/{jobOrderId}',
    region: 'us-central1',
    memory: '512MiB',
  },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const jobOrderId = event.params.jobOrderId as string;
    const data = event.data?.data() as Record<string, unknown> | undefined;

    if (!data || typeof data !== 'object') {
      logger.warn(LOG.skippedNoData, { tenantId, jobOrderId });
      return;
    }

    const recruiterAccountId =
      typeof data.recruiterAccountId === 'string' ? data.recruiterAccountId.trim() : '';
    if (!recruiterAccountId) {
      // No account to resolve a cascade chain against — nothing to inherit.
      logger.debug(LOG.skippedNoAccount, { tenantId, jobOrderId });
      return;
    }

    try {
      const db = admin.firestore();
      const ctx = createLoaderContext({ db });
      const result = await seedCascadedStaffInstructionsOnCreate({
        ctx,
        db,
        tenantId,
        jobOrderId,
        joData: data,
        cascadedFromAccountId: recruiterAccountId,
      });

      switch (result.action) {
        case 'seeded':
          logger.info(LOG.seeded, {
            tenantId,
            jobOrderId,
            recruiterAccountId,
            filledSections: result.filledKeys,
          });
          break;
        case 'skipped_no_cascade':
          logger.debug(LOG.skippedNoCascade, { tenantId, jobOrderId, recruiterAccountId });
          break;
        case 'skipped_already_complete':
          logger.debug(LOG.skippedComplete, { tenantId, jobOrderId, recruiterAccountId });
          break;
      }
    } catch (err) {
      // Never block JO creation on a cascade failure; the sync button is the
      // manual recovery path.
      logger.error(LOG.failed, {
        tenantId,
        jobOrderId,
        recruiterAccountId,
        err: String(err),
      });
    }
  },
);
