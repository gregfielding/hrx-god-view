/**
 * Tools Natalie can use when a recruiter DMs or @mentions her in Slack.
 * Read-only against Firestore except the actions a recruiter explicitly
 * asked for (sync, accept, text, note, task) — each of those is recorded in
 * `natalie_actions` and on the worker's activity feed (natalieAudit.ts), and
 * portal actions get a follow-up posted into the Slack thread when they end.
 */
import * as admin from 'firebase-admin';
import type Anthropic from '@anthropic-ai/sdk';
import { enqueuePortalAction } from '../integrations/portalActions/enqueuePortalAction';
import { NATALIE_DISPLAY_NAME, NATALIE_HRX_UID, recordNatalieAction, registerFollowup, type SlackRef } from './natalieAudit';
import { readInbox, sendEmail } from './natalieMailbox';
import { bookInFlexIfLinked, candidatesForJobOrder, offerShiftToWorker, placeWorkerOnShift, upcomingShifts, workerReachBlast } from './natalieFill';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const C1_TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const tsToIso = (v: unknown): string | null => {
  const d = v && typeof (v as { toDate?: () => Date }).toDate === 'function' ? (v as { toDate: () => Date }).toDate() : typeof v === 'string' ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
};
const last4 = (p: unknown) => s(p).replace(/\D/g, '').slice(-4);

export interface NatalieToolContext {
  tenantId: string;
  /** Slack user id of the person asking (for audit stamps). */
  askedBySlackUserId: string;
  askedByName: string;
  /** Where the ask came from — outcomes get posted back here. */
  slack?: SlackRef;
}

export const NATALIE_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'find_worker',
    description:
      'Look up workers in HRX by name, phone number, or email. Returns up to 8 matches with id, name, phone last 4, tier, SMS status, and upcoming/recent assignment counts. Use this first when someone asks about a worker by name.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Name, phone, or email' } }, required: ['query'] },
  },
  {
    name: 'worker_status',
    description:
      "Everything current about one worker: AccuSource background-check status (passed / needs_review / failed / in_progress / none, with detail), upcoming and recent assignments (job, site, start, confirmation state, check-in, no-show, cancellation), whether they were texted for a late check-in, recruiter notes, and their last few SMS exchanges. Needs the worker's HRX user id from find_worker.",
    input_schema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] },
  },
  {
    name: 'portal_sync_status',
    description:
      'Status of the Fieldglass and Indeed Flex portal syncs: when each last succeeded, what it did, the portal worker heartbeat, and any failed or stuck actions. Use for questions like "are Fieldglass orders synced?"',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'request_portal_sync',
    description:
      'Queue a sync now. provider "fieldglass" pulls Sodexo/Fieldglass job postings into HRX job orders; provider "indeed_flex" pulls Flex jobs, rosters and timesheets. Optional postingIds (Fieldglass SDXOJP…) or flexJobIds to target specific ones. Returns the queued action id; the portal worker runs it within a couple of minutes and you will post the result in the thread when it finishes.',
    input_schema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['fieldglass', 'indeed_flex'] },
        postingIds: { type: 'array', items: { type: 'string' } },
        flexJobIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['provider'],
    },
  },
  {
    name: 'list_flex_requests',
    description:
      'Recent Indeed Flex job requests received by email (new requests, changes, cancellations) with their HRX match status and whether Natalie has accepted them in the portal. Use for "what Flex orders came in" or "did we accept the Denver request".',
    input_schema: { type: 'object', properties: { days: { type: 'number', description: 'Look back this many days (default 3)' } }, required: [] },
  },
  {
    name: 'accept_flex_request',
    description:
      'Accept an Indeed Flex job request in the agency portal (Respond → Confirm) for the given Flex job id. This commits C1 to filling the headcount, so only call it when the person clearly asked to accept a specific request. Optional headcount to accept per day.',
    input_schema: { type: 'object', properties: { flexJobId: { type: 'string' }, headcount: { type: 'number' } }, required: ['flexJobId'] },
  },
  {
    name: 'job_order_fill_status',
    description:
      'Find open HRX job orders matching a client, site, or title and report upcoming shifts with workers needed vs. assigned. Use for "how is the CORT order looking" or "what do we still need to fill this week".',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Client, site, or job title words. Empty = all open orders with upcoming shifts.' } }, required: [] },
  },
  {
    name: 'add_worker_note',
    description:
      "Save something a recruiter tells you about a worker onto their HRX profile notes (e.g. 'prefers mornings', 'do not send to CORT', 'great with forklifts'). Use when someone shares a fact or preference about a worker that should be remembered. Needs the HRX user id from find_worker.",
    input_schema: { type: 'object', properties: { userId: { type: 'string' }, note: { type: 'string' } }, required: ['userId', 'note'] },
  },
  {
    name: 'rank_workers',
    description:
      "Rank workers by reliability for a shift or client: completed shifts, no-shows, worker cancellations over the last 90 days, tier, and recruiter notes, with reasons. Optional query narrows to people who have worked for that client/site/title before (e.g. 'CORT', 'Denver', 'forklift'). Use for 'who should I send Saturday?' or 'who are my most reliable people for OnTrac?'.",
    input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: [] },
  },
  {
    name: 'create_task',
    description:
      "Create an HRX task on a recruiter's task list ('remind Rosa Thursday to call Claudia'). assigneeName is the recruiter's first name (or 'me' for the person asking); dueDate is YYYY-MM-DD; include the worker's user id when the task is about a worker.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        assigneeName: { type: 'string' },
        dueDate: { type: 'string' },
        details: { type: 'string' },
        userId: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
      },
      required: ['title', 'assigneeName', 'dueDate'],
    },
  },
  {
    name: 'candidates_for_job_order',
    description:
      "Who could fill an order: applicants to the job order (interview score, reliability, background) plus reliable workers within 15/30/60 miles of the worksite, ranked with reasons, excluding people already on the order. Also returns the order's upcoming shifts with needed vs assigned. Use for 'anyone good for the OnTrac order?' or before offering shifts. Find the jobOrderId with job_order_fill_status.",
    input_schema: { type: 'object', properties: { jobOrderId: { type: 'string' }, radiusMiles: { type: 'number', enum: [15, 30, 60] }, limit: { type: 'number' } }, required: ['jobOrderId'] },
  },
  {
    name: 'order_background_check',
    description:
      "Order an AccuSource background check for a worker (default: the job order's package, else Sodexo Basic Package 23923), text them the applicant form link, and follow up daily until they complete it. Use when a recruiter says to order/run a background on someone, or when a worker says YES to an order that requires one. Refuses if they already cleared it unless packageId is given. Needs userId; jobOrderId helps pick the package and account.",
    input_schema: { type: 'object', properties: { userId: { type: 'string' }, jobOrderId: { type: 'string' }, packageId: { type: 'string', description: 'AccuSource package id, e.g. 23923 Sodexo Basic, 36841 Database Package' } }, required: ['userId'] },
  },
  {
    name: 'schedule_blast',
    description:
      "Schedule a Worker Reach SMS blast for a job order at a future time (e.g. 'tomorrow 9am at 30 miles'). Runs itself and reports back in this thread. runAt must be ISO-8601 with an offset (America/Denver is -06:00 in September). radiusMiles 15, 30 or 60.",
    input_schema: { type: 'object', properties: { jobOrderId: { type: 'string' }, radiusMiles: { type: 'number' }, runAt: { type: 'string' } }, required: ['jobOrderId', 'runAt'] },
  },
  {
    name: 'offer_shift',
    description:
      "Text a worker an offer for one specific shift (date, time, site, pay) from C1 signed Natalie, with 'Reply YES'. A YES places them on the shift automatically and confirms by text; replies are relayed into this Slack thread. Use when a recruiter asks you to reach out to someone about a shift, or to fill an order after candidates_for_job_order. Needs userId, jobOrderId and shiftId.",
    input_schema: { type: 'object', properties: { userId: { type: 'string' }, jobOrderId: { type: 'string' }, shiftId: { type: 'string' }, extra: { type: 'string', description: 'Optional extra sentence, e.g. "more days this week"' } }, required: ['userId', 'jobOrderId', 'shiftId'] },
  },
  {
    name: 'place_worker',
    description:
      'Put a worker on a shift in HRX right away (no offer text) — the same as a recruiter clicking Assign. Use when the person explicitly says to put someone on a shift. Needs userId, jobOrderId and shiftId.',
    input_schema: { type: 'object', properties: { userId: { type: 'string' }, jobOrderId: { type: 'string' }, shiftId: { type: 'string' } }, required: ['userId', 'jobOrderId', 'shiftId'] },
  },
  {
    name: 'book_in_flex',
    description:
      "Book a worker into the Indeed Flex portal for a shift that is a Flex job (the shift's PO number is the Flex job id), so they get the venue clock-in link and Flex's roster matches HRX. The worker must already be in C1's Flex worker pool. Use after place_worker, or when asked to 'book X in Flex'. Reports back in this thread when the portal worker finishes.",
    input_schema: { type: 'object', properties: { userId: { type: 'string' }, jobOrderId: { type: 'string' }, shiftId: { type: 'string' } }, required: ['userId', 'jobOrderId', 'shiftId'] },
  },
  {
    name: 'worker_reach_blast',
    description:
      "Send the job order's Worker Reach text blast to eligible workers near the worksite (nearest first, up to 200; opt-outs and anyone texted in the last 24h are skipped) inviting them to the jobs-board posting. Use when targeted offers are not enough. radiusMiles 15, 30 or 60. Only when a recruiter asked for a blast or agreed to one.",
    input_schema: { type: 'object', properties: { jobOrderId: { type: 'string' }, radiusMiles: { type: 'number', enum: [15, 30, 60] }, message: { type: 'string', description: 'Optional custom text; {link} inserts the jobs-board link' } }, required: ['jobOrderId'] },
  },
  {
    name: 'read_inbox',
    description:
      "Read Natalie's own email inbox (n.brooks@c1staffing.com): recent threads with sender, subject, and a preview, flagged when they come from automated senders (Fieldglass / Flex notifications). Use for 'anything in your email from Sodexo?' or 'did the Flex team email you?'. Optional Gmail search query (e.g. 'from:indeedflex newer_than:1d').",
    input_schema: { type: 'object', properties: { query: { type: 'string' }, max: { type: 'number' } }, required: [] },
  },
  {
    name: 'send_email',
    description:
      'Send an email as Natalie (n.brooks@c1staffing.com). Only when the person explicitly asked you to email someone; keep it short and professional. To reply in an existing thread pass threadId and inReplyToMessageId from read_inbox.',
    input_schema: {
      type: 'object',
      properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, threadId: { type: 'string' }, inReplyToMessageId: { type: 'string' } },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'send_worker_sms',
    description:
      'Text a worker from C1 (signed as Natalie). Only when the person explicitly asked you to message the worker; keep it short and professional. Returns delivery status.',
    input_schema: { type: 'object', properties: { userId: { type: 'string' }, text: { type: 'string' } }, required: ['userId', 'text'] },
  },
];

async function findWorker(tenantId: string, query: string): Promise<unknown> {
  const q = query.trim();
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const push = (d: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot) => {
    if (!d.exists || seen.has(d.id)) return;
    const x = d.data() as Record<string, unknown>;
    const tenants = x.tenantIds && typeof x.tenantIds === 'object' ? Object.keys(x.tenantIds as object) : [];
    if (tenants.length && !tenants.includes(tenantId) && x.tenantId !== tenantId) return;
    seen.add(d.id);
    out.push({
      userId: d.id,
      name: `${s(x.firstName)} ${s(x.lastName)}`.trim(),
      phoneLast4: last4(x.phoneE164 || x.phone),
      email: s(x.email),
      city: s(x.city) || s((x.address as Record<string, unknown> | undefined)?.city),
      tier: (x.workerTiers as Record<string, unknown> | undefined)?.global ?? null,
      smsOptIn: x.smsOptIn ?? null,
      smsBlocked: x.smsBlockedSystem === true,
      phoneInvalid: x.phoneInvalid === true,
      interviewStatus: s(x.interviewStatus) || null,
      createdAt: tsToIso(x.createdAt),
    });
  };
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 10) {
    const e164 = `+1${digits.slice(-10)}`;
    (await db.collection('users').where('phoneE164', '==', e164).limit(3).get()).docs.forEach(push);
  }
  if (q.includes('@')) (await db.collection('users').where('email', '==', q.toLowerCase()).limit(3).get()).docs.forEach(push);
  if (out.length === 0) {
    const parts = q.split(/\s+/).filter(Boolean);
    const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    const first = parts[0] ? cap(parts[0]) : '';
    const lastWanted = parts.slice(1).join(' ').toLowerCase();
    if (first) {
      const snap = await db.collection('users').where('firstName', '>=', first).where('firstName', '<=', `${first}`).limit(60).get();
      snap.docs
        .filter((d) => !lastWanted || s(d.get('lastName')).toLowerCase().startsWith(lastWanted))
        .slice(0, 8)
        .forEach(push);
      if (out.length === 0) {
        const byLast = await db.collection('users').where('lastName', '>=', first).where('lastName', '<=', `${first}`).limit(20).get();
        byLast.docs.slice(0, 8).forEach(push);
      }
    }
  }
  for (const w of out) {
    const asg = await db.collection(`tenants/${tenantId}/assignments`).where('userId', '==', w.userId as string).limit(100).get();
    const now = Date.now();
    let upcoming = 0, recent = 0;
    for (const a of asg.docs) {
      const t = tsToIso(a.get('startTime') ?? a.get('startDate') ?? a.get('shiftDate'));
      const ms = t ? Date.parse(t) : NaN;
      if (Number.isNaN(ms)) continue;
      if (ms >= now) upcoming += 1;
      else if (now - ms < 14 * 86400000) recent += 1;
    }
    w.upcomingAssignments = upcoming;
    w.assignmentsLast14d = recent;
  }
  return { matches: out.slice(0, 8), note: out.length === 0 ? 'No worker matched. Try a different spelling, the phone number, or the email.' : undefined };
}

async function workerStatus(tenantId: string, userId: string): Promise<unknown> {
  const u = await db.collection('users').doc(userId).get();
  if (!u.exists) return { error: 'No such user id' };
  const x = u.data() as Record<string, unknown>;
  const asg = await db.collection(`tenants/${tenantId}/assignments`).where('userId', '==', userId).limit(200).get();
  const rows = asg.docs
    .map((d) => {
      const a = d.data() as Record<string, unknown>;
      const cort = (a.cortConfirmation ?? {}) as Record<string, unknown>;
      return {
        assignmentId: d.id,
        job: s(a.jobTitle) || s(a.title) || s(a.jobOrderName),
        site: s(a.locationName) || s(a.worksiteName) || s(a.companyName),
        start: tsToIso(a.startTime ?? a.startDate ?? a.shiftDate),
        status: s(a.status),
        confirmation: s(cort.state) || 'none',
        checkedInVia: s((cort.checkedInVia as Record<string, unknown> | undefined)?.channel) || null,
        lateCheckinTextedAt: tsToIso(cort.lateCheckinTextedAt),
        noShowDetectedAt: tsToIso(cort.noShowDetectedAt),
        cancelledAt: tsToIso(cort.cancelledAt),
        flexLinked: s(a.assignmentSource) === 'indeed_flex_portal' || Boolean(a.flexJobId),
        jobOrderId: s(a.jobOrderId) || null,
        hrxLink: `https://hrxone.com/assignments/${d.id}`,
      };
    })
    .filter((r) => r.start)
    .sort((a, b) => Date.parse(b.start!) - Date.parse(a.start!));
  const now = Date.now();
  const upcoming = rows.filter((r) => Date.parse(r.start!) >= now - 6 * 3600000).slice(-8).reverse();
  const recent = rows.filter((r) => Date.parse(r.start!) < now - 6 * 3600000).slice(0, 8);
  let sms: unknown[] = [];
  try {
    const logs = await db.collection(`tenants/${tenantId}/messageLogs`).where('userId', '==', userId).orderBy('createdAt', 'desc').limit(6).get();
    sms = logs.docs.map((d) => ({ at: tsToIso(d.get('createdAt')), direction: d.get('direction'), status: d.get('status'), text: s(d.get('contentSent')).slice(0, 160) }));
  } catch {
    sms = [{ note: 'message log unavailable' }];
  }
  let notes: unknown[] = [];
  try {
    const ns = await db.collection('users').doc(userId).collection('notes').orderBy('createdAt', 'desc').limit(6).get();
    notes = ns.docs.map((d) => ({ at: tsToIso(d.get('createdAt')), by: s(d.get('authorName')) || null, note: s(d.get('content')).slice(0, 240) }));
  } catch {
    notes = [];
  }
  const { backgroundSummary } = await import('./natalieFill');
  const backgroundCheck = await backgroundSummary(tenantId, userId);
  return {
    worker: {
      name: `${s(x.firstName)} ${s(x.lastName)}`.trim(),
      phoneLast4: last4(x.phoneE164 || x.phone),
      tier: (x.workerTiers as Record<string, unknown> | undefined)?.global ?? null,
      smsBlocked: x.smsBlockedSystem === true,
      smsBlockedReason: s(x.smsBlockedReason) || null,
      phoneInvalid: x.phoneInvalid === true,
      profileLink: `https://hrxone.com/users/${userId}`,
    },
    backgroundCheck,
    notes,
    upcoming,
    recent,
    recentSms: sms,
  };
}

async function portalSyncStatus(tenantId: string): Promise<unknown> {
  const actions = await db.collection(`tenants/${tenantId}/portal_actions`).orderBy('updatedAt', 'desc').limit(60).get();
  const lastByType: Record<string, unknown> = {};
  const problems: unknown[] = [];
  for (const d of actions.docs) {
    const a = d.data() as Record<string, unknown>;
    const key = `${a.provider}:${a.action}`;
    const status = s(a.status);
    if (status === 'succeeded' && !lastByType[key]) {
      const r = (a.result ?? {}) as Record<string, unknown>;
      lastByType[key] = {
        finishedAt: tsToIso(a.updatedAt),
        summary: Object.fromEntries(Object.entries(r).filter(([k, v]) => typeof v === 'number' || (typeof v === 'string' && k !== 'items')).slice(0, 12)),
      };
    }
    if (['failed', 'needs_human'].includes(status) && problems.length < 6) {
      problems.push({ id: d.id, action: a.action, status, error: s((a.lastError as Record<string, unknown> | undefined)?.message).slice(0, 160), at: tsToIso(a.updatedAt) });
    }
  }
  const pending = actions.docs.filter((d) => ['pending', 'claimed', 'running'].includes(s(d.get('status')))).map((d) => ({ id: d.id, status: d.get('status'), action: d.get('action') }));
  const workers = await db.collection(`tenants/${tenantId}/portal_workers`).get();
  const heartbeats = workers.docs.map((d) => {
    const w = d.data() as Record<string, unknown>;
    const hb = tsToIso(w.lastHeartbeatAt);
    return { worker: d.id, status: w.status, lastHeartbeatAt: hb, minutesAgo: hb ? Math.round((Date.now() - Date.parse(hb)) / 60000) : null, busyWith: w.busyWith ?? null };
  });
  return { lastSuccessfulByType: lastByType, inFlight: pending, problems, portalWorkers: heartbeats, now: new Date().toISOString() };
}

async function requestPortalSync(ctx: NatalieToolContext, input: { provider: 'fieldglass' | 'indeed_flex'; postingIds?: string[]; flexJobIds?: string[] }): Promise<unknown> {
  const reason = `slack:${ctx.askedByName || ctx.askedBySlackUserId}`;
  const res =
    input.provider === 'fieldglass'
      ? await enqueuePortalAction(db, {
          tenantId: ctx.tenantId,
          action: 'fieldglass_sync',
          payload: { ...(input.postingIds?.length ? { postingIds: input.postingIds } : {}), force: true, reason },
          createdBy: { kind: 'system', id: `natalie-slack:${ctx.askedBySlackUserId}` },
          priority: 15,
          force: true,
        })
      : await enqueuePortalAction(db, {
          tenantId: ctx.tenantId,
          action: 'indeed_flex_sync',
          payload: { ...(input.flexJobIds?.length ? { flexJobIds: input.flexJobIds } : {}), force: true, reason },
          createdBy: { kind: 'system', id: `natalie-slack:${ctx.askedBySlackUserId}` },
          priority: 15,
          force: true,
        });
  const label = input.provider === 'fieldglass' ? 'Fieldglass' : 'Indeed Flex';
  const target = input.postingIds?.length ? ` for ${input.postingIds.join(', ')}` : input.flexJobIds?.length ? ` for jobs ${input.flexJobIds.join(', ')}` : '';
  await recordNatalieAction({ tenantId: ctx.tenantId, kind: 'portal_sync', askedBySlackUserId: ctx.askedBySlackUserId, askedByName: ctx.askedByName, slack: ctx.slack, input: input as Record<string, unknown>, result: { actionId: res.id }, summary: `Queued a ${label} sync${target}` });
  if (ctx.slack) await registerFollowup({ tenantId: ctx.tenantId, portalActionId: res.id, slack: ctx.slack, askedByName: ctx.askedByName, description: `${label} sync${target}` });
  return { queued: true, actionId: res.id, created: res.created, status: res.status, note: 'The portal worker picks this up on its next loop (usually within 1–2 minutes); a full pass takes 10–40 minutes. You will post the result in this thread automatically when it finishes — tell the person that.' };
}

async function listFlexRequests(tenantId: string, days: number): Promise<unknown> {
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - Math.max(1, Math.min(days || 3, 30)) * 86400000);
  const snap = await db.collection(`tenants/${tenantId}/external_shift_requests`).where('createdAt', '>=', since).orderBy('createdAt', 'desc').limit(40).get();
  const portalJobs = ((await db.doc(`tenants/${tenantId}/portal_state/indeed_flex_jobs`).get()).get('jobs') ?? {}) as Record<string, { status?: string | null; client?: string | null }>;
  const expiredIds = new Set(snap.docs.map((d) => d.data() as Record<string, unknown>).filter((r) => r.eventType === 'info_notice' && s((r.event as Record<string, unknown>)?.noticeKind) === 'booking_expired').map((r) => s((r.event as Record<string, unknown>)?.jobId)));
  return snap.docs.map((d) => {
    const r = d.data() as Record<string, unknown>;
    const ev = (r.event ?? {}) as Record<string, unknown>;
    const pa = (r.portalAccept ?? {}) as Record<string, unknown>;
    const createdMs = Date.parse(tsToIso(r.createdAt) ?? '') || Date.now();
    const accepted = Boolean(pa.actionId) && pa.dryRun !== true;
    const expired = r.eventType === 'new_request' && (expiredIds.has(s(ev.jobId)) || (!accepted && Date.now() - createdMs > 5 * 3600_000));
    return {
      receivedAt: tsToIso(r.createdAt),
      /** Flex revokes unbooked headcount ~4h after posting. expired=true means the request is gone (confirmed by Flex's expiry email, or unaccepted for 5h+). */
      expired,
      bookByEstimate: r.eventType === 'new_request' ? new Date(createdMs + 4 * 3600_000).toISOString() : null,
      type: r.eventType,
      flexJobId: s(ev.jobId) || null,
      venue: s(ev.venueName) || null,
      role: s(ev.roleName) || null,
      date: s(ev.workDate) || null,
      time: ev.startTime && ev.endTime ? `${ev.startTime}-${ev.endTime}` : null,
      headcount: ev.headcount ?? null,
      summary: s(ev.summary) || null,
      hrxStatus: r.status,
      match: r.matchConfidence,
      account: s(r.matchedAccountName) || null,
      acceptedInPortal: pa.actionId ? { actionId: pa.actionId, dryRun: pa.dryRun === true, queuedAt: pa.enqueuedAt } : null,
      /** Status on the Flex jobs list at the last sync: New = still waiting for a Respond; In Progress = accepted (by anyone); Completed = over — for a future date that means Flex revoked the unbooked headcount at the deadline and only the booked workers remain. */
      portalStatus: portalJobs[s(ev.jobId)]?.status ?? null,
    };
  });
}

async function acceptFlexRequest(ctx: NatalieToolContext, input: { flexJobId: string; headcount?: number }): Promise<unknown> {
  const flexJobId = s(input.flexJobId).replace(/\D/g, '');
  if (!flexJobId) return { error: 'flexJobId must be numeric' };
  const res = await enqueuePortalAction(db, {
    tenantId: ctx.tenantId,
    action: 'accept_job_request',
    payload: { flexJobId, ...(input.headcount ? { acceptHeadcount: Math.floor(input.headcount) } : {}), reason: `slack:${ctx.askedByName || ctx.askedBySlackUserId}` },
    createdBy: { kind: 'user', id: `slack:${ctx.askedBySlackUserId}` },
    priority: 10,
    maxAttempts: 2,
    force: true,
  });
  await recordNatalieAction({ tenantId: ctx.tenantId, kind: 'flex_accept', askedBySlackUserId: ctx.askedBySlackUserId, askedByName: ctx.askedByName, slack: ctx.slack, input: { flexJobId, headcount: input.headcount ?? null }, result: { actionId: res.id }, summary: `Queued portal accept of Indeed Flex request ${flexJobId}` });
  if (ctx.slack) await registerFollowup({ tenantId: ctx.tenantId, portalActionId: res.id, slack: ctx.slack, askedByName: ctx.askedByName, description: `accept Flex request ${flexJobId}` });
  return { queued: true, actionId: res.id, existingStatus: res.existingStatus ?? null, note: 'The portal worker will open the request and click Confirm within a few minutes, then pull the job into HRX. You will post the outcome in this thread automatically; if the request already expired or was accepted, that gets reported instead.' };
}

async function jobOrderFillStatus(tenantId: string, query: string): Promise<unknown> {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const jos = await db.collection(`tenants/${tenantId}/job_orders`).where('status', '==', 'open').limit(150).get();
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const out: unknown[] = [];
  for (const d of jos.docs) {
    const j = d.data() as Record<string, unknown>;
    const hay = `${s(j.jobTitle)} ${s(j.title)} ${s(j.accountName)} ${s(j.companyName)} ${s(j.locationName)} ${s(j.worksiteName)}`.toLowerCase();
    if (words.length && !words.every((w) => hay.includes(w))) continue;
    const shifts = await d.ref.collection('shifts').where('shiftDate', '>=', today).where('shiftDate', '<=', horizon).limit(40).get().catch(() => null);
    const shiftRows = shifts
      ? shifts.docs.map((sh) => {
          const x = sh.data() as Record<string, unknown>;
          const sched = (x.dateSchedule ?? {}) as Record<string, Record<string, unknown>>;
          const needed = Object.values(sched).reduce((n, v) => n + (Number(v.workersNeeded) || 0), 0) || Number(x.workersNeeded) || null;
          return { shiftId: sh.id, date: s(x.shiftDate), title: s(x.defaultJobTitle) || s(x.title), time: x.defaultStartTime && x.defaultEndTime ? `${x.defaultStartTime}-${x.defaultEndTime}` : null, workersNeeded: needed, poNumber: s(x.poNumber) || null };
        })
      : [];
    if (words.length === 0 && shiftRows.length === 0) continue;
    const asg = await db.collection(`tenants/${tenantId}/assignments`).where('jobOrderId', '==', d.id).limit(300).get().catch(() => null);
    let assignedUpcoming = 0;
    if (asg) for (const a of asg.docs) {
      const t = tsToIso(a.get('startTime') ?? a.get('startDate') ?? a.get('shiftDate'));
      if (t && t.slice(0, 10) >= today && !['cancelled', 'canceled', 'declined'].includes(s(a.get('status')))) assignedUpcoming += 1;
    }
    out.push({
      jobOrderId: d.id,
      title: s(j.jobTitle) || s(j.title),
      account: s(j.accountName) || s(j.companyName),
      site: s(j.locationName) || s(j.worksiteName) || null,
      jobType: s(j.jobType) || null,
      upcomingShifts: shiftRows,
      workersAssignedUpcoming: assignedUpcoming,
      link: `https://hrxone.com/jobs/job-orders/${d.id}`,
    });
    if (out.length >= 8) break;
  }
  return { orders: out, note: out.length === 0 ? 'No open job order matched.' : undefined };
}

async function sendWorkerSms(ctx: NatalieToolContext, input: { userId: string; text: string }): Promise<unknown> {
  const u = await db.collection('users').doc(input.userId).get();
  if (!u.exists) return { error: 'No such user id' };
  const phone = s(u.get('phoneE164')) || (s(u.get('phone')).replace(/\D/g, '').length === 10 ? `+1${s(u.get('phone')).replace(/\D/g, '')}` : '');
  if (!phone) return { error: 'Worker has no usable phone number on file' };
  const { sendWorkerMessageInternal } = await import('../twilio');
  const body = /natalie/i.test(input.text) ? input.text : `${input.text.trim()} — Natalie, C1 Staffing`;
  const r = await sendWorkerMessageInternal(phone, body, {
    tenantId: ctx.tenantId,
    userId: input.userId,
    source: 'system',
    messageTypeId: 'natalie_slack_request',
    systemContext: true,
  } as never);
  await recordNatalieAction({
    tenantId: ctx.tenantId, kind: 'worker_sms', askedBySlackUserId: ctx.askedBySlackUserId, askedByName: ctx.askedByName, slack: ctx.slack,
    input: { text: body }, result: { success: r.success, status: r.status, errorCode: r.errorCode ?? null },
    summary: r.success ? `Texted the worker: "${input.text.trim().slice(0, 120)}"` : `Tried to text the worker but it failed (${r.errorCode ?? r.error ?? 'unknown'})`,
    userId: input.userId,
  });
  return { sent: r.success, status: r.status, error: r.error ?? null, errorCode: r.errorCode ?? null, to: `…${last4(phone)}` };
}

async function addWorkerNote(ctx: NatalieToolContext, input: { userId: string; note: string }): Promise<unknown> {
  const u = await db.collection('users').doc(input.userId).get();
  if (!u.exists) return { error: 'No such user id' };
  const content = input.note.trim();
  if (!content) return { error: 'Empty note' };
  const ref = await db.collection('users').doc(input.userId).collection('notes').add({
    content: `${content} — via ${ctx.askedByName || 'Slack'}`,
    authorId: NATALIE_HRX_UID,
    authorName: NATALIE_DISPLAY_NAME,
    source: 'natalie_slack',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await recordNatalieAction({ tenantId: ctx.tenantId, kind: 'worker_note', askedBySlackUserId: ctx.askedBySlackUserId, askedByName: ctx.askedByName, slack: ctx.slack, input: { note: content }, result: { noteId: ref.id }, summary: `Added a note: "${content.slice(0, 120)}"`, userId: input.userId });
  return { saved: true, noteId: ref.id, profileLink: `https://hrxone.com/users/${input.userId}` };
}

export interface WorkerReliability {
  userId: string;
  name: string;
  tier: unknown;
  completed: number;
  noShows: number;
  cancels: number;
  upcoming: number;
  lastWorked: string | null;
  matchedQuery: number;
  score: number;
  reasons: string[];
}

/** Pure scoring so it can be unit-tested. */
export function scoreReliability(w: Omit<WorkerReliability, 'score' | 'reasons'>): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 50;
  score += Math.min(w.completed, 20) * 2;
  if (w.completed >= 10) reasons.push(`${w.completed} completed shifts in 90 days`);
  else if (w.completed > 0) reasons.push(`${w.completed} completed shift${w.completed === 1 ? '' : 's'} recently`);
  else reasons.push('no completed shifts in the last 90 days');
  score -= w.noShows * 25;
  if (w.noShows) reasons.push(`${w.noShows} no-show${w.noShows === 1 ? '' : 's'}`);
  score -= w.cancels * 8;
  if (w.cancels) reasons.push(`${w.cancels} late cancel${w.cancels === 1 ? '' : 's'}`);
  const tier = Number(w.tier);
  if (tier === 1) { score += 10; reasons.push('Tier 1'); }
  else if (tier === 3) { score -= 10; reasons.push('Tier 3'); }
  if (w.matchedQuery) { score += 8; reasons.push(`worked there ${w.matchedQuery}×`); }
  if (w.noShows === 0 && w.completed >= 5) reasons.push('no no-shows');
  return { score, reasons };
}

async function rankWorkers(tenantId: string, query: string, limit: number): Promise<unknown> {
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - 90 * 86400000);
  const snap = await db.collection(`tenants/${tenantId}/assignments`).where('startTime', '>=', since).limit(4000).get();
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const agg = new Map<string, Omit<WorkerReliability, 'score' | 'reasons' | 'name' | 'tier'>>();
  const now = Date.now();
  for (const d of snap.docs) {
    const a = d.data() as Record<string, unknown>;
    const uid = s(a.userId) || s(a.candidateId);
    if (!uid) continue;
    const row = agg.get(uid) ?? { userId: uid, completed: 0, noShows: 0, cancels: 0, upcoming: 0, lastWorked: null as string | null, matchedQuery: 0 };
    const cort = (a.cortConfirmation ?? {}) as Record<string, unknown>;
    const status = s(a.status).toLowerCase();
    const start = tsToIso(a.startTime);
    const past = start ? Date.parse(start) < now : false;
    if (!past) row.upcoming += 1;
    else if (cort.state === 'no_show' || status === 'no_show') row.noShows += 1;
    else if (cort.state === 'cancelled' || ['cancelled', 'canceled', 'worker_cancelled', 'worker-cancelled'].includes(status)) row.cancels += 1;
    else if (['completed', 'checked_in'].includes(String(cort.state)) || ['completed', 'active', 'confirmed', 'in_progress'].includes(status)) {
      row.completed += 1;
      if (start && (!row.lastWorked || start > row.lastWorked)) row.lastWorked = start;
    }
    if (words.length) {
      const hay = `${s(a.jobTitle)} ${s(a.title)} ${s(a.jobOrderName)} ${s(a.locationName)} ${s(a.worksiteName)} ${s(a.companyName)}`.toLowerCase();
      if (words.every((w) => hay.includes(w))) row.matchedQuery += 1;
    }
    agg.set(uid, row);
  }
  let rows = [...agg.values()];
  if (words.length) rows = rows.filter((r) => r.matchedQuery > 0);
  rows = rows.filter((r) => r.completed + r.noShows + r.cancels > 0);
  const out: WorkerReliability[] = [];
  for (const r of rows) {
    const u = await db.collection('users').doc(r.userId).get();
    const x = (u.data() ?? {}) as Record<string, unknown>;
    if (x.smsBlockedSystem === true || x.phoneInvalid === true) continue;
    const base = { ...r, name: `${s(x.firstName)} ${s(x.lastName)}`.trim() || r.userId, tier: (x.workerTiers as Record<string, unknown> | undefined)?.global ?? null };
    const { score, reasons } = scoreReliability(base);
    out.push({ ...base, score, reasons });
  }
  out.sort((a, b) => b.score - a.score);
  const top = out.slice(0, Math.max(1, Math.min(limit || 10, 25)));
  for (const w of top) {
    try {
      const ns = await db.collection('users').doc(w.userId).collection('notes').orderBy('createdAt', 'desc').limit(2).get();
      const notes = ns.docs.map((d) => s(d.get('content')).slice(0, 120)).filter(Boolean);
      if (notes.length) w.reasons.push(`notes: ${notes.join(' | ')}`);
    } catch {
      /* ignore */
    }
  }
  return { ranked: top.map((w) => ({ ...w, profileLink: `https://hrxone.com/users/${w.userId}` })), consideredWorkers: rows.length, window: '90 days', note: top.length === 0 ? 'Nobody matched — try a broader query.' : undefined };
}

async function createTask(ctx: NatalieToolContext, input: { title: string; assigneeName: string; dueDate: string; details?: string; userId?: string; priority?: string }): Promise<unknown> {
  const want = s(input.assigneeName).toLowerCase();
  let assigneeId: string | null = null;
  let assigneeLabel = '';
  const staff = await db.collection('users').where(`tenantIds.${ctx.tenantId}.status`, '==', 'active').limit(400).get();
  const candidates = staff.docs
    .map((d) => ({ id: d.id, x: d.data() as Record<string, unknown> }))
    .filter(({ x }) => Number((x.tenantIds as Record<string, Record<string, unknown>>)?.[ctx.tenantId]?.securityLevel ?? x.securityLevel ?? 0) >= 5);
  if (want === 'me' || want === 'myself' || !want) {
    const me = await db.collection(`tenants/${ctx.tenantId}/slackUsers`).doc(ctx.askedBySlackUserId).get();
    assigneeId = s(me.get('hrxUserId')) || null;
    if (!assigneeId) {
      const byName = candidates.find(({ x }) => `${s(x.firstName)} ${s(x.lastName)}`.toLowerCase().startsWith(ctx.askedByName.toLowerCase()));
      assigneeId = byName?.id ?? null;
    }
    assigneeLabel = ctx.askedByName;
  } else {
    const hit =
      candidates.find(({ x }) => s(x.firstName).toLowerCase() === want || `${s(x.firstName)} ${s(x.lastName)}`.toLowerCase() === want) ??
      candidates.find(({ x }) => s(x.firstName).toLowerCase().startsWith(want));
    assigneeId = hit?.id ?? null;
    assigneeLabel = hit ? `${s(hit.x.firstName)} ${s(hit.x.lastName)}`.trim() : input.assigneeName;
  }
  if (!assigneeId) return { error: `Could not find a staff member named "${input.assigneeName}". Staff known: ${candidates.map(({ x }) => s(x.firstName)).filter(Boolean).slice(0, 12).join(', ')}` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) return { error: 'dueDate must be YYYY-MM-DD' };
  const now = admin.firestore.FieldValue.serverTimestamp();
  const ref = await db.collection(`tenants/${ctx.tenantId}/tasks`).add({
    tenantId: ctx.tenantId,
    title: input.title.trim().slice(0, 140),
    description: `${s(input.details) || input.title.trim()}\n\nCreated by Natalie from Slack (asked by ${ctx.askedByName}).`,
    type: /call|phone/i.test(input.title) ? 'phone_call' : /email/i.test(input.title) ? 'email' : 'follow_up',
    category: 'follow_up',
    priority: ['low', 'medium', 'high', 'urgent'].includes(s(input.priority)) ? input.priority : 'medium',
    status: 'upcoming',
    scheduledDate: input.dueDate,
    dueDate: input.dueDate,
    assignedTo: assigneeId,
    createdBy: NATALIE_HRX_UID,
    createdByName: NATALIE_DISPLAY_NAME,
    associations: { contacts: [], deals: [], companies: [], ...(input.userId ? { workers: [input.userId] } : {}) },
    aiGenerated: true,
    aiReason: `Requested in Slack by ${ctx.askedByName}`,
    source: 'natalie_slack',
    createdAt: now,
    updatedAt: now,
  });
  await recordNatalieAction({ tenantId: ctx.tenantId, kind: 'task', askedBySlackUserId: ctx.askedBySlackUserId, askedByName: ctx.askedByName, slack: ctx.slack, input: input as Record<string, unknown>, result: { taskId: ref.id, assigneeId }, summary: `Created a task for ${assigneeLabel}: "${input.title.trim().slice(0, 100)}" due ${input.dueDate}`, userId: input.userId ?? null });
  return { created: true, taskId: ref.id, assignedTo: assigneeLabel, dueDate: input.dueDate, link: 'https://hrxone.com/tasks' };
}

export async function runNatalieTool(name: string, input: Record<string, unknown>, ctx: NatalieToolContext): Promise<unknown> {
  switch (name) {
    case 'find_worker':
      return findWorker(ctx.tenantId, s(input.query));
    case 'worker_status':
      return workerStatus(ctx.tenantId, s(input.userId));
    case 'portal_sync_status':
      return portalSyncStatus(ctx.tenantId);
    case 'request_portal_sync':
      return requestPortalSync(ctx, input as { provider: 'fieldglass' | 'indeed_flex'; postingIds?: string[]; flexJobIds?: string[] });
    case 'list_flex_requests':
      return listFlexRequests(ctx.tenantId, Number(input.days) || 3);
    case 'accept_flex_request':
      return acceptFlexRequest(ctx, input as { flexJobId: string; headcount?: number });
    case 'job_order_fill_status':
      return jobOrderFillStatus(ctx.tenantId, s(input.query));
    case 'send_worker_sms':
      return sendWorkerSms(ctx, input as { userId: string; text: string });
    case 'candidates_for_job_order': {
      const jobOrderId = s(input.jobOrderId);
      const [cands, shifts] = await Promise.all([candidatesForJobOrder(ctx.tenantId, jobOrderId, { radiusMiles: Number(input.radiusMiles) || 15, limit: Number(input.limit) || 12 }), upcomingShifts(ctx.tenantId, jobOrderId, 10)]);
      return { ...cands, upcomingShifts: shifts };
    }
    case 'order_background_check': {
      const { orderBackgroundCheck } = await import('./natalieFill');
      return orderBackgroundCheck({ tenantId: ctx.tenantId, userId: s(input.userId), jobOrderId: s(input.jobOrderId) || null, packageId: s(input.packageId) || undefined, slack: ctx.slack, askedByName: ctx.askedByName, askedBySlackUserId: ctx.askedBySlackUserId });
    }
    case 'schedule_blast': {
      const { scheduleAction } = await import('./natalieFill');
      const radius = [15, 30, 60].includes(Number(input.radiusMiles)) ? Number(input.radiusMiles) : 15;
      return scheduleAction({ tenantId: ctx.tenantId, kind: 'worker_reach_blast', runAt: new Date(s(input.runAt)), params: { jobOrderId: s(input.jobOrderId), radiusMiles: radius }, slack: ctx.slack, askedByName: ctx.askedByName, askedBySlackUserId: ctx.askedBySlackUserId });
    }
    case 'offer_shift':
      return offerShiftToWorker({ tenantId: ctx.tenantId, userId: s(input.userId), jobOrderId: s(input.jobOrderId), shiftId: s(input.shiftId), extra: s(input.extra) || undefined, askedBySlackUserId: ctx.askedBySlackUserId, askedByName: ctx.askedByName, slack: ctx.slack });
    case 'place_worker': {
      const r = await placeWorkerOnShift(ctx.tenantId, s(input.jobOrderId), s(input.shiftId), s(input.userId), { source: 'natalie_slack_place', note: `Placed by Natalie (asked by ${ctx.askedByName} in Slack)` });
      await recordNatalieAction({ tenantId: ctx.tenantId, kind: 'place_worker', askedBySlackUserId: ctx.askedBySlackUserId, askedByName: ctx.askedByName, slack: ctx.slack, input: { jobOrderId: s(input.jobOrderId), shiftId: s(input.shiftId) }, result: r as Record<string, unknown>, summary: r.placed ? 'Placed the worker on the shift' : `Could not place the worker (${r.error ?? (r.already ? 'already on it' : 'unknown')})`, userId: s(input.userId), jobOrderId: s(input.jobOrderId), assignmentId: r.assignmentId || null });
      const flex = r.placed ? await bookInFlexIfLinked(ctx.tenantId, s(input.jobOrderId), s(input.shiftId), s(input.userId), { slack: ctx.slack, askedByName: ctx.askedByName, askedBySlackUserId: ctx.askedBySlackUserId }) : { queued: false, reason: 'not placed' };
      return { ...r, hrxLink: r.assignmentId ? `https://hrxone.com/assignments/${r.assignmentId}` : null, flexBooking: flex };
    }
    case 'book_in_flex':
      return bookInFlexIfLinked(ctx.tenantId, s(input.jobOrderId), s(input.shiftId), s(input.userId), { slack: ctx.slack, askedByName: ctx.askedByName, askedBySlackUserId: ctx.askedBySlackUserId });
    case 'worker_reach_blast':
      return workerReachBlast({ tenantId: ctx.tenantId, jobOrderId: s(input.jobOrderId), radiusMiles: Number(input.radiusMiles) || 30, message: s(input.message) || undefined, askedBySlackUserId: ctx.askedBySlackUserId, askedByName: ctx.askedByName, slack: ctx.slack });
    case 'read_inbox': {
      const r = await readInbox(ctx.tenantId, { query: s(input.query) || undefined, max: Number(input.max) || 15 });
      return r.connected ? r : { error: "Natalie's mailbox is not connected to HRX yet — Greg needs to run the one-time Google consent for n.brooks@." };
    }
    case 'send_email': {
      const r = await sendEmail(ctx.tenantId, input as { to: string; subject: string; body: string; threadId?: string; inReplyToMessageId?: string });
      await recordNatalieAction({ tenantId: ctx.tenantId, kind: 'email', askedBySlackUserId: ctx.askedBySlackUserId, askedByName: ctx.askedByName, slack: ctx.slack, input: { to: s(input.to), subject: s(input.subject) }, result: r as Record<string, unknown>, summary: r.sent ? `Emailed ${s(input.to)}: "${s(input.subject).slice(0, 80)}"` : `Tried to email ${s(input.to)} but it failed (${r.error})` });
      return r;
    }
    case 'add_worker_note':
      return addWorkerNote(ctx, input as { userId: string; note: string });
    case 'rank_workers':
      return rankWorkers(ctx.tenantId, s(input.query), Number(input.limit) || 10);
    case 'create_task':
      return createTask(ctx, input as { title: string; assigneeName: string; dueDate: string; details?: string; userId?: string; priority?: string });
    default:
      return { error: `unknown tool ${name}` };
  }
}
