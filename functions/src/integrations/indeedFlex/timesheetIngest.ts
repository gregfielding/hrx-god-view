/**
 * Indeed Flex agency-portal TIMESHEET capture (PI-TS Slice 1, 2026-08-01).
 *
 * The portal's Timesheets view (agency.indeedflex.com/o/timesheets) is the
 * one place that shows EVERYONE with hours across all clients — the ideal
 * coverage signal for "is every worker with Flex hours assigned to the
 * right HRX job order?". The extension taps the SPA's own
 *   GET flex-core-us.indeed.com/api/v2/agency_portal/timesheets/entries?…
 * responses (one row per worker-per-shift-day) and POSTs them here raw.
 *
 * Wire shape pinned live 2026-08-01 (job 530960, Zaon Cox):
 *   { id, job_id, worker_id, worker_display_name, client_display_name,
 *     clock_in_time, clock_out_time, break:{duration,paid}, role:{title},
 *     venue:{name,timezone}, area_name, status, shift_id,
 *     start_time, end_time,       // scheduled, venue-local offset embedded
 *     charge_rates:{ charge_rate:{amount}, agency_margin_percentage,
 *                    total_client_invoice:{amount} } }
 * Statuses observed: approved / upcoming; the UI also filters
 * awaiting_submission (the /entries/count call). No worker email on the
 * wire — resolution is flexWorkerId-first (stamped on portal-sourced
 * assignments by PI-7), then name.
 *
 * Per entry we upsert a snapshot (indeed_flex_timesheets/{flexEntryId})
 * and stamp a reconcile verdict — WORKER-FIRST (Greg 2026-08-01: Zaon Cox
 * was fully assigned on manually-created Carrier JO #310, but the email-
 * request linkage couldn't see it; "is the worker assigned that day?" is
 * the real question, the Flex-job link is secondary):
 *   ok                — worker resolved AND an active assignment covers the
 *                       day (via the linked shift when the Flex job resolves,
 *                       else via a scan of the worker's own assignments —
 *                       day-scoped docs and spanning/career ranges, empty
 *                       endDate = ongoing)
 *   worker_unmatched  — nobody in HRX matches this Flex worker
 *   no_assignment     — worker known but NO assignment covers that day
 * plus `flexJobLinked` (soft signal: false = the Flex job id has no HRX
 * shift via external_shift_requests → poNumber — link it, but it's not a
 * coverage gap) and a rolling summary in
 * integration_health/indeed_flex_timesheets for the PI-11 tile.
 *
 * READ-ONLY against scheduling truth: unlike the roster ingest this writes
 * NO assignments — hours are an after-the-fact audit signal; fixing a gap
 * (assign the worker, link the job) stays a deliberate human act.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import { verifyExtensionKey, resolvePortalWorker, findHrxShiftForFlexJob, HrxShiftRef } from './portalIngest';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const MAX_ENTRIES = 500;

function trim(v: unknown): string {
  return String(v ?? '').trim();
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

interface NormalizedFlexTimesheetEntry {
  flexEntryId: string;
  flexJobId: string;
  flexWorkerId: string | null;
  flexShiftId: string | null;
  workerDisplayName: string;
  clientName: string | null;
  roleTitle: string | null;
  venueName: string | null;
  venueTimezone: string | null;
  areaName: string | null;
  status: string | null;
  /** yyyy-mm-dd in venue-local time (offset is embedded in start_time). */
  workDate: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  clockIn: string | null;
  clockOut: string | null;
  breakSeconds: number | null;
  breakPaid: boolean | null;
  /** Worked hours net of unpaid break; null until both clocks exist. */
  workedHours: number | null;
  chargeRate: number | null;
  agencyMarginPct: number | null;
  clientInvoiceTotal: number | null;
}

function normalizeEntry(raw: Record<string, unknown>): NormalizedFlexTimesheetEntry | null {
  const flexEntryId = trim(raw.id);
  const job = (raw.job ?? {}) as Record<string, unknown>;
  const flexJobId = trim(raw.job_id) || trim(job.id);
  if (!flexEntryId || !flexJobId) return null;

  const role = (raw.role ?? {}) as Record<string, unknown>;
  const venue = (raw.venue ?? {}) as Record<string, unknown>;
  const brk = (raw.break ?? {}) as Record<string, unknown>;
  const rates = (raw.charge_rates ?? {}) as Record<string, unknown>;
  const chargeRate = num(((rates.charge_rate ?? {}) as Record<string, unknown>).amount);
  const invoiceTotal = num(((rates.total_client_invoice ?? {}) as Record<string, unknown>).amount);

  const scheduledStart = trim(raw.start_time) || null;
  const clockIn = trim(raw.clock_in_time) || null;
  const clockOut = trim(raw.clock_out_time) || null;
  const breakSeconds = num(brk.duration);
  const breakPaid = typeof brk.paid === 'boolean' ? brk.paid : null;

  // The ISO strings carry the venue-local offset, so the calendar day is a
  // plain prefix read — no tz math.
  const workDate = (scheduledStart || clockIn || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return null;

  let workedHours: number | null = null;
  if (clockIn && clockOut) {
    const ms = Date.parse(clockOut) - Date.parse(clockIn);
    if (Number.isFinite(ms) && ms > 0) {
      const unpaidBreak = breakPaid === false && breakSeconds ? breakSeconds : 0;
      workedHours = Math.round(((ms / 1000 - unpaidBreak) / 3600) * 100) / 100;
    }
  }

  return {
    flexEntryId,
    flexJobId,
    flexWorkerId: trim(raw.worker_id) || null,
    flexShiftId: trim(raw.shift_id) || null,
    workerDisplayName: trim(raw.worker_display_name),
    clientName: trim(raw.client_display_name) || null,
    roleTitle: trim(role.title) || null,
    venueName: trim(venue.name) || null,
    venueTimezone: trim(venue.timezone) || null,
    areaName: trim(raw.area_name) || null,
    status: trim(raw.status) || null,
    workDate,
    scheduledStart,
    scheduledEnd: trim(raw.end_time) || null,
    clockIn,
    clockOut,
    breakSeconds,
    breakPaid,
    workedHours,
    chargeRate,
    agencyMarginPct: num(rates.agency_margin_percentage),
    clientInvoiceTotal: invoiceTotal,
  };
}

type MatchStatus = 'ok' | 'worker_unmatched' | 'no_assignment';

interface EntryVerdict {
  entry: NormalizedFlexTimesheetEntry;
  matchStatus: MatchStatus;
  /** Whether the Flex job id resolved to an HRX shift via the email-request
   *  linkage. false is a soft signal (link the job), NOT a coverage gap —
   *  JOs created manually (e.g. Carrier #310) are legitimate without it. */
  flexJobLinked: boolean;
  jobOrderId: string | null;
  shiftId: string | null;
  userId: string | null;
  assignmentId: string | null;
  matchedBy: string | null;
}

/**
 * Resolve the HRX worker for one entry. flexWorkerId → userId via the
 * shift's portal-sourced assignments (PI-7 stamps flexWorkerId) is the
 * strong path; display-name resolution is the fallback.
 */
async function resolveWorker(
  tenantId: string,
  entry: NormalizedFlexTimesheetEntry,
  assignmentsByFlexWorkerId: Map<string, { userId: string; assignmentIds: Map<string, string> }> | null,
): Promise<{ userId: string; matchedBy: string } | null> {
  if (entry.flexWorkerId && assignmentsByFlexWorkerId) {
    const hit = assignmentsByFlexWorkerId.get(entry.flexWorkerId);
    if (hit) return { userId: hit.userId, matchedBy: 'flex_worker_id' };
  }
  const display = entry.workerDisplayName;
  if (!display) return null;
  const parts = display.split(/\s+/);
  const resolved = await resolvePortalWorker(tenantId, {
    email: null,
    phone: null,
    firstName: parts[0] || '',
    lastName: parts.length >= 2 ? parts[parts.length - 1] : '',
    displayName: display,
  });
  return resolved ? { userId: resolved.userId, matchedBy: resolved.matchedBy } : null;
}

const DEAD_ASSIGNMENT_STATUSES = new Set([
  'cancelled', 'canceled', 'declined', 'worker-cancelled', 'worker_cancelled',
]);

function assignmentCoversDay(a: Record<string, unknown>, workDate: string): boolean {
  const start = String(a.startDate ?? '').trim();
  const end = String(a.endDate ?? '').trim();
  if (start && workDate < start) return false;
  // Empty endDate = ongoing (career) — covers any date from startDate on.
  if (end && workDate > end) return false;
  return Boolean(start || end);
}

/**
 * Worker-first fallback: is this worker assigned ANYWHERE in HRX for that
 * calendar day? This is the question Greg is actually asking — a JO created
 * manually (no email-request linkage, e.g. Carrier #310 "Forklift Driver
 * Fulltime" with a Career assignment) is full coverage even though the Flex
 * job id can't be tied to a specific HRX shift.
 */
async function findCoveringAssignmentForWorkerDay(
  tenantId: string,
  userId: string,
  workDate: string,
): Promise<{ assignmentId: string; jobOrderId: string | null; shiftId: string | null } | null> {
  const snap = await db
    .collection(`tenants/${tenantId}/assignments`)
    .where('userId', '==', userId)
    .limit(500)
    .get();
  let rangeHit: { assignmentId: string; jobOrderId: string | null; shiftId: string | null } | null = null;
  for (const d of snap.docs) {
    const a = d.data() as Record<string, unknown>;
    if (DEAD_ASSIGNMENT_STATUSES.has(String(a.status ?? '').trim().toLowerCase())) continue;
    if (!assignmentCoversDay(a, workDate)) continue;
    const hit = {
      assignmentId: d.id,
      jobOrderId: String(a.jobOrderId ?? '').trim() || null,
      shiftId: String(a.shiftId ?? '').trim() || null,
    };
    // Day-scoped exact doc beats a spanning range doc.
    if (String(a.startDate ?? '').trim() === workDate) return hit;
    rangeHit = rangeHit ?? hit;
  }
  return rangeHit;
}

export async function reconcileFlexTimesheets(
  tenantId: string,
  rawEntries: unknown,
  capturedAt: number,
): Promise<{
  entries: number;
  ok: number;
  /** ok rows whose Flex job id has no HRX shift linkage (soft: link the job). */
  okUnlinkedJob: number;
  workerUnmatched: number;
  noAssignment: number;
  /** Non-ok rows older than the 7-day attention window — recorded, not nagged. */
  staleProblems: number;
  problems: Array<{ status: MatchStatus; worker: string; client: string | null; flexJobId: string; workDate: string }>;
}> {
  // Today the wire is a bare array; tolerate a { data|entries|results: [] }
  // wrapper so a Flex envelope change degrades to "0 rows", not a crash.
  const o = rawEntries as Record<string, unknown> | null;
  const list = Array.isArray(rawEntries)
    ? rawEntries
    : o && typeof o === 'object'
      ? ((Array.isArray(o.data) && o.data) || (Array.isArray(o.entries) && o.entries) || (Array.isArray(o.results) && o.results) || [])
      : [];
  const normalized = list
    .slice(0, MAX_ENTRIES)
    .filter((x) => x && typeof x === 'object')
    .map((x) => normalizeEntry(x as Record<string, unknown>))
    .filter((x): x is NormalizedFlexTimesheetEntry => x !== null);

  // Per-flex-job caches so one capture page (25 rows, few jobs) does one
  // shift lookup + one assignment scan per job, not per row.
  const shiftCache = new Map<string, HrxShiftRef | null>();
  const rosterCache = new Map<
    string,
    {
      byFlexWorkerId: Map<string, { userId: string; assignmentIds: Map<string, string> }>;
      byUserId: Map<string, Map<string, string>>; // userId → workDate → assignmentId
    }
  >();

  async function shiftFor(flexJobId: string): Promise<HrxShiftRef | null> {
    if (!shiftCache.has(flexJobId)) {
      shiftCache.set(flexJobId, await findHrxShiftForFlexJob(tenantId, flexJobId));
    }
    return shiftCache.get(flexJobId) ?? null;
  }

  async function rosterFor(shiftId: string) {
    let cached = rosterCache.get(shiftId);
    if (cached) return cached;
    const snap = await db
      .collection(`tenants/${tenantId}/assignments`)
      .where('shiftId', '==', shiftId)
      .limit(500)
      .get();
    const byFlexWorkerId = new Map<string, { userId: string; assignmentIds: Map<string, string> }>();
    const byUserId = new Map<string, Map<string, string>>();
    snap.forEach((d) => {
      const a = d.data() as Record<string, unknown>;
      const status = trim(a.status).toLowerCase();
      if (['cancelled', 'canceled', 'declined', 'worker-cancelled', 'worker_cancelled'].includes(status)) return;
      const userId = trim(a.userId) || trim(a.candidateId);
      if (!userId) return;
      // A day-scoped doc covers startDate; a legacy spanning doc covers its
      // whole [startDate, endDate] range — record it under a '*' wildcard.
      const start = trim(a.startDate);
      const end = trim(a.endDate) || start;
      const days = byUserId.get(userId) ?? new Map<string, string>();
      if (start && start === end) days.set(start, d.id);
      else days.set(`*${start}..${end}`, d.id);
      byUserId.set(userId, days);
      const fwid = trim(a.flexWorkerId);
      if (fwid) {
        const cur = byFlexWorkerId.get(fwid) ?? { userId, assignmentIds: new Map<string, string>() };
        if (start) cur.assignmentIds.set(start, d.id);
        byFlexWorkerId.set(fwid, cur);
      }
    });
    cached = { byFlexWorkerId, byUserId };
    rosterCache.set(shiftId, cached);
    return cached;
  }

  function assignmentForDay(days: Map<string, string> | undefined, workDate: string): string | null {
    if (!days) return null;
    const exact = days.get(workDate);
    if (exact) return exact;
    for (const [key, id] of days) {
      if (!key.startsWith('*')) continue;
      const m = key.slice(1).split('..');
      const start = m[0] || '';
      const end = m[1] || start;
      if ((!start || workDate >= start) && (!end || workDate <= end)) return id;
    }
    return null;
  }

  // Per-worker day-coverage cache: `${userId}` → scan result promise reuse
  // is overkill; cache per (userId, workDate) since pages repeat both.
  const coverCache = new Map<string, { assignmentId: string; jobOrderId: string | null; shiftId: string | null } | null>();

  const verdicts: EntryVerdict[] = [];
  for (const entry of normalized) {
    const ref = await shiftFor(entry.flexJobId);
    const roster = ref ? await rosterFor(ref.shiftId) : null;
    const worker = await resolveWorker(tenantId, entry, roster?.byFlexWorkerId ?? null);
    if (!worker) {
      verdicts.push({
        entry, matchStatus: 'worker_unmatched', flexJobLinked: Boolean(ref),
        jobOrderId: ref?.joId ?? null, shiftId: ref?.shiftId ?? null,
        userId: null, assignmentId: null, matchedBy: null,
      });
      continue;
    }

    // Precise path: assignment on the LINKED shift for that day.
    let assignmentId = ref && roster ? assignmentForDay(roster.byUserId.get(worker.userId), entry.workDate) : null;
    let jobOrderId = ref?.joId ?? null;
    let shiftId = ref?.shiftId ?? null;

    // Worker-first fallback: any active assignment covering that day.
    if (!assignmentId) {
      const key = `${worker.userId}__${entry.workDate}`;
      if (!coverCache.has(key)) {
        coverCache.set(key, await findCoveringAssignmentForWorkerDay(tenantId, worker.userId, entry.workDate));
      }
      const cover = coverCache.get(key) ?? null;
      if (cover) {
        assignmentId = cover.assignmentId;
        jobOrderId = cover.jobOrderId ?? jobOrderId;
        shiftId = cover.shiftId ?? shiftId;
      }
    }

    verdicts.push({
      entry,
      matchStatus: assignmentId ? 'ok' : 'no_assignment',
      flexJobLinked: Boolean(ref),
      jobOrderId,
      shiftId,
      userId: worker.userId,
      assignmentId,
      matchedBy: worker.matchedBy,
    });
  }

  // Snapshot + verdict per entry, idempotent on flexEntryId (statuses and
  // clock times update in place as Greg revisits the page).
  const now = admin.firestore.FieldValue.serverTimestamp();
  let batch = db.batch();
  let inBatch = 0;
  for (const v of verdicts) {
    const ref = db.doc(`tenants/${tenantId}/indeed_flex_timesheets/${v.entry.flexEntryId}`);
    batch.set(
      ref,
      {
        ...v.entry,
        tenantId,
        hrxJobOrderId: v.jobOrderId,
        hrxShiftId: v.shiftId,
        hrxUserId: v.userId,
        hrxAssignmentId: v.assignmentId,
        hrxMatchedBy: v.matchedBy,
        matchStatus: v.matchStatus,
        flexJobLinked: v.flexJobLinked,
        capturedAt,
        reconciledAt: now,
        lastSeenAt: now,
      },
      { merge: true },
    );
    inBatch += 1;
    if (inBatch >= 400) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();

  // Attention window (Greg 2026-08-01): mismatches older than 7 days are
  // history, not to-dos — snapshot them, but don't nag about them.
  const cutoff = new Date(capturedAt - 7 * 86400000).toISOString().slice(0, 10);
  const recent = (v: EntryVerdict) => v.entry.workDate >= cutoff;
  const count = (s: MatchStatus) => verdicts.filter((v) => v.matchStatus === s && recent(v)).length;
  const problems = verdicts
    .filter((v) => v.matchStatus !== 'ok' && recent(v))
    .map((v) => ({
      status: v.matchStatus,
      worker: v.entry.workerDisplayName,
      client: v.entry.clientName,
      flexJobId: v.entry.flexJobId,
      workDate: v.entry.workDate,
    }));

  const summary = {
    entries: normalized.length,
    ok: verdicts.filter((v) => v.matchStatus === 'ok').length,
    okUnlinkedJob: verdicts.filter((v) => v.matchStatus === 'ok' && !v.flexJobLinked).length,
    workerUnmatched: count('worker_unmatched'),
    noAssignment: count('no_assignment'),
    /** Non-ok rows older than the 7-day window — recorded, not actionable. */
    staleProblems: verdicts.filter((v) => v.matchStatus !== 'ok' && !recent(v)).length,
    problems,
  };

  // Rolling health doc for the Scheduling Health tile (PI-11): last capture
  // wins — the page is the recruiter's live view, so freshest == truest.
  await db.doc(`tenants/${tenantId}/integration_health/indeed_flex_timesheets`).set(
    {
      ...summary,
      problems: problems.slice(0, 50),
      capturedAt,
      updatedAt: now,
    },
    { merge: false },
  );

  return summary;
}

export const indeedFlexTimesheetIngest = onRequest(
  { cors: true, memory: '512MiB', timeoutSeconds: 120, maxInstances: 4 },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST only.' } });
      return;
    }
    if (!verifyExtensionKey(req, res)) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const tenantId = trim(body.tenantId);
    if (!tenantId || body.entries === undefined || body.entries === null) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'tenantId and entries are required.' } });
      return;
    }

    try {
      const result = await reconcileFlexTimesheets(tenantId, body.entries, Number(body.capturedAt) || Date.now());
      logger.info('[indeedFlexTimesheetIngest] reconciled', { tenantId, ...result, problems: result.problems.length });
      res.status(200).json({ success: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[indeedFlexTimesheetIngest] failed', { tenantId, err: message });
      res.status(500).json({ success: false, error: { code: 'INGEST_FAILED', message } });
    }
  },
);
