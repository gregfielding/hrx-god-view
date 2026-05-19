/**
 * **Slice 3 — production Firestore reader.**
 *
 * Implements the narrow `Reader` interface against the live admin
 * SDK. The trigger constructs one of these per invocation; matchers
 * receive it as a constructor arg so unit tests can swap in a mock.
 *
 * Collection paths used:
 *   - JobOrders:  `tenants/{tid}/job_orders/{joId}` → fallback
 *                 `tenants/{tid}/jobOrders/{joId}` → fallback
 *                 `tenants/{tid}/recruiter_jobOrders/{joId}`
 *                 (same chain the timesheet backfill uses)
 *   - Shifts:     top-level `/shifts` with `tenantId` denormalized
 *                 (per `backfillShiftsAndAssignments.ts` + canon)
 *   - Worksites:  `tenants/{tid}/locations` — venues are recruiter
 *                 location docs
 *   - Assignments: top-level `/assignments` with `tenantId` denormalized
 */

import type { Firestore } from 'firebase-admin/firestore';

import type { Reader, ReaderDoc } from './types';

export function createFirestoreReader(db: Firestore): Reader {
  return {
    async findJobOrderByPoNumber({ tenantId, jobId }) {
      const trimmed = String(jobId ?? '').trim();
      if (!trimmed) return null;
      for (const collectionName of ['job_orders', 'jobOrders', 'recruiter_jobOrders']) {
        try {
          const snap = await db
            .collection('tenants')
            .doc(tenantId)
            .collection(collectionName)
            .where('poNumber', '==', trimmed)
            .limit(1)
            .get();
          if (!snap.empty) {
            const d = snap.docs[0];
            return { id: d.id, data: d.data() as Record<string, unknown> };
          }
        } catch {
          // Walk the next candidate; some tenants only have one of the
          // three collections.
        }
      }
      return null;
    },

    async listShiftsForJobOrder({ tenantId, jobOrderId, workDate }) {
      let q = db
        .collection('shifts')
        .where('tenantId', '==', tenantId)
        .where('jobOrderId', '==', jobOrderId);
      if (workDate) q = q.where('shiftDate', '==', workDate);
      const snap = await q.limit(20).get();
      return snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
    },

    async listShiftsByWorksiteDate({ tenantId, worksiteId, workDate }) {
      const snap = await db
        .collection('shifts')
        .where('tenantId', '==', tenantId)
        .where('worksiteId', '==', worksiteId)
        .where('shiftDate', '==', workDate)
        .limit(20)
        .get();
      return snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
    },

    async findWorksiteByName({ tenantId, venueName }) {
      const target = String(venueName ?? '').trim();
      if (!target) return null;
      // Firestore doesn't have case-insensitive `contains`, so we
      // grab the first ~100 worksites for the tenant and do the
      // match in-memory. Tenants don't typically have more than a
      // few hundred locations; if they do, ops can add a
      // `nameLower` index later.
      const snap = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('locations')
        .limit(100)
        .get();
      const targetLower = target.toLowerCase();
      let exact: ReaderDoc | null = null;
      let contains: ReaderDoc | null = null;
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>;
        const name = String(data.name ?? data.nickname ?? '').trim();
        if (!name) continue;
        const lower = name.toLowerCase();
        if (lower === targetLower) {
          exact = { id: d.id, data };
          break;
        }
        if (!contains && lower.includes(targetLower)) {
          contains = { id: d.id, data };
        }
      }
      return exact ?? contains;
    },

    async listAssignmentsForShift({ tenantId, shiftId }) {
      const snap = await db
        .collection('assignments')
        .where('tenantId', '==', tenantId)
        .where('shiftId', '==', shiftId)
        .limit(50)
        .get();
      return snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
    },
  };
}
