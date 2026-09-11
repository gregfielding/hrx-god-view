/**
 * Natalie fills orders (Greg, 2026-09-07: "this should be considered training
 * for Natalie — reaching out to potential workers and filling orders").
 *
 * The play she ran tonight for OnTrac Denver, made repeatable:
 *   1. candidatesForJobOrder — applicants to the order (interview score,
 *      reliability, phone ok) plus reliable workers within a radius of the
 *      worksite, ranked with reasons.
 *   2. offerShiftToWorker — text the worker an offer for a specific shift from
 *      C1 signed Natalie; register an SMS watch so the reply is relayed into
 *      the Slack thread and a YES places them automatically (webhook →
 *      placeWorkerOnShift → confirmation text).
 *   3. placeWorkerOnShift — the HRX assignment (same shape as a recruiter's
 *      "assign now"), used by the auto-place and by the place_worker tool.
 *   4. workerReachBlast — the Auto Messaging tab's radius blast, when the
 *      targeted offers are not enough.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { resolveRadiusRecipientUids } from '../jobOrderAutoMessagingRadius';
import { resolveWorksiteCoordinates, runJobOrderAutoMessagingForShift } from '../jobOrderAutoMessaging';
import { NATALIE_DISPLAY_NAME, NATALIE_HRX_UID, recordNatalieAction, registerFollowup, type SlackRef } from './natalieAudit';
import { enqueuePortalAction } from '../integrations/portalActions/enqueuePortalAction';
import { buildCareerDefaultWeeklySchedule, shiftHasUsableWeeklySchedule } from '../timesheets/careerWeeklySchedule';
import { PUBLIC_APP_ORIGIN } from '../config/appOrigin';
import { PERSONAS, smsSignature, workerLanguage, type PersonaId } from './personas';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const tsToIso = (v: unknown): string | null => {
  const d = v && typeof (v as { toDate?: () => Date }).toDate === 'function' ? (v as { toDate: () => Date }).toDate() : typeof v === 'string' ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
};
const phoneE164 = (u: Record<string, unknown>): string => {
  const e = s(u.phoneE164);
  if (/^\+1[2-9]\d{9}$/.test(e)) return e;
  const d = s(u.phone).replace(/\D/g, '');
  return d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith('1') ? `+${d}` : '';
};

export interface ShiftRef {
  jobOrderId: string;
  shiftId: string;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  site: string;
  address: string;
  payRate: number | null;
  poNumber: string | null;
  needed: number | null;
  assigned: number;
}

export async function loadShift(tenantId: string, jobOrderId: string, shiftId: string): Promise<{ jo: Record<string, unknown>; shift: Record<string, unknown>; ref: ShiftRef } | null> {
  const joSnap = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get();
  const shSnap = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}/shifts/${shiftId}`).get();
  if (!joSnap.exists || !shSnap.exists) return null;
  const jo = joSnap.data() as Record<string, unknown>;
  const shift = shSnap.data() as Record<string, unknown>;
  const asg = await db.collection(`tenants/${tenantId}/assignments`).where('shiftId', '==', shiftId).limit(300).get();
  const assigned = asg.docs.filter((d) => !['cancelled', 'canceled', 'declined'].includes(s(d.get('status')).toLowerCase())).length;
  const addr = (jo.worksiteAddress ?? {}) as Record<string, unknown>;
  const sched = (shift.dateSchedule ?? {}) as Record<string, Record<string, unknown>>;
  const needed = Object.values(sched).reduce((n, v) => n + (Number(v.workersNeeded) || 0), 0) || Number(shift.totalStaffRequested) || Number(shift.workersNeeded) || null;
  return {
    jo,
    shift,
    ref: {
      jobOrderId,
      shiftId,
      date: s(shift.shiftDate) || s(shift.startDate).slice(0, 10),
      startTime: s(shift.defaultStartTime) || '',
      endTime: s(shift.defaultEndTime) || '',
      title: s(shift.defaultJobTitle) || s(shift.shiftTitle) || s(jo.jobTitle),
      site: s(jo.worksiteName) || s(jo.locationName) || s(jo.accountName) || s(jo.companyName),
      address: [addr.street, addr.city, addr.state].filter(Boolean).join(', '),
      payRate: Number(shift.payRate ?? jo.payRate) || null,
      poNumber: s(shift.poNumber) || null,
      needed,
      assigned,
    },
  };
}

/** Upcoming shifts of a job order (today onward), oldest first. */
export async function upcomingShifts(tenantId: string, jobOrderId: string, limit = 10): Promise<ShiftRef[]> {
  const today = new Date().toISOString().slice(0, 10);
  const snap = await db.collection(`tenants/${tenantId}/job_orders/${jobOrderId}/shifts`).where('shiftDate', '>=', today).orderBy('shiftDate').limit(limit).get();
  const out: ShiftRef[] = [];
  for (const d of snap.docs) {
    const r = await loadShift(tenantId, jobOrderId, d.id);
    if (r) out.push(r.ref);
  }
  return out;
}

function fmtDate(iso: string, lang: 'en' | 'es' = 'en'): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
}
function fmtTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

export interface Candidate {
  userId: string;
  name: string;
  city: string;
  phoneOk: boolean;
  tier: unknown;
  interviewScore: number | null;
  interviewStatus: string;
  completed90d: number;
  noShows90d: number;
  cancels90d: number;
  appliedToThisOrder: boolean;
  alreadyOnOrder: boolean;
  backgroundCleared: boolean | null;
  background: string;
  score: number;
  reasons: string[];
  profileLink: string;
}

export interface BackgroundSummary {
  /** passed | failed | needs_review | in_progress | canceled | error | none */
  status: string;
  detail: string;
  package: string | null;
  orderedAt: string | null;
  reportAt: string | null;
  checkId: string | null;
  link: string | null;
}

/**
 * Background-check status the way the recruiter UI sees it: the latest
 * AccuSource record in top-level `backgroundChecks` (candidateId == uid),
 * judged by per-service-line adjudication verdicts (manual verdict wins over
 * autoVerdict). `users.backgroundCheck*` fields do not exist — never read them.
 */
export async function backgroundSummary(tenantId: string, userId: string): Promise<BackgroundSummary> {
  const none: BackgroundSummary = { status: 'none', detail: 'no background check ordered in HRX', package: null, orderedAt: null, reportAt: null, checkId: null, link: null };
  let docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  try {
    const q = await db.collection('backgroundChecks').where('candidateId', '==', userId).limit(20).get();
    docs = q.docs.filter((d) => !d.get('tenantId') || s(d.get('tenantId')) === tenantId);
  } catch {
    return { ...none, detail: 'background check lookup failed' };
  }
  if (!docs.length) return none;
  docs.sort((a, b) => (b.get('createdAt')?.toMillis?.() ?? 0) - (a.get('createdAt')?.toMillis?.() ?? 0));
  const d = docs[0];
  const x = d.data() as Record<string, unknown>;
  // Mirror src/utils/accusourceScreeningLineItems + computePackageRollup:
  // manual verdict wins over autoVerdict; a completed line with no verdict is
  // PASSED for SSN-locator/lab lines and NEEDS_REVIEW otherwise; canceled lines
  // and `order:` webhook echoes that duplicate a named line are dropped.
  const complete = (st: string) => /complete|closed|clear|^pass$/i.test(st);
  type Line = { id: string; name: string; status: string; verdict: string };
  const raw: Line[] = Object.entries((x.providerServiceOrderStatus ?? {}) as Record<string, Record<string, unknown>>).map(([id, l]) => {
    const adj = (l.adjudication ?? {}) as Record<string, unknown>;
    const name = s(l.serviceName) || s(l.jurisdiction) || id;
    const status = s(l.status) || 'Pending';
    let verdict = s(adj.verdict) || s(adj.autoVerdict) || 'PENDING';
    if (verdict === 'PENDING' && complete(status)) verdict = /social security|ssn|drug|lab /i.test(name) || l.labName != null ? 'PASSED' : 'NEEDS_REVIEW';
    return { id, name, status, verdict };
  });
  const named = raw.filter((l) => !l.id.startsWith('order:'));
  const lines = raw.filter((l) => !/cancel/i.test(l.status) && (!l.id.startsWith('order:') || !named.some((n) => n.name.toLowerCase() === l.name.toLowerCase() && n.status.toLowerCase() === l.status.toLowerCase())));
  const count = (v: string) => lines.filter((k) => k.verdict === v).length;
  const hrxStatus = s(x.hrxStatus);
  let status: string;
  let detail: string;
  const listed = (v: string) => lines.filter((l) => l.verdict === v).map((l) => l.name).join(', ');
  if (x.markedCompleteOutsideHrx === true && !count('FAILED')) { status = 'passed'; detail = 'marked complete outside HRX by a recruiter'; }
  else if (count('FAILED')) { status = 'failed'; detail = `FAILED: ${listed('FAILED')}`; }
  else if (count('NEEDS_REVIEW')) { status = 'needs_review'; detail = `recruiter must review: ${listed('NEEDS_REVIEW')}`; }
  else if (hrxStatus === 'canceled') { status = 'canceled'; detail = 'order canceled'; }
  else if (hrxStatus === 'error') { status = 'error'; detail = 'vendor error on the order'; }
  else if (count('PENDING')) { status = 'in_progress'; detail = `still pending: ${listed('PENDING')}${s(x.orderMode) === 'partial_profile' && x.profileCompleted !== true ? ' (applicant has not completed the AccuSource profile)' : ''}`; }
  else if (lines.length) { status = 'passed'; detail = `cleared — ${lines.map((l) => l.name).join(', ')}`; }
  else { status = 'in_progress'; detail = `${hrxStatus || 'ordered'}, no service lines yet`; }
  return {
    status,
    detail,
    package: s(x.requestedPackageName) || null,
    orderedAt: tsToIso(x.createdAt),
    reportAt: tsToIso(x.providerFinalReportAt ?? x.completedAt),
    checkId: d.id,
    link: `${PUBLIC_APP_ORIGIN}/users/${userId}?tab=background`,
  };
}

async function enrich(tenantId: string, userId: string, appliedToThisOrder: boolean, onOrder: Set<string>): Promise<Candidate | null> {
  const u = (await db.collection('users').doc(userId).get()).data() as Record<string, unknown> | undefined;
  if (!u) return null;
  const level = Number((u.tenantIds as Record<string, Record<string, unknown>> | undefined)?.[tenantId]?.securityLevel ?? u.securityLevel ?? 0);
  if (level >= 5) return null;
  let interviewScore: number | null = null;
  try {
    const iv = await db.collection('users').doc(userId).collection('interviews').orderBy('createdAt', 'desc').limit(1).get();
    const sc = Number(iv.docs[0]?.get('score10') ?? iv.docs[0]?.get('score'));
    interviewScore = Number.isFinite(sc) ? sc : null;
  } catch {
    interviewScore = null;
  }
  const since = Date.now() - 90 * 86400000;
  const asg = await db.collection(`tenants/${tenantId}/assignments`).where('userId', '==', userId).limit(200).get();
  let completed = 0, noShows = 0, cancels = 0;
  for (const d of asg.docs) {
    const a = d.data() as Record<string, unknown>;
    const start = tsToIso(a.startTime ?? a.startDate);
    const ms = start ? Date.parse(start) : NaN;
    if (Number.isNaN(ms) || ms < since || ms > Date.now()) continue;
    const cort = (a.cortConfirmation ?? {}) as Record<string, unknown>;
    const st = s(a.status).toLowerCase();
    if (cort.state === 'no_show' || st === 'no_show') noShows += 1;
    else if (cort.state === 'cancelled' || /cancel/.test(st)) cancels += 1;
    else completed += 1;
  }
  const bgSummary = await backgroundSummary(tenantId, userId);
  const backgroundCleared = bgSummary.status === 'none' ? null : bgSummary.status === 'passed';
  const phoneOk = Boolean(phoneE164(u)) && u.smsOptIn !== false && u.smsBlockedSystem !== true && u.phoneInvalid !== true;
  const reasons: string[] = [];
  let score = 0;
  if (appliedToThisOrder) { score += 30; reasons.push('applied to this order'); }
  if (interviewScore != null) { score += interviewScore * 4; reasons.push(`interview ${interviewScore}/10`); }
  else reasons.push('no interview yet');
  score += Math.min(completed, 10) * 3;
  if (completed) reasons.push(`${completed} shift${completed === 1 ? '' : 's'} in 90 days`);
  score -= noShows * 30;
  if (noShows) reasons.push(`${noShows} no-show${noShows === 1 ? '' : 's'}`);
  score -= cancels * 8;
  if (cancels) reasons.push(`${cancels} cancel${cancels === 1 ? '' : 's'}`);
  if (backgroundCleared) { score += 10; reasons.push('background passed'); }
  else if (bgSummary.status === 'failed') { score -= 100; reasons.push('background FAILED'); }
  else if (bgSummary.status !== 'none') reasons.push(`background ${bgSummary.status.replace('_', ' ')}`);
  const tier = (u.workerTiers as Record<string, unknown> | undefined)?.global ?? null;
  if (Number(tier) === 1) { score += 8; reasons.push('Tier 1'); }
  if (!phoneOk) { score -= 100; reasons.push('cannot be texted'); }
  const alreadyOnOrder = onOrder.has(userId);
  if (alreadyOnOrder) reasons.push('already on this order');
  return {
    userId,
    name: `${s(u.firstName)} ${s(u.lastName)}`.trim() || userId,
    city: s(u.city) || s((u.address as Record<string, unknown> | undefined)?.city),
    phoneOk,
    tier,
    interviewScore,
    interviewStatus: s(u.interviewStatus),
    completed90d: completed,
    noShows90d: noShows,
    cancels90d: cancels,
    appliedToThisOrder,
    alreadyOnOrder,
    backgroundCleared,
    background: bgSummary.status,
    score,
    reasons,
    profileLink: `${PUBLIC_APP_ORIGIN}/users/${userId}`,
  };
}

export async function candidatesForJobOrder(tenantId: string, jobOrderId: string, opts: { radiusMiles?: number; limit?: number } = {}): Promise<{ applicants: Candidate[]; nearby: Candidate[]; radiusMiles: number; note?: string }> {
  const limit = Math.max(1, Math.min(opts.limit ?? 12, 40));
  const radiusMiles = [15, 30, 60].includes(Number(opts.radiusMiles)) ? Number(opts.radiusMiles) : 15;
  // Who is already on the order's upcoming shifts.
  const onOrder = new Set<string>();
  const upcoming = await upcomingShifts(tenantId, jobOrderId, 20);
  for (const sh of upcoming) {
    const asg = await db.collection(`tenants/${tenantId}/assignments`).where('shiftId', '==', sh.shiftId).limit(300).get();
    for (const d of asg.docs) if (!['cancelled', 'canceled', 'declined'].includes(s(d.get('status')).toLowerCase())) onOrder.add(s(d.get('userId')));
  }
  // Applicants.
  const apps = await db.collection(`tenants/${tenantId}/applications`).where('jobOrderId', '==', jobOrderId).limit(200).get();
  const applicantIds = new Set<string>();
  for (const d of apps.docs) {
    if (['withdrawn', 'rejected', 'declined'].includes(s(d.get('status')).toLowerCase())) continue;
    const uid = s(d.get('userId') || d.get('candidateId'));
    if (uid) applicantIds.add(uid);
  }
  const applicants: Candidate[] = [];
  for (const uid of applicantIds) {
    const c = await enrich(tenantId, uid, true, onOrder);
    if (c && !c.alreadyOnOrder) applicants.push(c);
  }
  applicants.sort((a, b) => b.score - a.score);
  // Nearby workers (nearest first from the radius resolver).
  const nearby: Candidate[] = [];
  let note: string | undefined;
  try {
    const jo = (await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get()).data() as Record<string, unknown>;
    const center = await resolveWorksiteCoordinates(tenantId, jobOrderId, jo as never).catch(() => null);
    if (!center) note = 'The job order has no worksite coordinates, so the radius search was skipped.';
    else {
      const resolved = await resolveRadiusRecipientUids(db, { tenantId, center, miles: radiusMiles, maxRecipients: 120 });
      for (const uid of resolved.uids) {
        if (applicantIds.has(uid) || onOrder.has(uid)) continue;
        const c = await enrich(tenantId, uid, false, onOrder);
        if (c && c.phoneOk) nearby.push(c);
        if (nearby.length >= limit * 3) break;
      }
      nearby.sort((a, b) => b.score - a.score);
      if (nearby.length < 3 && radiusMiles < 30) note = `Only ${nearby.length} nearby within ${radiusMiles} mi — try radiusMiles 30.`;
    }
  } catch (err) {
    note = `Radius search failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  return { applicants: applicants.slice(0, limit), nearby: nearby.slice(0, limit), radiusMiles, note };
}

/**
 * A shift is an Indeed Flex job only when the Flex pipeline created it (applyShiftRequest stamps
 * source 'indeed_flex_apply') or a Flex request email carries its PO as the job id. An all-digit PO
 * alone is not enough: Venue Smart's QBO purchase orders are all-digit too (1238, 2159 — 21 of 23
 * C1 Events shift POs on 2026-09-11), and those used to stamp flexJobId and queue Flex bookings.
 */
export async function isFlexShift(tenantId: string, shift: Record<string, unknown>): Promise<boolean> {
  const po = s(shift.poNumber);
  if (!/^\d+$/.test(po)) return false;
  if (s(shift.source) === 'indeed_flex_apply') return true;
  const reqs = await db.collection(`tenants/${tenantId}/external_shift_requests`).where('event.jobId', '==', po).limit(5).get().catch(() => null);
  return Boolean(reqs?.docs.some((d) => s(d.get('provider')) === 'indeed_flex'));
}

export async function placeWorkerOnShift(tenantId: string, jobOrderId: string, shiftId: string, userId: string, opts: { source: string; note?: string; actor?: string; status?: 'confirmed' | 'pending' }): Promise<{ placed: boolean; assignmentId: string; already?: boolean; error?: string }> {
  const loaded = await loadShift(tenantId, jobOrderId, shiftId);
  if (!loaded) return { placed: false, assignmentId: '', error: 'shift not found' };
  const { jo, shift, ref } = loaded;
  const flexJob = await isFlexShift(tenantId, shift);
  const u = (await db.collection('users').doc(userId).get()).data() as Record<string, unknown> | undefined;
  if (!u) return { placed: false, assignmentId: '', error: 'user not found' };
  const assignmentId = `${shiftId}__${userId}__${ref.date}`;
  const aRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
  const existing = await aRef.get();
  if (existing.exists && !['cancelled', 'canceled', 'declined'].includes(s(existing.get('status')).toLowerCase())) return { placed: false, assignmentId, already: true };
  const dow = new Date(`${ref.date}T12:00:00Z`).getUTCDay();
  // Career orders are ongoing standing roles — same rules as
  // placementsCreateAssignments: endDate stays '' (a stamped end hides the
  // worker from Career Assignments, JO #404 2026-09-03) and the week is
  // Mon–Fri at the shift's times unless the shift carries its own weekly
  // schedule (the denorm trigger copies that). The one-weekday shape is for
  // one-day gigs only (2026-09-11: career workers got one timesheet row/week).
  const isCareer = s(jo.jobType).toLowerCase() === 'career';
  const careerSchedule =
    isCareer && !shiftHasUsableWeeklySchedule(shift)
      ? buildCareerDefaultWeeklySchedule(ref.date, ref.startTime, ref.endTime)
      : null;
  const addr = (jo.worksiteAddress ?? {}) as Record<string, unknown>;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const doc: Record<string, unknown> = {
    tenantId,
    jobOrderId,
    shiftId,
    candidateId: userId,
    userId,
    workerId: userId,
    firstName: s(u.firstName),
    lastName: s(u.lastName),
    email: s(u.email),
    phone: s(u.phone || u.phoneE164),
    workerDisplayName: `${s(u.firstName)} ${s(u.lastName)}`.trim(),
    startDate: ref.date,
    endDate: isCareer ? '' : ref.date,
    startTime: ref.startTime,
    endTime: ref.endTime,
    payRate: ref.payRate,
    billRate: Number(shift.billRate ?? jo.billRate) || null,
    timesheetMode: 'mobile',
    companyId: s(jo.companyId) || null,
    companyName: s(jo.companyName) || s(jo.accountName),
    companyTitle: s(jo.companyName) || s(jo.accountName),
    accountId: s(jo.recruiterAccountId) || s(jo.accountId) || null,
    locationId: s(jo.worksiteId) || null,
    locationIds: s(jo.worksiteId) ? [s(jo.worksiteId)] : [],
    locationNickname: s(jo.worksiteName),
    worksiteName: s(jo.worksiteName),
    worksiteDisplayName: s(jo.worksiteName),
    worksiteAddress: { street: s(addr.street), city: s(addr.city), state: s(addr.state), zip: s(addr.zip) },
    worksiteState: s(addr.state),
    jobOrderType: s(jo.jobType) || 'gig',
    jobTitle: ref.title,
    shiftTitle: ref.title,
    hiringEntityId: s(jo.hiringEntityId) || null,
    ...(isCareer
      ? careerSchedule
        ? { weeklySchedule: careerSchedule }
        : {}
      : { weeklySchedule: { [String(dow)]: { enabled: true, startTime: ref.startTime, endTime: ref.endTime } } }),
    status: opts.status ?? 'confirmed',
    latestStatus: opts.status ?? 'confirmed',
    placementMode: 'assign_now',
    assignmentSource: opts.source,
    ...(ref.poNumber ? { poNumber: ref.poNumber, ...(flexJob ? { flexJobId: ref.poNumber } : {}) } : {}),
    ...(s(shift.clockInUrl) ? { clockInUrl: s(shift.clockInUrl) } : {}),
    notes: opts.note ?? `Placed by ${NATALIE_DISPLAY_NAME}`,
    createdBy: opts.actor ?? NATALIE_HRX_UID,
    createdAt: now,
    assignedAt: now,
    updatedAt: now,
  };
  await aRef.set(doc, { merge: existing.exists });
  await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}/shifts/${shiftId}`).set({ assignmentsCount: admin.firestore.FieldValue.increment(1), updatedAt: now }, { merge: true }).catch(() => undefined);
  // Applicant → accepted (if they applied to this order).
  try {
    const apps = await db.collection(`tenants/${tenantId}/applications`).where('jobOrderId', '==', jobOrderId).where('userId', '==', userId).limit(3).get();
    for (const a of apps.docs) await a.ref.set({ status: 'accepted', acceptedAt: now, acceptedBy: opts.actor ?? NATALIE_HRX_UID, updatedAt: now }, { merge: true });
  } catch {
    /* index may be missing — non-fatal */
  }
  return { placed: true, assignmentId };
}

/**
 * When a shift is a Flex job (poNumber = Flex job id), book the worker into
 * the Flex portal too, so they get the venue clock-in link and Flex's roster
 * matches HRX. Queues `book_worker`; the outcome is posted back to Slack when
 * a thread is given. Workers must already be in the agency's Flex pool.
 */
export async function bookInFlexIfLinked(tenantId: string, jobOrderId: string, shiftId: string, userId: string, opts: { slack?: SlackRef; askedByName?: string | null; askedBySlackUserId?: string | null } = {}): Promise<{ queued: boolean; actionId?: string; flexJobId?: string; reason?: string }> {
  const loaded = await loadShift(tenantId, jobOrderId, shiftId);
  if (!loaded) return { queued: false, reason: 'shift not found' };
  const flexJobId = (await isFlexShift(tenantId, loaded.shift)) ? loaded.ref.poNumber : null;
  if (!flexJobId) return { queued: false, reason: 'shift is not a Flex job' };
  const u = (await db.collection('users').doc(userId).get()).data() as Record<string, unknown> | undefined;
  const workerName = `${s(u?.firstName)} ${s(u?.lastName)}`.trim();
  if (!workerName) return { queued: false, reason: 'worker has no name' };
  const res = await enqueuePortalAction(db, {
    tenantId,
    action: 'book_worker',
    payload: { flexJobId, workerName },
    refs: { jobOrderId, shiftId, userId },
    createdBy: { kind: 'system', id: `natalie:${opts.askedBySlackUserId ?? 'auto'}` },
    priority: 12,
    maxAttempts: 2,
    force: true,
  });
  if (opts.slack) await registerFollowup({ tenantId, portalActionId: res.id, slack: opts.slack, askedByName: opts.askedByName ?? null, description: `book ${workerName} on Flex ${flexJobId}` });
  await recordNatalieAction({ tenantId, kind: 'flex_book', askedBySlackUserId: opts.askedBySlackUserId ?? null, askedByName: opts.askedByName ?? null, slack: opts.slack, input: { flexJobId, workerName }, result: { actionId: res.id }, summary: `Queued Flex booking of ${workerName} on job ${flexJobId}`, userId, jobOrderId });
  return { queued: true, actionId: res.id, flexJobId };
}

export function composeOffer(firstName: string, ref: ShiftRef, extra?: string, opts: { persona?: PersonaId; lang?: 'en' | 'es' } = {}): string {
  const persona = opts.persona ?? 'natalie';
  const lang = opts.lang ?? 'en';
  const me = PERSONAS[persona].firstName;
  const when = `${fmtDate(ref.date, lang)}, ${fmtTime(ref.startTime)}–${fmtTime(ref.endTime)}`;
  const where = ref.address ? ` (${ref.address})` : '';
  if (lang === 'es') {
    const pago = ref.payRate ? `, $${ref.payRate.toFixed(2)}/hora` : '';
    return `Hola ${firstName} — soy ${me} de C1 Staffing. Tenemos un turno de ${ref.title} en ${ref.site}${where} el ${when}${pago}${extra ? `. ${extra}` : ''}. ¿Te interesa? Responde SÍ y te apunto, o NO si no puedes. ${smsSignature(persona, 'es')}`;
  }
  const pay = ref.payRate ? `, $${ref.payRate.toFixed(2)}/hr` : '';
  return `Hi ${firstName} — ${me} with C1 Staffing. We have a ${ref.title} shift at ${ref.site}${where} on ${when}${pay}${extra ? `. ${extra}` : ''}. Want it? Reply YES and I'll get you set up, or NO if not. ${smsSignature(persona)}`;
}

/** Pure: the "you're set" text after a YES. */
export function composeOfferConfirmation(offer: { title?: string; site?: string; date?: string; startTime?: string }, opts: { persona?: PersonaId; lang?: 'en' | 'es' } = {}): string {
  const persona = opts.persona ?? 'natalie';
  const lang = opts.lang ?? 'en';
  const when = `${fmtDate(s(offer.date), lang)} ${fmtTime(s(offer.startTime))}`;
  return lang === 'es'
    ? `Listo, quedas confirmado para ${s(offer.title)} en ${s(offer.site)} el ${when}. Llega 15 minutos antes; te mandaremos un recordatorio antes del turno. ¡Gracias! ${smsSignature(persona, 'es')}`
    : `You're set for ${s(offer.title)} at ${s(offer.site)} on ${when}. Please arrive 15 minutes early; you'll get a check-in reminder before the shift. Thank you! ${smsSignature(persona)}`;
}

export async function offerShiftToWorker(input: { tenantId: string; userId: string; jobOrderId: string; shiftId: string; extra?: string; askedBySlackUserId?: string; askedByName?: string; slack?: SlackRef; persona?: PersonaId }): Promise<{ sent: boolean; error?: string; to?: string; text?: string }> {
  const persona = input.persona ?? 'natalie';
  const { tenantId, userId, jobOrderId, shiftId } = input;
  const loaded = await loadShift(tenantId, jobOrderId, shiftId);
  if (!loaded) return { sent: false, error: 'shift not found' };
  const u = (await db.collection('users').doc(userId).get()).data() as Record<string, unknown> | undefined;
  if (!u) return { sent: false, error: 'user not found' };
  const to = phoneE164(u);
  if (!to) return { sent: false, error: 'no usable phone' };
  if (u.smsOptIn === false || u.smsBlockedSystem === true || u.phoneInvalid === true) return { sent: false, error: 'worker cannot be texted (opted out, blocked, or invalid number)' };
  const bg = await backgroundSummary(tenantId, userId);
  if (bg.status === 'failed') return { sent: false, error: `not offered — background check FAILED in HRX (${bg.detail}); a recruiter must decide` };
  const lang = workerLanguage(u);
  const text = composeOffer(s(u.firstName) || (lang === 'es' ? '' : 'there'), loaded.ref, input.extra, { persona, lang });
  const { sendWorkerMessageInternal } = await import('../twilio');
  const r = await sendWorkerMessageInternal(to, text, { tenantId, userId, source: 'system', messageTypeId: `${PERSONAS[persona].smsPrefix}offer`, systemContext: true } as never);
  if (!r.success) return { sent: false, error: r.error ?? r.errorCode ?? 'send failed', to: `…${to.slice(-4)}` };
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.collection('natalie_sms_watches').doc(userId).set(
    {
      tenantId,
      userId,
      phoneE164: to,
      workerName: `${s(u.firstName)} ${s(u.lastName)}`.trim(),
      slack: input.slack ?? null,
      context: `offer ${loaded.ref.title} ${loaded.ref.date}`,
      persona,
      lang,
      offer: { jobOrderId, shiftId, date: loaded.ref.date, title: loaded.ref.title, site: loaded.ref.site, startTime: loaded.ref.startTime, endTime: loaded.ref.endTime },
      status: 'active',
      createdAt: now,
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 3 * 86400000),
    },
    { merge: true },
  );
  await recordNatalieAction({ tenantId, kind: 'shift_offer', askedBySlackUserId: input.askedBySlackUserId, askedByName: input.askedByName, slack: input.slack, input: { jobOrderId, shiftId }, result: { to: `…${to.slice(-4)}` }, summary: `Texted an offer for ${loaded.ref.title} at ${loaded.ref.site} on ${fmtDate(loaded.ref.date)}`, userId, jobOrderId });
  return { sent: true, to: `…${to.slice(-4)}`, text };
}

/** Called by the inbound SMS webhook when a watched worker replies YES to an offer. */
export async function acceptOfferFromReply(watch: Record<string, unknown>, replyText: string): Promise<{ placed: boolean; message: string }> {
  const offer = (watch.offer ?? {}) as Record<string, string>;
  const tenantId = s(watch.tenantId);
  const userId = s(watch.userId);
  if (!offer.shiftId || !tenantId || !userId) return { placed: false, message: 'watch has no offer' };
  // Never auto-place someone whose AccuSource check FAILED (Greg 2026-09-07).
  const bg = await backgroundSummary(tenantId, userId);
  if (bg.status === 'failed') {
    await db.collection('natalie_sms_watches').doc(userId).set({ status: 'blocked_background', blockedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await recordNatalieAction({ tenantId, kind: 'offer_blocked_background', summary: `${s(watch.workerName) || 'Worker'} said YES but their background check is FAILED (${bg.detail}) — NOT placed; recruiter decision needed`, userId, jobOrderId: offer.jobOrderId });
    return { placed: false, message: `NOT placed — background check FAILED in HRX (${bg.detail}); a recruiter needs to decide` };
  }
  const persona: PersonaId = watch.persona === 'marco' ? 'marco' : 'natalie';
  const P = PERSONAS[persona];
  const res = await placeWorkerOnShift(tenantId, offer.jobOrderId, offer.shiftId, userId, { source: `${persona}_offer_accepted`, note: `Accepted ${P.firstName}'s text offer ("${replyText.slice(0, 60)}")`, actor: P.hrxUid ?? persona });
  const u = (await db.collection('users').doc(userId).get()).data() as Record<string, unknown> | undefined;
  const to = u ? phoneE164(u) : '';
  const when = `${fmtDate(offer.date)} ${fmtTime(offer.startTime)}`;
  if (res.placed || res.already) {
    if (to) {
      try {
        const { sendWorkerMessageInternal } = await import('../twilio');
        await sendWorkerMessageInternal(to, composeOfferConfirmation(offer, { persona, lang: workerLanguage(u) }), { tenantId, userId, source: 'system', messageTypeId: `${P.smsPrefix}offer_confirmed`, systemContext: true } as never);
      } catch (err) {
        logger.warn('[natalie] offer confirmation text failed', { err: String(err) });
      }
    }
    await db.collection('natalie_sms_watches').doc(userId).set({ status: 'accepted', acceptedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await recordNatalieAction({ tenantId, kind: 'offer_accepted', summary: `${s(watch.workerName) || 'Worker'} said YES — placed on ${offer.title} ${when}`, userId, jobOrderId: offer.jobOrderId, assignmentId: res.assignmentId });
    const slack = (watch.slack ?? undefined) as SlackRef | undefined;
    const flex = await bookInFlexIfLinked(tenantId, offer.jobOrderId, offer.shiftId, userId, { slack, askedByName: 'auto (YES reply)' }).catch((e) => ({ queued: false, reason: String(e) }));
    const screening = await kickOffScreening({ tenantId, userId, jobOrderId: offer.jobOrderId, assignmentId: res.assignmentId, slack, background: bg }).catch((e) => ({ note: `screening kick-off failed: ${String(e)}` }));
    return { placed: true, message: `placed on ${when}${flex.queued ? ', Flex booking queued' : ''}${screening.note ? `; ${screening.note}` : ''}` };
  }
  return { placed: false, message: res.error ?? 'could not place' };
}

export async function workerReachBlast(input: { tenantId: string; jobOrderId: string; radiusMiles: number; message?: string; askedBySlackUserId?: string; askedByName?: string; slack?: SlackRef }): Promise<Record<string, unknown>> {
  const radius = [15, 30, 60].includes(Number(input.radiusMiles)) ? Number(input.radiusMiles) : 30;
  const shifts = await upcomingShifts(input.tenantId, input.jobOrderId, 1);
  // No upcoming shift (e.g. a career posting): blast the posting itself.
  const result = await runJobOrderAutoMessagingForShift(input.tenantId, input.jobOrderId, shifts[0]?.shiftId ?? null, {
    bypassCooldown: true,
    source: 'manual_blast',
    triggeredByUid: NATALIE_HRX_UID,
    radiusMilesOverride: radius,
    ...(input.message ? { customMessage: input.message } : {}),
  });
  await recordNatalieAction({ tenantId: input.tenantId, kind: 'worker_reach_blast', askedBySlackUserId: input.askedBySlackUserId, askedByName: input.askedByName, slack: input.slack, input: { radiusMiles: radius, message: input.message ?? null }, result: { status: result.status, smsDelivered: result.smsDelivered, pushDelivered: result.pushDelivered }, summary: `Sent a ${radius}-mile Worker Reach blast for the order (${result.smsDelivered} texts, ${result.pushDelivered} pushes)`, jobOrderId: input.jobOrderId });
  return { sent: result.status === 'sent', radiusMiles: radius, ...result };
}


// ---------------------------------------------------------------------------
// Background checks (Greg 2026-09-07: "if any of them want it, order the
// Sodexo Basic package right away and follow up with them to make sure they
// do it"). Ordering goes through the existing AccuSource path; the worker is
// texted the applicant portal link (nothing else in HRX sends it) and the
// watch carries `bgFollowup` which drainBackgroundFollowups nudges/closes.
// ---------------------------------------------------------------------------

const DEFAULT_BG_PACKAGE = { id: '23923', name: 'Sodexo Basic Package' };

async function resolveBackgroundPackage(tenantId: string, jobOrderId: string | null, explicitId?: string): Promise<{ id: string; name: string }> {
  const catalog = (await db.doc('integrations_accusource/catalog').get().catch(() => null))?.get('packages') as Array<Record<string, unknown>> | undefined;
  const byId = (id: string) => { const hit = (catalog ?? []).find((p) => s(p.id) === id); return hit ? { id, name: s(hit.name) || id } : null; };
  if (explicitId) return byId(explicitId) ?? { id: explicitId, name: explicitId };
  if (jobOrderId) {
    const jo = (await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get()).data() ?? {};
    const id = s((jo as Record<string, unknown>).screeningPackageId);
    if (id) return byId(id) ?? { id, name: s((jo as Record<string, unknown>).screeningPackageName) || id };
  }
  const cfg = (await db.doc(`tenants/${tenantId}/app_config/natalie`).get()).data() as Record<string, unknown> | undefined;
  const cfgId = s((cfg?.defaultBackgroundPackage as Record<string, unknown> | undefined)?.id);
  if (cfgId) return byId(cfgId) ?? { id: cfgId, name: s((cfg?.defaultBackgroundPackage as Record<string, unknown>).name) || cfgId };
  return DEFAULT_BG_PACKAGE;
}

export async function latestBackgroundCheckDoc(tenantId: string, userId: string): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const q = await db.collection('backgroundChecks').where('candidateId', '==', userId).limit(20).get();
  const docs = q.docs.filter((d) => !d.get('tenantId') || s(d.get('tenantId')) === tenantId);
  docs.sort((a, b) => (b.get('createdAt')?.toMillis?.() ?? 0) - (a.get('createdAt')?.toMillis?.() ?? 0));
  return docs[0] ?? null;
}

export function portalLinkText(firstName: string, link: string, packageName: string, reminder = false): string {
  const name = firstName || 'there';
  return reminder
    ? `Hi ${name}, quick reminder from C1 Staffing: your background check form is still waiting. It takes about 5 minutes: ${link} — you can't be scheduled until it's done. Reply here if you get stuck. — Natalie`
    : `Hi ${name}, C1 Staffing ordered your background check (${packageName}) so we can get you working. Please complete the short AccuSource form here: ${link} — it takes about 5 minutes. Reply if you have any trouble. — Natalie, C1 Staffing`;
}

/** Text the worker their AccuSource portal link (if known yet) and arm the follow-up watch. */
export async function armBackgroundFollowup(input: { tenantId: string; userId: string; checkId: string | null; packageName: string; slack?: SlackRef; via: string }): Promise<{ linkTexted: boolean; note: string }> {
  const { tenantId, userId } = input;
  const u = (await db.collection('users').doc(userId).get()).data() as Record<string, unknown> | undefined;
  const to = u ? phoneE164(u) : '';
  let link: string | null = null;
  if (input.checkId) {
    const bgDoc = await db.collection('backgroundChecks').doc(input.checkId).get();
    link = s(bgDoc.get('applicantPortalLink')) || s(bgDoc.get('applicantPortalUrl')) || null;
  }
  let linkTexted = false;
  if (link && to && u?.smsOptIn !== false && u?.smsBlockedSystem !== true && u?.phoneInvalid !== true) {
    try {
      const { sendWorkerMessageInternal } = await import('../twilio');
      const r = await sendWorkerMessageInternal(to, portalLinkText(s(u?.firstName), link, input.packageName), { tenantId, userId, source: 'system', messageTypeId: 'natalie_bg_portal_link', systemContext: true } as never);
      linkTexted = Boolean(r.success);
    } catch (err) {
      logger.warn('[natalie] portal link text failed', { err: String(err) });
    }
  }
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.collection('natalie_sms_watches').doc(userId).set(
    {
      tenantId,
      userId,
      phoneE164: to || null,
      workerName: `${s(u?.firstName)} ${s(u?.lastName)}`.trim(),
      slack: input.slack ?? null,
      status: 'active',
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 86400000),
      bgFollowup: { active: true, checkId: input.checkId, packageName: input.packageName, startedAt: now, linkTexted, lastNudgeAt: linkTexted ? now : null, nudges: 0, via: input.via },
      createdAt: now,
    },
    { merge: true },
  );
  return { linkTexted, note: linkTexted ? 'texted them the AccuSource form link; I will follow up until it is done' : link ? 'form link exists but could not be texted' : 'AccuSource form link not issued yet; I will text it as soon as it appears' };
}

/**
 * After a YES placement: run the assignment-confirmed screening automation
 * (Natalie's assignments are born `confirmed`, so the Firestore update trigger
 * never fires for them) and arm the follow-up. No-op when already cleared.
 */
export async function kickOffScreening(input: { tenantId: string; userId: string; jobOrderId: string; assignmentId: string; slack?: SlackRef; background?: BackgroundSummary }): Promise<{ note: string }> {
  const { tenantId, userId, jobOrderId, assignmentId } = input;
  const bg = input.background ?? (await backgroundSummary(tenantId, userId));
  if (bg.status === 'passed') return { note: 'background already cleared' };
  if (bg.status === 'failed') return { note: 'background FAILED — not re-ordering' };
  if (bg.status === 'in_progress' || bg.status === 'needs_review') {
    const existing = await latestBackgroundCheckDoc(tenantId, userId);
    if (existing && existing.get('profileCompleted') !== true && (s(existing.get('applicantPortalLink')) || s(existing.get('applicantPortalUrl')))) {
      const armed = await armBackgroundFollowup({ tenantId, userId, checkId: existing.id, packageName: s(existing.get('requestedPackageName')) || 'background check', slack: input.slack, via: 'existing_order' });
      return { note: `background check already ordered but the form is not done — ${armed.note}` };
    }
    return { note: `background ${bg.status.replace('_', ' ')} (${bg.detail})` };
  }
  const before = await latestBackgroundCheckDoc(tenantId, userId);
  const after = (await db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).get()).data() as Record<string, unknown> | undefined;
  if (!after) return { note: 'assignment not found for screening' };
  const pkg = await resolveBackgroundPackage(tenantId, jobOrderId);
  try {
    const { runScreeningAutomationForConfirmedAssignment } = await import('../compliance/screeningAutomationTrigger');
    await runScreeningAutomationForConfirmedAssignment({ tenantId, assignmentId, after });
  } catch (err) {
    logger.warn('[natalie] screening automation call failed', { err: String(err) });
  }
  let created = await latestBackgroundCheckDoc(tenantId, userId);
  if (!created || (before && created.id === before.id)) {
    // The automation declined (no package on the order, entity not allow-listed, dry run…) — order directly.
    const direct = await orderBackgroundCheck({ tenantId, userId, jobOrderId, packageId: pkg.id, slack: input.slack, askedByName: 'auto (YES reply)' });
    return { note: direct.ordered ? `ordered ${pkg.name}; ${direct.note}` : `could not order ${pkg.name}: ${direct.error}` };
  }
  const armed = await armBackgroundFollowup({ tenantId, userId, checkId: created.id, packageName: s(created.get('requestedPackageName')) || pkg.name, slack: input.slack, via: 'assignment_confirmed_automation' });
  await recordNatalieAction({ tenantId, kind: 'background_ordered', summary: `Ordered ${s(created.get('requestedPackageName')) || pkg.name} for ${s(after.workerName) || userId} via the assignment-confirmed automation`, userId, jobOrderId, assignmentId });
  return { note: `ordered ${s(created.get('requestedPackageName')) || pkg.name}; ${armed.note}` };
}

/** Order an AccuSource package for a worker directly (Slack tool or fallback). */
export async function orderBackgroundCheck(input: { tenantId: string; userId: string; jobOrderId?: string | null; packageId?: string; slack?: SlackRef; askedByName?: string; askedBySlackUserId?: string }): Promise<{ ordered: boolean; checkId?: string; packageName?: string; note: string; error?: string }> {
  const { tenantId, userId } = input;
  const bg = await backgroundSummary(tenantId, userId);
  if (bg.status === 'passed' && !input.packageId) return { ordered: false, note: '', error: `already cleared (${bg.detail}) — pass a packageId to order a different package anyway` };
  if (bg.status === 'in_progress') {
    const existing = await latestBackgroundCheckDoc(tenantId, userId);
    if (existing && !input.packageId) {
      const armed = await armBackgroundFollowup({ tenantId, userId, checkId: existing.id, packageName: s(existing.get('requestedPackageName')) || 'background check', slack: input.slack, via: 'existing_order' });
      return { ordered: false, checkId: existing.id, note: `an order is already in flight (${bg.detail}); ${armed.note}`, error: 'already in progress' };
    }
  }
  const u = (await db.collection('users').doc(userId).get()).data() as Record<string, unknown> | undefined;
  if (!u) return { ordered: false, note: '', error: 'user not found' };
  const pkg = await resolveBackgroundPackage(tenantId, input.jobOrderId ?? null, input.packageId);
  const jo = input.jobOrderId ? ((await db.doc(`tenants/${tenantId}/job_orders/${input.jobOrderId}`).get()).data() as Record<string, unknown> | undefined) : undefined;
  try {
    const { createBackgroundCheckInternal } = await import('../integrations/accusource/createBackgroundCheck');
    const result = await createBackgroundCheckInternal(
      {
        tenantId,
        accountId: s(jo?.accountId) || undefined,
        accountName: s(jo?.accountName) || undefined,
        candidateId: userId,
        candidateName: `${s(u.firstName)} ${s(u.lastName)}`.trim() || s(u.email) || userId,
        jobOrderId: input.jobOrderId || undefined,
        worksiteId: s(jo?.worksiteId) || undefined,
        requestedPackageId: pkg.id,
        requestedPackageName: pkg.name,
        requestedServices: [],
        candidate: { firstName: s(u.firstName), lastName: s(u.lastName), email: s(u.email), phone: s(u.phone) || s(u.phoneE164), dateOfBirth: (u.dateOfBirth ?? u.dob) as never },
      } as never,
      NATALIE_HRX_UID,
      { type: 'automation' },
    );
    await db.collection('backgroundChecks').doc(result.backgroundCheckId).set({ automationSource: 'natalie', automationTenantId: tenantId, orderedByName: 'Natalie Brooks', orderedForName: input.askedByName ?? null }, { merge: true });
    const armed = await armBackgroundFollowup({ tenantId, userId, checkId: result.backgroundCheckId, packageName: pkg.name, slack: input.slack, via: 'natalie_order' });
    await recordNatalieAction({ tenantId, kind: 'background_ordered', askedBySlackUserId: input.askedBySlackUserId, askedByName: input.askedByName, slack: input.slack, input: { packageId: pkg.id }, result: { checkId: result.backgroundCheckId, linkTexted: armed.linkTexted }, summary: `Ordered ${pkg.name} (AccuSource) for ${`${s(u.firstName)} ${s(u.lastName)}`.trim()}`, userId, jobOrderId: input.jobOrderId ?? null });
    return { ordered: true, checkId: result.backgroundCheckId, packageName: pkg.name, note: armed.note };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('[natalie] background order failed', { err: msg });
    return { ordered: false, note: '', error: msg };
  }
}

/** Scheduled Natalie actions (e.g. "blast again tomorrow morning at 30 miles"). */
export async function scheduleAction(input: { tenantId: string; kind: 'worker_reach_blast'; runAt: Date; params: Record<string, unknown>; slack?: SlackRef; askedByName?: string; askedBySlackUserId?: string }): Promise<{ scheduled: boolean; id?: string; runAt: string; error?: string }> {
  if (Number.isNaN(input.runAt.getTime())) return { scheduled: false, runAt: '', error: 'invalid runAt' };
  if (input.runAt.getTime() < Date.now() - 60_000) return { scheduled: false, runAt: input.runAt.toISOString(), error: 'runAt is in the past' };
  const ref = await db.collection('natalie_scheduled_actions').add({
    tenantId: input.tenantId,
    kind: input.kind,
    params: input.params,
    runAt: admin.firestore.Timestamp.fromDate(input.runAt),
    slack: input.slack ?? null,
    askedByName: input.askedByName ?? null,
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await recordNatalieAction({ tenantId: input.tenantId, kind: 'schedule_action', askedBySlackUserId: input.askedBySlackUserId, askedByName: input.askedByName, slack: input.slack, input: { kind: input.kind, runAt: input.runAt.toISOString(), ...input.params }, summary: `Scheduled ${input.kind.replace(/_/g, ' ')} for ${input.runAt.toLocaleString('en-US', { timeZone: 'America/Denver' })} MT`, jobOrderId: s(input.params.jobOrderId) || null });
  return { scheduled: true, id: ref.id, runAt: input.runAt.toISOString() };
}
