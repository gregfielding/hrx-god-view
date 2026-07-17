/**
 * scheduleDivergenceSweep — daily cron (Phase 0 of the scheduling review).
 *
 * HRX drifts out of sync with the Indeed Flex / Fieldglass portals because
 * the integrations are one-way and there's no process that compares HRX's
 * own schedule against reality. This sweep is the first half of that
 * process: it computes, per tenant, the two divergences a recruiter cares
 * about and writes them to a daily review snapshot that a reconciliation
 * screen (Phase 1) renders.
 *
 * Two findings per tenant:
 *   A. STALE LIVE ASSIGNMENTS — a worker still in a live status
 *      (pending/confirmed/active/…) whose shift ended more than
 *      STALE_GRACE_DAYS ago, or whose job order was cancelled/completed.
 *      These are the "showing workers long removed" rows.
 *   B. COVERAGE GAPS — an upcoming shift that still needs more workers
 *      than it has live assignments. These are the "not showing current
 *      workers / unstaffed upcoming work" holes — usually because the
 *      worker was placed in the portal but never entered in HRX.
 *
 * Output (per tenant):
 *   tenants/{t}/schedule_divergence/{yyyy-mm-dd}  — full snapshot
 *   tenants/{t}/schedule_divergence/latest        — pointer + counts
 *
 * Read-only against the operational data; only writes the snapshot docs.
 * Also exported as an on-demand callable so it can be run/inspected without
 * waiting for the cron.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/** A worker in one of these statuses is "engaged" — should be covering the
 *  shift. Mirrors ASSIGNMENT_STATUS_QUERY_LIVE on the server. */
const LIVE_STATUSES = ['pending', 'proposed', 'confirmed', 'in_progress', 'active'];
/** Statuses that mean the engagement is over/void — never counted as
 *  covering a shift and never flagged as stale. */
const DEAD_STATUSES = new Set([
  'cancelled', 'canceled', 'worker-cancelled', 'workercancelled',
  'declined', 'rejected', 'completed', 'ended',
]);
/** A job order in one of these states should have no live assignments —
 *  a worker still live under it is stale. */
const KILLED_JO_STATUSES = new Set(['cancelled', 'canceled', 'completed', 'closed']);
/** JO states whose shifts we scan for coverage gaps. */
const STAFFABLE_JO_STATUSES = new Set(['open', 'filled', 'on_hold']);

const STALE_GRACE_DAYS = 2;        // shift ended > this many days ago → stale
const COVERAGE_LOOKAHEAD_DAYS = 21; // scan upcoming shifts this far out
const MAX_ROWS_PER_LIST = 750;      // safety cap on snapshot array size

function iso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}
function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
function asIso(v: unknown): string | null {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (v && typeof (v as { toDate?: () => Date }).toDate === 'function') {
    return iso((v as { toDate: () => Date }).toDate());
  }
  return null;
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

interface StaleRow {
  assignmentId: string;
  userId: string;
  workerName: string;
  jobOrderId: string;
  shiftId: string;
  status: string;
  effectiveEndDate: string | null;
  worksiteName: string;
  reason: string;
}
interface GapRow {
  jobOrderId: string;
  jobTitle: string;
  accountName: string;
  shiftId: string;
  date: string;
  needed: number;
  filled: number;
  gap: number;
  worksiteName: string;
}
export interface TenantDivergence {
  tenantId: string;
  generatedAt: FirebaseFirestore.FieldValue;
  runDate: string;
  windowStart: string;
  windowEnd: string;
  counts: {
    staleLive: number;
    coverageGaps: number;
    totalGapSeats: number;
    liveAssignmentsScanned: number;
    staffableShiftsScanned: number;
  };
  staleLiveAssignments: StaleRow[];
  coverageGaps: GapRow[];
  truncated: { stale: boolean; gaps: boolean };
}

/**
 * Compute the divergence snapshot for one tenant. Pure-ish: reads
 * Firestore, returns the structured result. The caller persists it.
 */
export async function computeTenantDivergence(tenantId: string): Promise<TenantDivergence> {
  const today = iso(new Date());
  const windowEnd = addDays(today, COVERAGE_LOOKAHEAD_DAYS);
  const staleBefore = addDays(today, -STALE_GRACE_DAYS);

  const tRef = db.collection('tenants').doc(tenantId);

  // ---- one pass over assignments: build live-coverage index + stale list ----
  const assignmentsSnap = await tRef.collection('assignments').get();
  // shiftId -> Set(userId) of live coverers (dedupes multi-day day-scoped docs)
  const liveByShift = new Map<string, Set<string>>();
  // shiftId|date -> Set(userId) for day-scoped gig coverage
  const liveByShiftDate = new Map<string, Set<string>>();
  const staleCandidates: Array<{ id: string; a: FirebaseFirestore.DocumentData; effEnd: string | null }> = [];
  const liveJobOrderIds = new Set<string>();
  let liveScanned = 0;

  for (const doc of assignmentsSnap.docs) {
    const a = doc.data() || {};
    const status = String(a.status ?? '').toLowerCase();
    if (DEAD_STATUSES.has(status)) continue;
    if (!LIVE_STATUSES.includes(status) && status !== '' && status !== 'none') continue;
    liveScanned += 1;
    const shiftId = String(a.shiftId ?? '');
    const userId = String(a.userId ?? a.candidateId ?? '');
    const start = asIso(a.startDate) ?? asIso(a.start);
    const end = asIso(a.endDate) ?? start;
    const effEnd = end && start && end >= start ? end : start;

    if (shiftId && userId) {
      if (!liveByShift.has(shiftId)) liveByShift.set(shiftId, new Set());
      liveByShift.get(shiftId)!.add(userId);
      if (start) {
        const k = `${shiftId}|${start}`;
        if (!liveByShiftDate.has(k)) liveByShiftDate.set(k, new Set());
        liveByShiftDate.get(k)!.add(userId);
      }
    }
    if (a.jobOrderId) liveJobOrderIds.add(String(a.jobOrderId));
    // stale candidate: past its end date beyond the grace window (open/ongoing
    // assignments with no end date are never stale on the date axis)
    if (effEnd && effEnd < staleBefore) {
      staleCandidates.push({ id: doc.id, a, effEnd });
    }
  }

  // ---- resolve JO statuses referenced by live assignments (for killed-JO stale) ----
  const joStatusCache = new Map<string, string>();
  await Promise.all(
    Array.from(liveJobOrderIds).map(async (joId) => {
      try {
        const s = await tRef.collection('job_orders').doc(joId).get();
        joStatusCache.set(joId, String((s.data() || {}).status ?? '').toLowerCase());
      } catch {
        /* non-fatal */
      }
    }),
  );

  // ---- build stale list: past-dated OR on a killed JO ----
  const staleLive: StaleRow[] = [];
  const seenStale = new Set<string>();
  const pushStale = (id: string, a: FirebaseFirestore.DocumentData, effEnd: string | null, reason: string) => {
    if (seenStale.has(id)) return;
    seenStale.add(id);
    staleLive.push({
      assignmentId: id,
      userId: String(a.userId ?? a.candidateId ?? ''),
      workerName: String(a.workerDisplayName ?? `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() ?? ''),
      jobOrderId: String(a.jobOrderId ?? ''),
      shiftId: String(a.shiftId ?? ''),
      status: String(a.status ?? ''),
      effectiveEndDate: effEnd,
      worksiteName: String(a.worksiteName ?? a.worksiteDisplayName ?? ''),
      reason,
    });
  };
  for (const { id, a, effEnd } of staleCandidates) {
    pushStale(id, a, effEnd, `shift ended ${effEnd} — still ${String(a.status ?? '').toLowerCase()}`);
  }
  // killed-JO pass over all live assignments
  for (const doc of assignmentsSnap.docs) {
    const a = doc.data() || {};
    const status = String(a.status ?? '').toLowerCase();
    if (DEAD_STATUSES.has(status)) continue;
    if (!LIVE_STATUSES.includes(status) && status !== '' && status !== 'none') continue;
    const joStatus = joStatusCache.get(String(a.jobOrderId ?? ''));
    if (joStatus && KILLED_JO_STATUSES.has(joStatus)) {
      const start = asIso(a.startDate) ?? asIso(a.start);
      const end = asIso(a.endDate) ?? start;
      pushStale(doc.id, a, end && start && end >= start ? end : start, `job order is ${joStatus}`);
    }
  }

  // ---- coverage gaps: scan staffable JOs' upcoming shifts ----
  const coverageGaps: GapRow[] = [];
  let staffableShiftsScanned = 0;
  const joSnap = await tRef.collection('job_orders').where('status', 'in', Array.from(STAFFABLE_JO_STATUSES)).get();
  for (const jo of joSnap.docs) {
    const joData = jo.data() || {};
    const jobTitle = String(joData.jobTitle ?? joData.title ?? joData.defaultJobTitle ?? '');
    const accountName = String(joData.accountName ?? joData.parentAccountName ?? '');
    const joFallbackNeed = num(joData.headcountRequested ?? joData.workersNeeded);
    const shiftsSnap = await jo.ref.collection('shifts').get();
    for (const sh of shiftsSnap.docs) {
      const s = sh.data() || {};
      if (String(s.status ?? '').toLowerCase() === 'closed') continue;
      const worksiteName = String(s.worksiteName ?? s.shiftTitle ?? jobTitle);
      const dateSchedule = (s.dateSchedule && typeof s.dateSchedule === 'object')
        ? (s.dateSchedule as Record<string, { workersNeeded?: unknown }>)
        : null;

      // Enumerate (date, needed) pairs to check.
      const perDay: Array<{ date: string; needed: number }> = [];
      if (dateSchedule) {
        for (const [date, cfg] of Object.entries(dateSchedule)) {
          const d = asIso(date);
          if (!d) continue;
          perDay.push({ date: d, needed: num(cfg?.workersNeeded) || joFallbackNeed });
        }
      } else {
        const d = asIso(s.shiftDate) ?? asIso(s.startDate);
        if (d) {
          const needed = num(s.totalStaffRequested ?? s.assignmentsTarget) || joFallbackNeed;
          perDay.push({ date: d, needed });
        }
      }

      for (const { date, needed } of perDay) {
        if (date < today || date > windowEnd) continue; // upcoming window only
        if (needed <= 0) continue;
        staffableShiftsScanned += 1;
        // filled = distinct live coverers on this shift for this date, or on
        // the shift overall for range/open shifts with no per-date breakdown.
        const dayCover = liveByShiftDate.get(`${sh.id}|${date}`);
        const shiftCover = liveByShift.get(sh.id);
        const filled = (dayCover?.size ?? 0) || (shiftCover?.size ?? 0);
        const gap = needed - filled;
        if (gap > 0) {
          coverageGaps.push({
            jobOrderId: jo.id, jobTitle, accountName, shiftId: sh.id,
            date, needed, filled, gap, worksiteName,
          });
        }
      }
    }
  }

  // sort: coverage gaps soonest-first (act on this week before next);
  // stale list most-recent-first so the capped array shows actionable
  // recent drift, not a months-old backlog nobody will work through.
  coverageGaps.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.gap - a.gap));
  staleLive.sort((a, b) => String(b.effectiveEndDate).localeCompare(String(a.effectiveEndDate)));

  const truncated = { stale: staleLive.length > MAX_ROWS_PER_LIST, gaps: coverageGaps.length > MAX_ROWS_PER_LIST };
  const totalGapSeats = coverageGaps.reduce((sum, g) => sum + g.gap, 0);

  return {
    tenantId,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    runDate: today,
    windowStart: today,
    windowEnd,
    counts: {
      staleLive: staleLive.length,
      coverageGaps: coverageGaps.length,
      totalGapSeats,
      liveAssignmentsScanned: liveScanned,
      staffableShiftsScanned,
    },
    staleLiveAssignments: staleLive.slice(0, MAX_ROWS_PER_LIST),
    coverageGaps: coverageGaps.slice(0, MAX_ROWS_PER_LIST),
    truncated,
  };
}

async function persistDivergence(result: TenantDivergence): Promise<void> {
  const col = db.collection('tenants').doc(result.tenantId).collection('schedule_divergence');
  await col.doc(result.runDate).set(result);
  await col.doc('latest').set({
    runDate: result.runDate,
    generatedAt: result.generatedAt,
    counts: result.counts,
    truncated: result.truncated,
  });
}

export const scheduleDivergenceSweep = onSchedule(
  {
    schedule: '0 11 * * *', // 11:00 UTC daily (~4am PT — fresh each morning)
    timeZone: 'UTC',
    memory: '512MiB',
    timeoutSeconds: 540,
  },
  async () => {
    const tenantsSnap = await db.collection('tenants').get();
    let tenants = 0;
    let totalStale = 0;
    let totalGaps = 0;
    for (const tenant of tenantsSnap.docs) {
      try {
        const result = await computeTenantDivergence(tenant.id);
        // Skip persisting for tenants with nothing to say AND no operational
        // data (keeps empty sandbox tenants from littering snapshots).
        if (
          result.counts.liveAssignmentsScanned === 0 &&
          result.counts.staffableShiftsScanned === 0
        ) {
          continue;
        }
        await persistDivergence(result);
        tenants += 1;
        totalStale += result.counts.staleLive;
        totalGaps += result.counts.coverageGaps;
      } catch (err) {
        logger.error('scheduleDivergenceSweep tenant failed', {
          tenantId: tenant.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    logger.info('scheduleDivergenceSweep complete', { tenants, totalStale, totalGaps });
  },
);

/** Tenant security level ≥ 5 (recruiter/admin band) or HRX super-admin.
 *  The sweep is read-mostly operational reporting, so the recruiter band
 *  that already sees the timesheet grid can run it on demand. */
async function assertRecruiterOrAdmin(
  uid: string,
  token: Record<string, unknown> | undefined,
  tenantId: string,
): Promise<void> {
  if (token?.hrx === true) return;
  const snap = await db.collection('users').doc(uid).get();
  const data = (snap.data() || {}) as Record<string, unknown>;
  const nested = (data.tenantIds as Record<string, { securityLevel?: unknown }> | undefined)?.[tenantId]
    ?.securityLevel;
  const level = Number.parseInt(String(nested ?? data.securityLevel ?? '0'), 10) || 0;
  if (level >= 5) return;
  throw new HttpsError('permission-denied', 'Schedule divergence sweep requires tenant security level 5+.');
}

/** On-demand run for a single tenant — same computation as the cron. */
export const runScheduleDivergenceSweep = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const tenantId = String(request.data?.tenantId ?? '').trim();
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required');
    await assertRecruiterOrAdmin(request.auth.uid, request.auth.token as Record<string, unknown>, tenantId);
    const result = await computeTenantDivergence(tenantId);
    await persistDivergence(result);
    return {
      ok: true,
      runDate: result.runDate,
      counts: result.counts,
      truncated: result.truncated,
    };
  },
);
