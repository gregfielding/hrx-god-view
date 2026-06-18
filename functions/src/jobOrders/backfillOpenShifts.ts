/**
 * backfillOpenShifts — one-time / repeatable backfill that creates a standing
 * open shift for every existing eligible Job Order in a tenant.
 *
 * Eligibility (`isOpenShiftBackfillEligible`): active/open status (drafts +
 * terminal JOs skipped); gig JOs excluded unless `includeGig` is passed.
 * Idempotent — JOs that already have an open shift are skipped. Defaults to a
 * dry run so the caller can review counts before writing.
 *
 * Auth: tenant security level 5–7 (recruiter-admin) or an HRX token.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import {
  ensureOpenShiftForJobOrder,
  isOpenShiftBackfillEligible,
  jobOrderCrewSize,
  todayUtcIso,
  OPEN_SHIFT_JOB_TYPE_SCOPE_DEFAULT,
  type OpenShiftJobTypeScope,
} from './openShiftFromJobOrder';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

async function assertRecruiterAdmin(
  uid: string,
  token: Record<string, unknown> | undefined,
  tenantId: string,
): Promise<void> {
  if (token?.hrx === true) return;
  const userSnap = await db.collection('users').doc(uid).get();
  const data = (userSnap.data() || {}) as Record<string, any>;
  const nested = data.tenantIds?.[tenantId]?.securityLevel;
  const level = Number.parseInt(String(nested ?? data.securityLevel ?? '0'), 10) || 0;
  if (level >= 5 && level <= 7) return;
  throw new HttpsError('permission-denied', 'Backfilling open shifts requires tenant security level 5–7.');
}

interface BackfillSummary {
  dryRun: boolean;
  tenantId: string;
  scanned: number;
  created: number;
  wouldCreate: number;
  alreadyExists: number;
  skippedIneligible: number;
  /** reason → count, for the skipped/ineligible JOs. */
  skipReasons: Record<string, number>;
  /** Up to 25 example JO ids that were created / would be created. */
  examples: Array<{ jobOrderId: string; jobTitle: string; status: string; crewSize: number }>;
}

export const backfillOpenShifts = onCall(
  { cors: true, memory: '512MiB', timeoutSeconds: 540 },
  async (request): Promise<BackfillSummary> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const {
      tenantId,
      dryRun = true,
      scope = OPEN_SHIFT_JOB_TYPE_SCOPE_DEFAULT,
      limit,
    } = (request.data || {}) as {
      tenantId?: string;
      dryRun?: boolean;
      scope?: OpenShiftJobTypeScope;
      limit?: number;
    };
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required');
    await assertRecruiterAdmin(
      request.auth.uid,
      request.auth.token as Record<string, unknown>,
      tenantId,
    );

    const maxToCreate = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : Infinity;
    const startDate = todayUtcIso();

    const summary: BackfillSummary = {
      dryRun: !!dryRun,
      tenantId,
      scanned: 0,
      created: 0,
      wouldCreate: 0,
      alreadyExists: 0,
      skippedIneligible: 0,
      skipReasons: {},
      examples: [],
    };

    const joCol = db.collection('tenants').doc(tenantId).collection('job_orders');
    const PAGE = 300;
    let last: admin.firestore.QueryDocumentSnapshot | null = null;

    // Page through every JO ordered by document id (stable cursor).
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let q = joCol.orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE);
      if (last) q = q.startAfter(last.id);
      // eslint-disable-next-line no-await-in-loop
      const page = await q.get();
      if (page.empty) break;
      last = page.docs[page.docs.length - 1];

      for (const joDoc of page.docs) {
        summary.scanned += 1;
        const jobOrder = joDoc.data() as Record<string, any>;
        const elig = isOpenShiftBackfillEligible(jobOrder, { scope });
        if (!elig.eligible) {
          summary.skippedIneligible += 1;
          summary.skipReasons[elig.reason] = (summary.skipReasons[elig.reason] || 0) + 1;
          continue;
        }
        const reachedCap = summary.created >= maxToCreate;
        // eslint-disable-next-line no-await-in-loop
        const result = await ensureOpenShiftForJobOrder(db, {
          tenantId,
          jobOrderId: joDoc.id,
          jobOrder,
          startDate,
          createdBy: `system:backfillOpenShifts:${request.auth.uid}`,
          // Honor the cap by forcing dry-run once we've created enough.
          dryRun: !!dryRun || reachedCap,
        });
        if (result.outcome === 'already_exists') {
          summary.alreadyExists += 1;
        } else {
          // 'created' (live write) or 'would_create' (dry run / past the cap).
          if (result.outcome === 'created') summary.created += 1;
          else summary.wouldCreate += 1;
          if (summary.examples.length < 25) {
            summary.examples.push({
              jobOrderId: joDoc.id,
              jobTitle: String(jobOrder?.jobTitle ?? ''),
              status: String(jobOrder?.status ?? ''),
              crewSize: jobOrderCrewSize(jobOrder),
            });
          }
        }
      }
      if (page.size < PAGE) break;
    }

    return summary;
  },
);
