/**
 * Indeed Flex agency-portal ingest (PI-7 Slice 1, 2026-07-27).
 *
 * Receives a structured capture of ONE Flex job (job + shifts + BOOKED
 * ROSTER) from the browser extension and reconciles the roster into HRX
 * assignments — the positive "who is actually booked" signal the email
 * pipeline never gave us (emails only name workers on cancel/no-show).
 *
 * Flow:
 *   1. Normalize the raw capture (portalTypes.ts — server-side, so a Flex
 *      portal change can't break the extension).
 *   2. Find the HRX shift the email pipeline already created for this Flex
 *      job: external_shift_requests(event.jobId) → matchedJobOrderId →
 *      job_orders/{jo}/shifts(poNumber == flexJobId). (collectionGroup on
 *      shifts is deliberately un-indexed in this project, so we anchor
 *      through the request linkage + a JO-scoped shift query.)
 *   3. For each booked worker: resolve the HRX user (email → phone →
 *      name) and upsert a CONFIRMED, notification-suppressed assignment
 *      per booked date. Suppression satisfies the logAssignmentCreated /
 *      onAssignmentUpdatedPush gates so no offer SMS/push fires — the
 *      worker is already booked via Flex; HRX is mirroring, not offering.
 *   4. Reconcile drops: a worker who left this job's booked roster is
 *      RECORDED as an observation (flexRosterDropObservedAt), NOT
 *      auto-cancelled. A Flex "career" engagement is fragmented into a
 *      chain of job IDs (one ends, a new one opens for the same continuous
 *      work), so a drop off an old job is usually a rollover — cancelling
 *      would falsely end continuous work. The recurrence-aware continuity
 *      engine (next slice) decides rollover-vs-ended; genuine ends stay a
 *      deliberate human act.
 *
 * Auth mirrors fieldglassEnrichmentIngest: shared bearer key in
 * INDEED_FLEX_EXTENSION_KEY, fail-closed (503 unconfigured / 401 bad key).
 *
 * NOT in this slice (deferred, surfaced as 'unmatched_no_shift'): creating
 * the HRX shift from portal data alone when no email/request exists. The
 * common path is email-first (PI-1/2 create the shift); the portal enriches
 * it with the roster.
 */
import { onRequest, Request } from 'firebase-functions/v2/https';
import { Response } from 'express';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

import { normalizeFlexPortalCapture, FlexPortalCaptureEnvelope, NormalizedFlexCapture } from './portalTypes';
import { normalizeEmail } from '../../timesheets/timesheetWorkerAliases';
import { upsertEngagementForPlacement } from './engagements';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const MAX_ROSTER = 200;

function trim(v: unknown): string {
  return String(v ?? '').trim();
}

function digits10(phone: string): string | null {
  const d = trim(phone).replace(/\D/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  return ten.length === 10 ? ten : null;
}

/** DOW 0-6 (Sun-Sat) for a yyyy-mm-dd calendar day, tz-independent. */
function dowFromIso(date: string): number | null {
  const m = trim(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

/* ────────────────────────────────────────────────────────────────────
 * Auth (mirrors fieldglass/enrichmentApi.ts verifyExtensionKey)
 * ──────────────────────────────────────────────────────────────────── */

export function verifyExtensionKey(req: Request, res: Response): boolean {
  const configured = String(process.env.INDEED_FLEX_EXTENSION_KEY ?? '').trim();
  if (!configured) {
    res.status(503).json({ success: false, error: { code: 'NOT_CONFIGURED', message: 'Extension key not configured.' } });
    return false;
  }
  const header = String(req.headers.authorization ?? '');
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const a = crypto.createHash('sha256').update(presented).digest();
  const b = crypto.createHash('sha256').update(configured).digest();
  if (!presented || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid extension key.' } });
    return false;
  }
  return true;
}

/* ────────────────────────────────────────────────────────────────────
 * Worker resolution (email → phone → name), tenant-scoped
 * ──────────────────────────────────────────────────────────────────── */

interface ResolvedWorker {
  userId: string;
  matchedBy: 'email' | 'phone' | 'name';
}

function inTenant(data: Record<string, unknown>, tenantId: string): boolean {
  const map = data.tenantIds as Record<string, unknown> | undefined;
  return (!!map && !!map[tenantId]) || data.tenantId === tenantId;
}

function nameTokens(s: string): string[] {
  return trim(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** First tokens agree AND one token set contains the other (mirrors the
 *  importTimesheetMatchWorkers nameTokensMatch rule). */
function nameTokensMatch(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a[0] !== b[0]) return false;
  const sa = new Set(a);
  const sb = new Set(b);
  const aInB = a.every((t) => sb.has(t));
  const bInA = b.every((t) => sa.has(t));
  return aInB || bInA;
}

async function resolveByEmail(tenantId: string, email: string): Promise<ResolvedWorker | null> {
  const variants = Array.from(new Set([email, email.toLowerCase(), normalizeEmail(email)].map(trim).filter(Boolean)));
  const hits = new Map<string, Record<string, unknown>>();
  for (const v of variants) {
    const snap = await db.collection('users').where('email', '==', v).limit(10).get();
    snap.forEach((d) => hits.set(d.id, d.data() as Record<string, unknown>));
  }
  const scoped = [...hits.entries()].filter(([, d]) => inTenant(d, tenantId));
  return scoped.length === 1 ? { userId: scoped[0][0], matchedBy: 'email' } : null;
}

async function resolveByPhone(tenantId: string, phone: string): Promise<ResolvedWorker | null> {
  const ten = digits10(phone);
  if (!ten) return null;
  const e164 = `+1${ten}`;
  const hits = new Map<string, Record<string, unknown>>();
  const queries = [
    db.collection('users').where('phoneE164', '==', e164),
    db.collection('users').where('phone', '==', e164),
    db.collection('users').where('phone', '==', ten),
  ];
  for (const q of queries) {
    const snap = await q.limit(10).get();
    snap.forEach((d) => hits.set(d.id, d.data() as Record<string, unknown>));
  }
  const scoped = [...hits.entries()].filter(([, d]) => inTenant(d, tenantId));
  return scoped.length === 1 ? { userId: scoped[0][0], matchedBy: 'phone' } : null;
}

async function resolveByName(tenantId: string, first: string, last: string): Promise<ResolvedWorker | null> {
  if (!last) return null;
  const want = nameTokens(`${first} ${last}`);
  if (want.length === 0) return null;
  const hits = new Map<string, Record<string, unknown>>();
  for (const cased of Array.from(new Set([last, last.toLowerCase(), last.toUpperCase(), last[0].toUpperCase() + last.slice(1).toLowerCase()]))) {
    const snap = await db
      .collection('users')
      .where('lastName', '==', cased)
      .limit(25)
      .get();
    snap.forEach((d) => hits.set(d.id, d.data() as Record<string, unknown>));
  }
  const matches = [...hits.entries()].filter(([, d]) => {
    if (!inTenant(d, tenantId)) return false;
    const have = nameTokens(`${trim(d.firstName)} ${trim(d.lastName)}`);
    return nameTokensMatch(want, have);
  });
  return matches.length === 1 ? { userId: matches[0][0], matchedBy: 'name' } : null;
}

export async function resolvePortalWorker(
  tenantId: string,
  w: { email: string | null; phone: string | null; firstName: string; lastName: string; displayName: string },
): Promise<ResolvedWorker | null> {
  if (w.email) {
    const byEmail = await resolveByEmail(tenantId, w.email);
    if (byEmail) return byEmail;
  }
  if (w.phone) {
    const byPhone = await resolveByPhone(tenantId, w.phone);
    if (byPhone) return byPhone;
  }
  let first = w.firstName;
  let last = w.lastName;
  if (!last && w.displayName) {
    const parts = w.displayName.split(/\s+/);
    if (parts.length >= 2) {
      first = parts[0];
      last = parts[parts.length - 1];
    }
  }
  return resolveByName(tenantId, first, last);
}

/* ────────────────────────────────────────────────────────────────────
 * Shift lookup — anchor through the request linkage
 * ──────────────────────────────────────────────────────────────────── */

export interface HrxShiftRef {
  joId: string;
  shiftId: string;
  shift: Record<string, unknown>;
  jo: Record<string, unknown>;
}

export async function findHrxShiftForFlexJob(tenantId: string, flexJobId: string): Promise<HrxShiftRef | null> {
  if (!flexJobId) return null;
  // Applied request(s) for this Flex job carry matchedJobOrderId.
  const reqSnap = await db
    .collection(`tenants/${tenantId}/external_shift_requests`)
    .where('event.jobId', '==', flexJobId)
    .limit(10)
    .get();
  const joIds = new Set<string>();
  reqSnap.forEach((d) => {
    const jo = trim(d.data()?.matchedJobOrderId);
    if (jo) joIds.add(jo);
  });
  for (const joId of joIds) {
    // JO-scoped shift query keyed on poNumber == flexJobId (index-safe,
    // same anchor applyNewRequest uses for idempotency).
    const shiftSnap = await db
      .collection(`tenants/${tenantId}/job_orders/${joId}/shifts`)
      .where('poNumber', '==', flexJobId)
      .limit(1)
      .get();
    if (!shiftSnap.empty) {
      const shiftDoc = shiftSnap.docs[0];
      const joDoc = await db.doc(`tenants/${tenantId}/job_orders/${joId}`).get();
      return {
        joId,
        shiftId: shiftDoc.id,
        shift: shiftDoc.data() as Record<string, unknown>,
        jo: (joDoc.data() ?? {}) as Record<string, unknown>,
      };
    }
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────
 * Reconcile
 * ──────────────────────────────────────────────────────────────────── */

export interface PortalReconcileResult {
  matched: boolean;
  reason?: string;
  flexJobId: string;
  jobOrderId?: string;
  shiftId?: string;
  rosterSize: number;
  created: number;
  reconfirmed: number;
  alreadyBooked: number;
  observedDrops: number;
  /** Booked workers recognized as part of a CONTINUOUS engagement here. */
  continuousEngagements: number;
  /** First-ever placements of a worker at this account (new engagement). */
  newEngagements: number;
  unmatchedWorkers: Array<{ name: string; email: string | null; phone: string | null }>;
  warnings: string[];
}

export async function reconcileFlexPortalCapture(
  tenantId: string,
  env: FlexPortalCaptureEnvelope,
  actor: string,
  opts?: { dryRun?: boolean },
): Promise<PortalReconcileResult> {
  const dryRun = opts?.dryRun === true;
  const norm: NormalizedFlexCapture = normalizeFlexPortalCapture(env);
  const flexJobId = norm.job.flexJobId;
  const base: PortalReconcileResult = {
    matched: false,
    flexJobId,
    rosterSize: norm.roster.length,
    created: 0,
    reconfirmed: 0,
    alreadyBooked: 0,
    observedDrops: 0,
    continuousEngagements: 0,
    newEngagements: 0,
    unmatchedWorkers: [],
    warnings: [...norm.warnings],
  };

  if (!flexJobId) {
    return { ...base, reason: 'no_flex_job_id' };
  }

  const ref = await findHrxShiftForFlexJob(tenantId, flexJobId);
  if (!ref) {
    // Record for the "create shift from portal" follow-up slice.
    if (!dryRun) {
      const unmatchedVenueId = trim(norm.job.venueId) || trim(env.context?.venueId);
      await db.doc(`tenants/${tenantId}/indeed_flex_portal_captures/${flexJobId}`).set(
        {
          flexJobId,
          status: 'unmatched_no_shift',
          jobTitle: norm.job.title,
          venueId: norm.job.venueId,
          address: norm.job.address,
          rosterSize: norm.roster.length,
          clockInUrl: unmatchedVenueId
            ? `https://time.indeed.com/time-capture/qr?ar=us&source_flow=worker_link&venueId=${unmatchedVenueId}`
            : null,
          // Raw payloads (size-capped) — field-name pinning + the future
          // create-JO-from-capture slice read from here.
          rawJob: JSON.stringify(env.job ?? null).slice(0, 40000),
          rawShifts: JSON.stringify(env.shifts ?? null).slice(0, 40000),
          capturedAt: env.capturedAt ?? null,
          lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    return { ...base, reason: 'unmatched_no_shift' };
  }

  const { joId, shiftId, shift, jo } = ref;
  const shiftById = new Map(norm.shifts.map((s) => [s.flexShiftId, s]));
  const accountId = trim(jo.recruiterAccountId) || trim(shift.accountId) || null;
  const hiringEntityId = trim(jo.hiringEntityId) || trim(shift.hiringEntityId) || null;
  const jobTitle = trim(shift.defaultJobTitle) || trim(jo.jobTitle) || norm.job.title || null;
  const shiftTitle = trim(shift.shiftTitle) || null;
  const shiftPay = Number(shift.payRate ?? norm.job.primaryPayRate ?? 0) || null;
  const shiftBill = Number(shift.billRate ?? 0) || null;
  const dateSchedule = (shift.dateSchedule ?? {}) as Record<string, { startTime?: string; endTime?: string }>;

  // Expand roster → one (userId, date) target per booked worker-shift.
  interface Target {
    userId: string;
    date: string;
    startTime: string | null;
    endTime: string | null;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    flexWorkerId: string | null;
    flexShiftId: string;
    branch: string | null;
  }
  const targets: Target[] = [];
  const bookedKeys = new Set<string>(); // `${userId}__${date}`

  const rosterSlice = norm.roster.slice(0, MAX_ROSTER);
  for (const w of rosterSlice) {
    const resolved = await resolvePortalWorker(tenantId, w);
    if (!resolved) {
      base.unmatchedWorkers.push({ name: w.displayName, email: w.email, phone: w.phone });
      continue;
    }
    const shiftIds = w.flexShiftIds.length > 0 ? w.flexShiftIds : norm.shifts.map((s) => s.flexShiftId);
    for (const fsid of shiftIds) {
      const fs = shiftById.get(fsid);
      const date = fs?.date || '';
      if (!date) continue;
      const daySched = dateSchedule[date] || {};
      targets.push({
        userId: resolved.userId,
        date,
        startTime: fs?.startTime || trim(daySched.startTime) || trim(shift.defaultStartTime) || null,
        endTime: fs?.endTime || trim(daySched.endTime) || trim(shift.defaultEndTime) || null,
        firstName: w.firstName,
        lastName: w.lastName,
        email: w.email,
        phone: w.phone,
        flexWorkerId: w.flexWorkerId,
        flexShiftId: fsid,
        branch: w.branch,
      });
      bookedKeys.add(`${resolved.userId}__${date}`);
    }
  }

  // Existing portal-sourced assignments on this shift (for drop reconcile).
  const existingSnap = await db
    .collection(`tenants/${tenantId}/assignments`)
    .where('shiftId', '==', shiftId)
    .limit(500)
    .get();
  const existingPortal = new Map<string, { ref: FirebaseFirestore.DocumentReference; status: string }>();
  existingSnap.forEach((d) => {
    const data = d.data();
    if (trim(data.assignmentSource) !== 'indeed_flex_portal') return;
    const key = `${trim(data.userId)}__${trim(data.startDate)}`;
    existingPortal.set(key, { ref: d.ref, status: trim(data.status) || 'confirmed' });
  });

  const now = admin.firestore.FieldValue.serverTimestamp();
  const writes: Array<() => Promise<void>> = [];

  for (const t of targets) {
    const key = `${t.userId}__${t.date}`;
    const assignmentId = `${shiftId}__${t.userId}__${t.date}`;
    const aRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
    const existing = existingPortal.get(key);
    if (existing && existing.status !== 'cancelled') {
      base.alreadyBooked += 1;
      continue; // already a live portal assignment — leave it
    }
    const dow = dowFromIso(t.date);
    const doc: Record<string, unknown> = {
      tenantId,
      jobOrderId: joId,
      shiftId,
      candidateId: t.userId,
      userId: t.userId,
      workerId: t.userId,
      firstName: t.firstName,
      lastName: t.lastName,
      email: t.email,
      phone: t.phone,
      startDate: t.date,
      endDate: t.date,
      startTime: t.startTime,
      endTime: t.endTime,
      payRate: shiftPay,
      billRate: shiftBill,
      jobTitle,
      shiftTitle,
      accountId,
      hiringEntityId,
      ...(dow !== null ? { weeklySchedule: { [String(dow)]: { enabled: true, startTime: t.startTime, endTime: t.endTime } } } : {}),
      status: 'confirmed',
      latestStatus: 'confirmed',
      notificationsSuppressed: true,
      assignmentSource: 'indeed_flex_portal',
      flexWorkerId: t.flexWorkerId,
      flexShiftId: t.flexShiftId,
      flexBranch: t.branch,
      updatedBy: actor,
      updatedAt: now,
    };
    if (existing && existing.status === 'cancelled') {
      base.reconfirmed += 1;
      writes.push(async () => { await aRef.set(doc, { merge: true }); });
    } else {
      base.created += 1;
      writes.push(async () => { await aRef.set({ ...doc, createdBy: actor, createdAt: now }); });
    }
  }

  // Drops: a worker who left this job's booked roster. This is NOT
  // auto-cancelled — a Flex "career" engagement is fragmented into a chain
  // of separate job IDs (one ends, a new one opens for the same continuous
  // work), so a drop off an old job is usually a ROLLOVER, not a no-show.
  // Auto-cancelling here would falsely end continuous work (Greg 2026-07-27).
  // We only RECORD the drop as an observation; the recurrence-aware
  // continuity engine (next slice) decides rollover-vs-ended, and genuine
  // ends stay a deliberate human act. Re-enable a real cancel only for
  // engagements that engine proves are non-continuous.
  for (const [key, e] of existingPortal) {
    if (bookedKeys.has(key)) continue;
    if (e.status === 'cancelled') continue;
    base.observedDrops += 1; // reported as "observed drops", not cancellations
    writes.push(async () => {
      await e.ref.set(
        {
          flexRosterDropObservedAt: now,
          flexRosterDropSourceJobId: flexJobId,
          updatedBy: actor,
          updatedAt: now,
        },
        { merge: true },
      );
    });
  }

  // Engagement layer: record each booked worker's placement against their
  // (account, worker) engagement + detect continuity by recurrence. This is
  // the continuity truth reporting reads and the never-auto-end guard
  // respects — the per-shift assignments above stay untouched. Reads always
  // (so dry-run reports continuity); writes only when !dryRun.
  if (accountId) {
    const perWorker = new Map<string, { date: string; name: string }>();
    for (const t of targets) {
      const prev = perWorker.get(t.userId);
      const name = `${t.firstName} ${t.lastName}`.trim();
      if (!prev || t.date > prev.date) perWorker.set(t.userId, { date: t.date, name });
    }
    const accountName = trim(jo.accountName) || trim(jo.companyName) || undefined;
    for (const [userId, info] of perWorker) {
      try {
        const eng = await upsertEngagementForPlacement(
          tenantId,
          { userId, accountId, flexJobId, date: info.date, workerName: info.name, accountName, jobTitle: jobTitle || undefined },
          { dryRun },
        );
        if (eng.continuous) base.continuousEngagements += 1;
        if (eng.isNew) base.newEngagements += 1;
      } catch (err) {
        logger.warn('[portalIngest] engagement upsert failed', {
          tenantId,
          userId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  if (!dryRun) {
    for (const w of writes) await w();

    // Enrichment stamp — mirror the recruiters' MANUAL convention (Greg
    // 2026-08-01: "we have been adding that info to shifts"): the venue
    // clock-in QR link is deterministic per venue, so derive and stamp it
    // (plus heal a missing poNumber). Fill-if-empty only — a hand-entered
    // value always wins over a derived one.
    const venueIdForLink = trim(norm.job.venueId) || trim(env.context?.venueId);
    const derivedClockInUrl = venueIdForLink
      ? `https://time.indeed.com/time-capture/qr?ar=us&source_flow=worker_link&venueId=${venueIdForLink}`
      : null;
    const shiftPatch: Record<string, unknown> = {};
    if (derivedClockInUrl && !trim(shift.clockInUrl)) shiftPatch.clockInUrl = derivedClockInUrl;
    if (!trim(shift.poNumber)) shiftPatch.poNumber = flexJobId;
    if (Object.keys(shiftPatch).length > 0) {
      await db.doc(`tenants/${tenantId}/job_orders/${joId}/shifts/${shiftId}`).set(
        { ...shiftPatch, updatedAt: now, updatedBy: actor },
        { merge: true },
      );
    }

    await db.doc(`tenants/${tenantId}/indeed_flex_portal_captures/${flexJobId}`).set(
      {
        flexJobId,
        status: 'reconciled',
        jobOrderId: joId,
        shiftId,
        jobTitle,
        rosterSize: norm.roster.length,
        created: base.created,
        reconfirmed: base.reconfirmed,
        observedDrops: base.observedDrops,
        unmatchedCount: base.unmatchedWorkers.length,
        clockInUrl: derivedClockInUrl,
        // Raw payloads (size-capped) — lets us pin real field names for the
        // instructions/charge-rate/title extraction without re-probing, and
        // feeds the future create-JO-from-capture slice.
        rawJob: JSON.stringify(env.job ?? null).slice(0, 40000),
        rawShifts: JSON.stringify(env.shifts ?? null).slice(0, 40000),
        capturedAt: env.capturedAt ?? null,
        lastSeenAt: now,
      },
      { merge: true },
    );
  }

  return { ...base, matched: true, jobOrderId: joId, shiftId };
}

/* ────────────────────────────────────────────────────────────────────
 * HTTP endpoint (mirrors fieldglassEnrichmentIngest)
 * ──────────────────────────────────────────────────────────────────── */

export const indeedFlexPortalIngest = onRequest(
  { cors: true, memory: '512MiB', timeoutSeconds: 120, maxInstances: 4 },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST only.' } });
      return;
    }
    if (!verifyExtensionKey(req, res)) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const tenantId = trim(body.tenantId);
    const context = (body.context ?? {}) as Record<string, unknown>;
    if (!tenantId || !trim(context.jobId)) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'tenantId and context.jobId are required.' } });
      return;
    }

    const env: FlexPortalCaptureEnvelope = {
      tenantId,
      agencyId: trim(body.agencyId),
      context: {
        jobId: trim(context.jobId),
        roleId: trim(context.roleId) || null,
        venueId: trim(context.venueId) || null,
        platformId: trim(context.platformId) || null,
        url: trim(context.url) || null,
      },
      job: body.job,
      shifts: body.shifts,
      roster: body.roster,
      capturedAt: Number(body.capturedAt) || Date.now(),
    };

    try {
      const result = await reconcileFlexPortalCapture(tenantId, env, 'indeed_flex_portal_ingest');
      res.status(200).json({ success: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[indeedFlexPortalIngest] failed', { tenantId, jobId: env.context.jobId, err: message });
      res.status(500).json({ success: false, error: { code: 'INGEST_FAILED', message } });
    }
  },
);
