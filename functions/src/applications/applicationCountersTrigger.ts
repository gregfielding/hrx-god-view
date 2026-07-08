/**
 * applicationCountersTrigger — denormalized applicant counts.
 *
 * On any write to `tenants/{tid}/applications/{appId}`, recompute:
 *   - `job_orders/{jobOrderId}.applicantStats = { total, new, updatedAt }`
 *     — read by the Job Orders table's Applicants column (Greg, 2026-07-08:
 *     one compact column, total + "N new" badge). JO-scoped so it works for
 *     both a 100-headcount gig with many shifts and a single career posting.
 *   - `job_postings/{jobId}.applicationCount` — the posting-level counter
 *     the Jobs Board cards show. Applications stamp the posting doc id as
 *     `jobId` (doc ids are `{userId}_{postingId}`).
 *
 * Counting rules (from the live status distribution, 2026-07-08):
 *   total = submitted | confirmed | accepted | waitlisted | rejected
 *           (a real application, whatever came of it)
 *   new   = submitted (awaiting recruiter action)
 *   excluded: in_progress (abandoned wizard), withdrawn, deleted, missing.
 *
 * Full recompute per write (no increments) — drift-proof and cheap at this
 * volume; a JO's applications are a few dozen docs at most.
 */

import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const COUNTED_STATUSES = new Set(['submitted', 'confirmed', 'accepted', 'waitlisted', 'rejected']);
const NEW_STATUSES = new Set(['submitted']);

export interface ApplicantStats {
  total: number;
  new: number;
}

function tally(docs: FirebaseFirestore.QueryDocumentSnapshot[]): ApplicantStats {
  let total = 0;
  let newCount = 0;
  for (const d of docs) {
    const s = String(d.get('status') ?? '').toLowerCase();
    if (!COUNTED_STATUSES.has(s)) continue;
    total++;
    if (NEW_STATUSES.has(s)) newCount++;
  }
  return { total, new: newCount };
}

/** Recompute + write the JO-level stats. Exported for the backfill script. */
export async function recomputeJobOrderApplicantStats(
  tenantId: string,
  jobOrderId: string,
): Promise<ApplicantStats | null> {
  const joRef = db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`);
  const joSnap = await joRef.get();
  if (!joSnap.exists) return null;
  const apps = await db
    .collection(`tenants/${tenantId}/applications`)
    .where('jobOrderId', '==', jobOrderId)
    .select('status')
    .get();
  const stats = tally(apps.docs);
  await joRef.set(
    { applicantStats: { ...stats, updatedAt: admin.firestore.FieldValue.serverTimestamp() } },
    { merge: true },
  );
  return stats;
}

/** Recompute + write the posting-level counter. Exported for the backfill. */
export async function recomputePostingApplicationCount(
  tenantId: string,
  postingId: string,
): Promise<number | null> {
  const postRef = db.doc(`tenants/${tenantId}/job_postings/${postingId}`);
  const postSnap = await postRef.get();
  if (!postSnap.exists) return null;
  const apps = await db
    .collection(`tenants/${tenantId}/applications`)
    .where('jobId', '==', postingId)
    .select('status')
    .get();
  const stats = tally(apps.docs);
  await postRef.set(
    { applicationCount: stats.total, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true },
  );
  return stats.total;
}

export const onApplicationWriteUpdateCounters = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/applications/{applicationId}',
    region: 'us-central1',
    memory: '512MiB',
    maxInstances: 4,
  },
  async (event) => {
    const { tenantId } = event.params as { tenantId: string };
    const before = event.data?.before?.data() as Record<string, unknown> | undefined;
    const after = event.data?.after?.data() as Record<string, unknown> | undefined;

    // The identity fields never change on a given application, but cover a
    // delete (only `before`) and any weird migration writes by unioning.
    const jobOrderIds = new Set<string>();
    const postingIds = new Set<string>();
    for (const src of [before, after]) {
      if (!src) continue;
      if (typeof src.jobOrderId === 'string' && src.jobOrderId.trim()) jobOrderIds.add(src.jobOrderId.trim());
      if (typeof src.jobId === 'string' && src.jobId.trim()) postingIds.add(src.jobId.trim());
    }
    if (jobOrderIds.size === 0 && postingIds.size === 0) return;

    try {
      for (const joId of jobOrderIds) {
        await recomputeJobOrderApplicantStats(tenantId, joId);
      }
      for (const postId of postingIds) {
        await recomputePostingApplicationCount(tenantId, postId);
      }
    } catch (err) {
      logger.warn('[applicationCounters] recompute failed (non-fatal)', {
        tenantId,
        jobOrderIds: [...jobOrderIds],
        postingIds: [...postingIds],
        err: err instanceof Error ? err.message : String(err),
      });
    }
  },
);
