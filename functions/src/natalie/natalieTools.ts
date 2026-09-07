/**
 * Tools Natalie can use when a recruiter DMs or @mentions her in Slack.
 * Every tool is read-only against Firestore except the two that enqueue
 * portal work (a sync, a Flex accept) and the one that texts a worker —
 * all three are actions a recruiter explicitly asked for in the message.
 */
import * as admin from 'firebase-admin';
import type Anthropic from '@anthropic-ai/sdk';
import { enqueuePortalAction } from '../integrations/portalActions/enqueuePortalAction';

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
      "Everything current about one worker: upcoming and recent assignments (job, site, start, confirmation state, check-in, no-show, cancellation), whether they were texted for a late check-in, and their last few SMS exchanges. Needs the worker's HRX user id from find_worker.",
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
      'Queue a sync now. provider "fieldglass" pulls Sodexo/Fieldglass job postings into HRX job orders; provider "indeed_flex" pulls Flex jobs, rosters and timesheets. Optional postingIds (Fieldglass SDXOJP…) or flexJobIds to target specific ones. Returns the queued action id; the portal worker runs it within a couple of minutes.',
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
  return { queued: true, actionId: res.id, created: res.created, status: res.status, note: 'The portal worker picks this up on its next loop (usually within 1–2 minutes); a full pass takes 10–40 minutes.' };
}

async function listFlexRequests(tenantId: string, days: number): Promise<unknown> {
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - Math.max(1, Math.min(days || 3, 30)) * 86400000);
  const snap = await db.collection(`tenants/${tenantId}/external_shift_requests`).where('createdAt', '>=', since).orderBy('createdAt', 'desc').limit(40).get();
  return snap.docs.map((d) => {
    const r = d.data() as Record<string, unknown>;
    const ev = (r.event ?? {}) as Record<string, unknown>;
    const pa = (r.portalAccept ?? {}) as Record<string, unknown>;
    return {
      receivedAt: tsToIso(r.createdAt),
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
  return { queued: true, actionId: res.id, existingStatus: res.existingStatus ?? null, note: 'The portal worker will open the request and click Confirm within a few minutes, then pull the job into HRX. If the request already expired or was accepted, the action reports that instead.' };
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
  return { sent: r.success, status: r.status, error: r.error ?? null, errorCode: r.errorCode ?? null, to: `…${last4(phone)}` };
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
    default:
      return { error: `unknown tool ${name}` };
  }
}
