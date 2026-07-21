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
 *   - Shifts:     `tenants/{tid}/job_orders/{joId}/shifts` — the
 *                 SUBCOLLECTION the apply path and the rest of the
 *                 system treat as canonical. (2026-07-20 fix: this
 *                 reader originally queried a top-level `/shifts`
 *                 collection that turned out to hold 2 docs vs 600
 *                 real subcollection shifts — cancels/changes could
 *                 never match, which is why every stuck cancel row
 *                 sat at confidence 'none'.)
 *   - Worksites:  `tenants/{tid}/locations` — venues are recruiter
 *                 location docs
 *   - Assignments: `tenants/{tid}/assignments` (same 2026-07-20 fix —
 *                 the top-level `/assignments` collection is empty)
 */

import type { Firestore } from 'firebase-admin/firestore';

import type { Reader, ReaderDoc } from './types';
import { aliasDocIdFor } from './venueAliases';

/** Does a shift doc cover the given YYYY-MM-DD work date? Handles all
 *  three shift shapes: single-day (`shiftDate`), multi-day
 *  (`shiftDate`..`endDate` and/or a per-day `dateSchedule` map), and
 *  open/standing shifts (no end date = covers every future date). */
function shiftCoversDate(data: Record<string, unknown>, workDate: string): boolean {
  const day = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : '');
  const start = day(data.shiftDate) || day(data.startDate);
  const end = day(data.endDate);
  const ds = data.dateSchedule;
  if (ds && typeof ds === 'object' && workDate in (ds as Record<string, unknown>)) return true;
  if (start && start === workDate) return true;
  if (start && end && start <= workDate && workDate <= end) return true;
  if (data.shiftType === 'open' && start && start <= workDate && !end) return true;
  return false;
}

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
      const snap = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('job_orders')
        .doc(jobOrderId)
        .collection('shifts')
        .limit(50)
        .get();
      const all = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        // Subcollection shift docs don't all denorm jobOrderId; the
        // parent id is authoritative here, so guarantee it for callers.
        if (!data.jobOrderId) data.jobOrderId = jobOrderId;
        return { id: d.id, data };
      });
      if (!workDate) return all;
      return all.filter((s) => shiftCoversDate(s.data, workDate));
    },

    async listShiftsByWorksiteDate({ tenantId, worksiteId, workDate }) {
      // Shifts live under each JO, so resolve the worksite's job orders
      // first (both field spellings), then scan their subcollections.
      // JOs-per-worksite is small; this stays within automatic indexes.
      const joCol = db.collection('tenants').doc(tenantId).collection('job_orders');
      const [byWorksite, byLocation] = await Promise.all([
        joCol.where('worksiteId', '==', worksiteId).limit(15).get(),
        joCol.where('locationId', '==', worksiteId).limit(15).get(),
      ]);
      const joIds = Array.from(
        new Set([...byWorksite.docs, ...byLocation.docs].map((d) => d.id)),
      );
      const out: ReaderDoc[] = [];
      for (const joId of joIds) {
        const snap = await joCol.doc(joId).collection('shifts').limit(50).get();
        for (const d of snap.docs) {
          const data = d.data() as Record<string, unknown>;
          if (!data.jobOrderId) data.jobOrderId = joId;
          if (shiftCoversDate(data, workDate)) out.push({ id: d.id, data });
          if (out.length >= 20) return out;
        }
      }
      return out;
    },

    async listShiftsForAccountDate({ tenantId, accountId, workDate }) {
      // `recruiterAccountId` is the ONLY JO→account linkage field
      // populated in prod (probed 2026-07-20: companyId/accountId are
      // always absent on account-linked JOs). JOs-per-account is small.
      const joCol = db.collection('tenants').doc(tenantId).collection('job_orders');
      const jos = await joCol.where('recruiterAccountId', '==', accountId).limit(25).get();
      const out: ReaderDoc[] = [];
      for (const jo of jos.docs) {
        const snap = await joCol.doc(jo.id).collection('shifts').limit(50).get();
        for (const d of snap.docs) {
          const data = d.data() as Record<string, unknown>;
          if (!data.jobOrderId) data.jobOrderId = jo.id;
          if (shiftCoversDate(data, workDate)) out.push({ id: d.id, data });
          if (out.length >= 20) return out;
        }
      }
      return out;
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
        .collection('tenants')
        .doc(tenantId)
        .collection('assignments')
        .where('shiftId', '==', shiftId)
        .limit(50)
        .get();
      return snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
    },

    /**
     * **2026-05-24 — venue→account match.** Returns every account
     * under the tenant. Caller does the fuzzy match in-memory because
     * Firestore doesn't have case-insensitive substring queries. C1's
     * largest tenant has ~155 accounts (verified in the field), so a
     * single full read is cheap and avoids the headache of maintaining
     * a `nameLower` denorm.
     */
    async listAccounts({ tenantId }) {
      const snap = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('accounts')
        .get();
      return snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
    },

    /**
     * Find the "Indeed Flex inbox" Gig JO for an account. Greg's spec
     * (2026-05-24): each child account maintains a single rolling
     * open Gig JO; all single-day Indeed Flex requests for that
     * account land on it. Lookup: `job_orders` where
     * `recruiterAccountId == accountId` AND `jobType == 'gig'` AND
     * `status == 'open'`. When multiple match (legacy data), return
     * the most recently updated. When none match, return `null` so
     * the matcher can flag the gap.
     */
    async findInboxGigJobOrder({ tenantId, accountId }) {
      for (const collectionName of ['job_orders', 'jobOrders', 'recruiter_jobOrders']) {
        try {
          const snap = await db
            .collection('tenants')
            .doc(tenantId)
            .collection(collectionName)
            .where('recruiterAccountId', '==', accountId)
            .where('jobType', '==', 'gig')
            .where('status', '==', 'open')
            .limit(5)
            .get();
          if (snap.empty) continue;
          // Most recently updated wins. Firestore `orderBy` needs a
          // composite index for the where+order combo; skip the index
          // requirement and do the sort in-memory over the (small)
          // result set.
          const docs = snap.docs
            .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
            .sort((a, b) => {
              const aTs =
                ((a.data.updatedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0);
              const bTs =
                ((b.data.updatedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0);
              return bTs - aTs;
            });
          return docs[0] ?? null;
        } catch {
          // Walk the next candidate; same defensive shape as
          // `findJobOrderByPoNumber`.
        }
      }
      return null;
    },

    /**
     * **Venue alias short-circuit (Slice 3c).** Looks up a recruiter-
     * confirmed mapping at `tenants/{tid}/venue_aliases/{aliasDocId}`.
     * The doc id is derived from the normalized venue string so all
     * SVC-code variants of the same underlying venue collide on a
     * single alias entry. Returns null when no alias exists.
     */
    async getVenueAlias({ tenantId, rawVenueName }) {
      const docId = aliasDocIdFor(rawVenueName);
      if (!docId) return null;
      const snap = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('venue_aliases')
        .doc(docId)
        .get();
      if (!snap.exists) return null;
      const data = snap.data() as Record<string, unknown>;
      const accountId = typeof data.accountId === 'string' ? data.accountId.trim() : '';
      if (!accountId) return null;
      const accountName =
        typeof data.accountName === 'string' && data.accountName.trim()
          ? data.accountName.trim()
          : accountId;
      return { accountId, accountName };
    },
  };
}
