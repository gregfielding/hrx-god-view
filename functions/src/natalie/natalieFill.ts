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

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
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
    link: `https://hrxone.com/users/${userId}?tab=background`,
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
    profileLink: `https://hrxone.com/users/${userId}`,
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

export async function placeWorkerOnShift(tenantId: string, jobOrderId: string, shiftId: string, userId: string, opts: { source: string; note?: string; actor?: string; status?: 'confirmed' | 'pending' }): Promise<{ placed: boolean; assignmentId: string; already?: boolean; error?: string }> {
  const loaded = await loadShift(tenantId, jobOrderId, shiftId);
  if (!loaded) return { placed: false, assignmentId: '', error: 'shift not found' };
  const { jo, shift, ref } = loaded;
  const u = (await db.collection('users').doc(userId).get()).data() as Record<string, unknown> | undefined;
  if (!u) return { placed: false, assignmentId: '', error: 'user not found' };
  const assignmentId = `${shiftId}__${userId}__${ref.date}`;
  const aRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
  const existing = await aRef.get();
  if (existing.exists && !['cancelled', 'canceled', 'declined'].includes(s(existing.get('status')).toLowerCase())) return { placed: false, assignmentId, already: true };
  const dow = new Date(`${ref.date}T12:00:00Z`).getUTCDay();
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
    endDate: ref.date,
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
    weeklySchedule: { [String(dow)]: { enabled: true, startTime: ref.startTime, endTime: ref.endTime } },
    status: opts.status ?? 'confirmed',
    latestStatus: opts.status ?? 'confirmed',
    placementMode: 'assign_now',
    assignmentSource: opts.source,
    ...(ref.poNumber ? { flexJobId: ref.poNumber, poNumber: ref.poNumber } : {}),
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
  const flexJobId = loaded.ref.poNumber && /^\d+$/.test(loaded.ref.poNumber) ? loaded.ref.poNumber : null;
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

export function composeOffer(firstName: string, ref: ShiftRef, extra?: string): string {
  const when = `${fmtDate(ref.date)}, ${fmtTime(ref.startTime)}–${fmtTime(ref.endTime)}`;
  const pay = ref.payRate ? `, $${ref.payRate.toFixed(2)}/hr` : '';
  const where = ref.address ? ` (${ref.address})` : '';
  return `Hi ${firstName} — Natalie with C1 Staffing. We have a ${ref.title} shift at ${ref.site}${where} on ${when}${pay}${extra ? `. ${extra}` : ''}. Want it? Reply YES and I'll get you set up, or NO if not. — Natalie, C1 Staffing`;
}

export async function offerShiftToWorker(input: { tenantId: string; userId: string; jobOrderId: string; shiftId: string; extra?: string; askedBySlackUserId?: string; askedByName?: string; slack?: SlackRef }): Promise<{ sent: boolean; error?: string; to?: string; text?: string }> {
  const { tenantId, userId, jobOrderId, shiftId } = input;
  const loaded = await loadShift(tenantId, jobOrderId, shiftId);
  if (!loaded) return { sent: false, error: 'shift not found' };
  const u = (await db.collection('users').doc(userId).get()).data() as Record<string, unknown> | undefined;
  if (!u) return { sent: false, error: 'user not found' };
  const to = phoneE164(u);
  if (!to) return { sent: false, error: 'no usable phone' };
  if (u.smsOptIn === false || u.smsBlockedSystem === true || u.phoneInvalid === true) return { sent: false, error: 'worker cannot be texted (opted out, blocked, or invalid number)' };
  const text = composeOffer(s(u.firstName) || 'there', loaded.ref, input.extra);
  const { sendWorkerMessageInternal } = await import('../twilio');
  const r = await sendWorkerMessageInternal(to, text, { tenantId, userId, source: 'system', messageTypeId: 'natalie_offer', systemContext: true } as never);
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
  const res = await placeWorkerOnShift(tenantId, offer.jobOrderId, offer.shiftId, userId, { source: 'natalie_offer_accepted', note: `Accepted Natalie's text offer ("${replyText.slice(0, 60)}")` });
  const u = (await db.collection('users').doc(userId).get()).data() as Record<string, unknown> | undefined;
  const to = u ? phoneE164(u) : '';
  const when = `${fmtDate(offer.date)} ${fmtTime(offer.startTime)}`;
  if (res.placed || res.already) {
    if (to) {
      try {
        const { sendWorkerMessageInternal } = await import('../twilio');
        await sendWorkerMessageInternal(to, `You're set for ${offer.title} at ${offer.site} on ${when}. Please arrive 15 minutes early; you'll get a check-in reminder before the shift. Thank you! — Natalie, C1 Staffing`, { tenantId, userId, source: 'system', messageTypeId: 'natalie_offer_confirmed', systemContext: true } as never);
      } catch (err) {
        logger.warn('[natalie] offer confirmation text failed', { err: String(err) });
      }
    }
    await db.collection('natalie_sms_watches').doc(userId).set({ status: 'accepted', acceptedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await recordNatalieAction({ tenantId, kind: 'offer_accepted', summary: `${s(watch.workerName) || 'Worker'} said YES — placed on ${offer.title} ${when}`, userId, jobOrderId: offer.jobOrderId, assignmentId: res.assignmentId });
    const slack = (watch.slack ?? undefined) as SlackRef | undefined;
    const flex = await bookInFlexIfLinked(tenantId, offer.jobOrderId, offer.shiftId, userId, { slack, askedByName: 'auto (YES reply)' }).catch((e) => ({ queued: false, reason: String(e) }));
    return { placed: true, message: `placed on ${when}${flex.queued ? ', Flex booking queued' : ''}` };
  }
  return { placed: false, message: res.error ?? 'could not place' };
}

export async function workerReachBlast(input: { tenantId: string; jobOrderId: string; radiusMiles: number; message?: string; askedBySlackUserId?: string; askedByName?: string; slack?: SlackRef }): Promise<Record<string, unknown>> {
  const radius = [15, 30, 60].includes(Number(input.radiusMiles)) ? Number(input.radiusMiles) : 30;
  const shifts = await upcomingShifts(input.tenantId, input.jobOrderId, 1);
  if (!shifts.length) return { sent: false, error: 'no upcoming shift on this order' };
  const result = await runJobOrderAutoMessagingForShift(input.tenantId, input.jobOrderId, shifts[0].shiftId, {
    bypassCooldown: true,
    source: 'manual_blast',
    triggeredByUid: NATALIE_HRX_UID,
    radiusMilesOverride: radius,
    ...(input.message ? { customMessage: input.message } : {}),
  });
  await recordNatalieAction({ tenantId: input.tenantId, kind: 'worker_reach_blast', askedBySlackUserId: input.askedBySlackUserId, askedByName: input.askedByName, slack: input.slack, input: { radiusMiles: radius, message: input.message ?? null }, result: { status: result.status, smsDelivered: result.smsDelivered, pushDelivered: result.pushDelivered }, summary: `Sent a ${radius}-mile Worker Reach blast for the order (${result.smsDelivered} texts, ${result.pushDelivered} pushes)`, jobOrderId: input.jobOrderId });
  return { sent: result.status === 'sent', radiusMiles: radius, ...result };
}
