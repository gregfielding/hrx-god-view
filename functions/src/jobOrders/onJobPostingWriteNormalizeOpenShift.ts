/**
 * Server-side auto-heal for the open-shift "Show on jobs board" feature.
 *
 * The current client model surfaces an open shift as a normal "Ongoing ·
 * flexible hours" shift row on a standard gig posting. An EARLIER (now removed)
 * client model instead set `applyMode: 'express_interest'` on the posting and
 * hid the shift — which renders the wrong layout and breaks apply. Stale/cached
 * client bundles still run that old code and re-corrupt the data on every save.
 *
 * This trigger makes the data self-correct: whenever a job posting is written
 * with `applyMode === 'express_interest'` AND its job order has a "show on jobs
 * board" open shift, it clears the marker and publishes the matching
 * per-position posting (pausing a stray JO-level one) and un-hides the open
 * shift(s) for that position — so they show as normal applyable shifts.
 *
 * Idempotent: once `applyMode` is cleared the re-fire is a no-op. Posting writes
 * here don't re-trigger (the marker is gone); shift writes go to a different
 * collection. No legit use of `applyMode` remains, and the trigger only acts
 * when a `showOnJobsBoard` open shift exists, so it can't disturb normal gigs.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

if (!admin.apps.length) {
  admin.initializeApp();
}

const FieldValue = admin.firestore.FieldValue;
const SYSTEM_ACTOR = 'system_open_shift_posting_autoheal';

const norm = (s: unknown): string => (typeof s === 'string' ? s.trim().toLowerCase() : '');

export const onJobPostingWriteNormalizeOpenShift = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/job_postings/{postId}',
    region: 'us-central1',
    memory: '512MiB',
  },
  async (event) => {
    const after = event.data?.after?.data() as Record<string, unknown> | undefined;
    if (!after) return; // deleted
    if (after.applyMode !== 'express_interest') return; // nothing to heal

    const tenantId = event.params.tenantId as string;
    const postId = event.params.postId as string;
    const jobOrderId = typeof after.jobOrderId === 'string' ? after.jobOrderId.trim() : '';
    if (!jobOrderId) return;

    try {
      const db = admin.firestore();
      const shiftsSnap = await db
        .collection(`tenants/${tenantId}/job_orders/${jobOrderId}/shifts`)
        .get();
      const openShown = shiftsSnap.docs.filter((d) => {
        const s = d.data() as Record<string, unknown>;
        return s.shiftType === 'open' && s.showOnJobsBoard === true;
      });
      if (openShown.length === 0) return; // not an open-shift "show on board" JO

      const openTitles = new Set(openShown.map((d) => norm((d.data() as Record<string, unknown>).defaultJobTitle)));
      const postPosition = norm(after.positionJobTitle);
      // The per-position posting that matches an open shift = the one the
      // recruiter shares → publish it. A JO-level / non-matching one is a stray
      // → just clear the marker and pause it.
      const matches = openTitles.has(postPosition);

      await db.doc(`tenants/${tenantId}/job_postings/${postId}`).update({
        applyMode: FieldValue.delete(),
        ...(matches ? { visibility: 'public', status: 'active' } : { status: 'paused' }),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: SYSTEM_ACTOR,
      });

      // Un-hide the open shift(s) for this posting's position so they appear in
      // the shift list. Only flip when currently hidden (avoid needless writes).
      await Promise.all(
        openShown
          .filter((d) => {
            const s = d.data() as Record<string, unknown>;
            const titleOk = !postPosition || norm(s.defaultJobTitle) === postPosition;
            return titleOk && s.hideFromJobsBoard === true;
          })
          .map((d) =>
            d.ref.update({
              hideFromJobsBoard: false,
              updatedAt: FieldValue.serverTimestamp(),
              updatedBy: SYSTEM_ACTOR,
            }),
          ),
      );

      logger.info('openShiftPostingAutoHeal: normalized', {
        tenantId,
        postId,
        jobOrderId,
        matchedPosition: matches,
        unhid: openShown.length,
      });
    } catch (err) {
      logger.error('openShiftPostingAutoHeal: failed', {
        tenantId,
        postId,
        jobOrderId,
        err: String(err),
      });
    }
  },
);
