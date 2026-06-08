import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Active application statuses that should be auto-withdrawn when one of the
 * user's other applications is hired for the same day. Module-level constant
 * so the same array is used for both the server-side query filter and the
 * in-memory belt-and-suspenders check below.
 */
const ACTIVE_STATUSES = [
  'submitted',
  'accepted',
  'screened',
  'advanced',
  'interview',
  'offer_pending',
  'offer',
] as const;

const FIRESTORE_BATCH_LIMIT = 450; // Firestore allows 500/batch — we leave headroom.

/**
 * Extract the date portion (YYYY-MM-DD) from a shift date string.
 */
function extractDateFromShiftDate(shiftDate: string): string {
  return shiftDate.split('T')[0];
}

function parseLocalYyyyMmDd(dateStr: string): Date | null {
  const d = extractDateFromShiftDate(dateStr || '');
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(y, m - 1, day);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function expandDateRangeInclusive(startDate: string, endDate: string): string[] {
  const start = parseLocalYyyyMmDd(startDate);
  const end = parseLocalYyyyMmDd(endDate);
  if (!start || !end) return [];

  const maxDays = 400;
  const dates: string[] = [];
  const cur = new Date(start);
  let count = 0;
  while (cur <= end && count < maxDays) {
    dates.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`);
    cur.setDate(cur.getDate() + 1);
    count++;
  }
  return dates;
}

/**
 * Read shift dates directly from the in-doc fields without doing any Firestore
 * reads. Returns the deduped list, which may be empty (caller decides whether
 * to fall back to fetching shift documents).
 */
function readInDocShiftDates(applicationData: admin.firestore.DocumentData): string[] {
  const out = new Set<string>();
  if (applicationData.shiftDate) {
    out.add(extractDateFromShiftDate(applicationData.shiftDate));
  }
  if (Array.isArray(applicationData.shiftDates)) {
    for (const date of applicationData.shiftDates) {
      if (typeof date === 'string' && date) out.add(extractDateFromShiftDate(date));
    }
  }
  return [...out];
}

/**
 * Fetch a single shift doc and expand it into its date(s). One Firestore read
 * per shift; safe to call in parallel with Promise.all.
 */
async function readShiftDatesFromDoc(
  tenantId: string,
  jobOrderId: string,
  shiftId: string,
): Promise<string[]> {
  try {
    const shiftSnap = await db
      .collection('tenants').doc(tenantId)
      .collection('job_orders').doc(jobOrderId)
      .collection('shifts').doc(shiftId)
      .get();
    if (!shiftSnap.exists) return [];
    const shiftData = shiftSnap.data();
    if (!shiftData?.shiftDate) return [];
    const start = extractDateFromShiftDate(shiftData.shiftDate);
    const end = shiftData?.endDate ? extractDateFromShiftDate(shiftData.endDate) : start;
    const isMulti = shiftData?.shiftMode === 'multi' && !!end && end !== start;
    return isMulti ? expandDateRangeInclusive(start, end) : [start];
  } catch (error) {
    console.error(`Error fetching shift date for ${shiftId}:`, error);
    return [];
  }
}

/**
 * Get shift date(s) for an application. Prefers in-doc fields (free); only
 * touches Firestore as a fallback. When fallback is needed and there are
 * multiple shiftIds, all reads happen in parallel.
 */
async function getShiftDatesForApplication(
  tenantId: string,
  applicationData: admin.firestore.DocumentData,
): Promise<string[]> {
  const inDoc = readInDocShiftDates(applicationData);
  if (inDoc.length > 0) return inDoc; // Cheap path: skip Firestore.

  const jobOrderId = applicationData.jobOrderId;
  if (!jobOrderId) return [];

  const shiftIds: string[] = [];
  if (applicationData.shiftId) shiftIds.push(String(applicationData.shiftId));
  if (Array.isArray(applicationData.shiftIds)) {
    for (const sid of applicationData.shiftIds) {
      if (sid && !shiftIds.includes(String(sid))) shiftIds.push(String(sid));
    }
  }
  if (shiftIds.length === 0) return [];

  // Parallel shift-doc reads.
  const results = await Promise.all(
    shiftIds.map((sid) => readShiftDatesFromDoc(tenantId, jobOrderId, sid)),
  );
  const out = new Set<string>();
  for (const dates of results) {
    for (const d of dates) out.add(d);
  }
  return [...out];
}

/**
 * Auto-withdraw OTHER active applications when one is hired.
 *
 * Trigger fires on every application update; the no-op fast path bails before
 * any Firestore reads if the status didn't transition into 'hired'. Only the
 * (rare) hire transition does real work.
 *
 * Hot-path optimizations vs the original (each one avoids paid I/O):
 *   1. Server-side status filter — query returns only candidate apps, not
 *      every application this user has.
 *   2. In-doc shift dates short-circuit shift-doc reads when possible.
 *   3. Per-candidate shift-date lookups run in parallel (Promise.all).
 *   4. Withdraw writes go through a single batched commit (≤450 per batch).
 *
 * Withdrawing an app re-fires this trigger; that fire bails at line ~149
 * (status went to 'withdrawn', not 'hired') and does no extra work.
 */
export const autoWithdrawApplicationsOnHire = onDocumentUpdated(
  {
    document: 'tenants/{tenantId}/applications/{applicationId}',
    region: 'us-central1',
    maxInstances: 10,
    timeoutSeconds: 540,
    memory: '256MiB',
  },
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    // Cheap no-op fast path — runs on every application update. No Firestore
    // I/O, no log spam. Order the cheapest checks first so we bail with
    // minimum work; nothing here costs more than a property access.
    if (!beforeData || !afterData) return;
    if (afterData.status !== 'hired') return; // Cheapest, most-frequent skip.
    if (beforeData.status === 'hired') return; // Status didn't transition.

    const tenantId = event.params.tenantId;
    const applicationId = event.params.applicationId;
    const userId = afterData.userId;
    if (!userId || !tenantId) return;

    console.log(`🔄 Application ${applicationId} hired — checking for conflicts to auto-withdraw...`);

    try {
      // 1. Resolve shift dates for the just-hired application.
      const hiredShiftDates = await getShiftDatesForApplication(tenantId, afterData);
      if (hiredShiftDates.length === 0) {
        console.log('No shift dates found for hired application, skipping auto-withdraw');
        return;
      }

      // 2. Pull only ACTIVE applications for this user. Server-side filtering
      //    cuts the result set vs. "get all then filter in memory."
      const candidatesSnap = await db
        .collection('tenants').doc(tenantId)
        .collection('applications')
        .where('userId', '==', userId)
        .where('status', 'in', ACTIVE_STATUSES as unknown as string[])
        .get();

      // Drop the just-hired app itself (it'll still show 'hired' in this
      // query if the index updates fast — defensive in either case).
      const candidates = candidatesSnap.docs.filter((d) => d.id !== applicationId);
      if (candidates.length === 0) {
        console.log(`✅ No other active applications for user ${userId}`);
        return;
      }

      // 3. Resolve shift dates for every candidate in parallel.
      const hiredSet = new Set(hiredShiftDates);
      const candidateDateLists = await Promise.all(
        candidates.map((d) => getShiftDatesForApplication(tenantId, d.data())),
      );

      // 4. Build list of conflicting apps (same-day as hired).
      const toWithdraw: admin.firestore.DocumentSnapshot[] = [];
      for (let i = 0; i < candidates.length; i++) {
        const overlaps = candidateDateLists[i].some((d) => hiredSet.has(d));
        if (overlaps) toWithdraw.push(candidates[i]);
      }

      if (toWithdraw.length === 0) {
        console.log(`✅ No same-day conflicts for user ${userId} (${candidates.length} candidate(s) checked)`);
        return;
      }

      // 5. Batched withdraw. One commit per ≤450 docs.
      let written = 0;
      for (let i = 0; i < toWithdraw.length; i += FIRESTORE_BATCH_LIMIT) {
        const chunk = toWithdraw.slice(i, i + FIRESTORE_BATCH_LIMIT);
        const batch = db.batch();
        const now = admin.firestore.FieldValue.serverTimestamp();
        for (const snap of chunk) {
          batch.update(snap.ref, {
            status: 'withdrawn',
            withdrawnAt: now,
            withdrawnReason: 'auto_withdrawn_on_hire',
            updatedAt: now,
          });
        }
        await batch.commit();
        written += chunk.length;
      }

      console.log(`✅ Auto-withdrew ${written} application(s) for user ${userId} (hired ${applicationId})`);
    } catch (error) {
      // Never throw — don't fail the application status update.
      console.error('❌ Error in autoWithdrawApplicationsOnHire:', error);
    }
  },
);
