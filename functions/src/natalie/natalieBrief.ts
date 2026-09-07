/**
 * Natalie's morning brief (weekdays 7:00 CT) + Monday "what I did last week".
 * Gathers facts from Firestore, has Claude write them up in her voice, posts
 * as her to app_config/natalie.briefChannelId (default #recruiting).
 */
import * as admin from 'firebase-admin';
import Anthropic from '@anthropic-ai/sdk';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { NATALIE_SLACK_USER_TOKEN, postAsNatalie } from '../messaging/slackAsNatalie';
import { recordNatalieAction } from './natalieAudit';
import { C1_TENANT_ID } from './natalieTools';
import { NATALIE_MODEL } from './natalieAgent';
import { readInbox } from './natalieMailbox';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const RECRUITING_CHANNEL = 'C0BF02MEKUP';
const TZ = 'America/Chicago';
const s = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const toDate = (v: unknown): Date | null => (v && typeof (v as { toDate?: () => Date }).toDate === 'function' ? (v as { toDate: () => Date }).toDate() : typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);

function ctDayBounds(offsetDays: number): { start: Date; end: Date; label: string } {
  const now = new Date();
  const ct = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  ct.setHours(0, 0, 0, 0);
  ct.setDate(ct.getDate() + offsetDays);
  const utcOffsetMs = now.getTime() - new Date(now.toLocaleString('en-US', { timeZone: TZ })).getTime();
  const start = new Date(ct.getTime() + utcOffsetMs);
  const end = new Date(start.getTime() + 86400000);
  return { start, end, label: ct.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) };
}

export interface BriefFacts {
  dateLabel: string;
  isMonday: boolean;
  unacceptedFlexRequests: unknown[];
  fieldglassLast24h: unknown;
  todayShifts: { total: number; unconfirmed: unknown[]; flexLinked: number };
  yesterdayLateNoAnswer: unknown[];
  yesterdayNoShows: number;
  portal: unknown;
  emailNeedingReply: unknown[];
  weekly?: Record<string, number>;
}

export async function gatherBriefFacts(tenantId: string): Promise<BriefFacts> {
  const today = ctDayBounds(0);
  const yesterday = ctDayBounds(-1);
  const isMonday = new Date(new Date().toLocaleString('en-US', { timeZone: TZ })).getDay() === 1;

  // Flex requests in the last 36h that nobody accepted.
  const reqs = await db.collection(`tenants/${tenantId}/external_shift_requests`).where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(Date.now() - 36 * 3600_000)).orderBy('createdAt', 'desc').limit(60).get();
  // The portal's own view of each job (published by the Flex sync): a request
  // someone accepted by hand shows In Progress / Completed there.
  const portalJobs = ((await db.doc(`tenants/${tenantId}/portal_state/indeed_flex_jobs`).get()).get('jobs') ?? {}) as Record<string, { status?: string | null }>;
  const unacceptedFlexRequests = reqs.docs
    .map((d) => d.data() as Record<string, unknown>)
    .filter((r) => r.eventType === 'new_request' && r.status === 'needs_review')
    .map((r) => {
      const ev = (r.event ?? {}) as Record<string, unknown>;
      const pa = (r.portalAccept ?? {}) as Record<string, unknown>;
      const portalStatus = portalJobs[String(ev.jobId ?? '')]?.status ?? null;
      return { flexJobId: ev.jobId, venue: ev.venueName, role: ev.roleName, date: ev.workDate, headcount: ev.headcount, match: r.matchConfidence, account: r.matchedAccountName ?? null, acceptQueued: Boolean(pa.actionId) && pa.dryRun !== true, dryRunOnly: pa.dryRun === true, portalStatus };
    })
    .filter((r) => !r.acceptQueued && !(r.portalStatus && /in progress|completed|cancel/i.test(r.portalStatus)));

  // Fieldglass activity in the last 24h from succeeded syncs.
  const acts = await db.collection(`tenants/${tenantId}/portal_actions`).where('updatedAt', '>=', admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 3600_000)).limit(120).get();
  const fg = { passes: 0, updated: 0, closed: 0, created: 0, failures: 0, lastAt: null as string | null };
  const flex = { passes: 0, timesheetRows: 0, attention: 0, accepts: 0 };
  const problems: string[] = [];
  for (const d of acts.docs) {
    const a = d.data() as Record<string, unknown>;
    const r = (a.result ?? {}) as Record<string, unknown>;
    if (a.status === 'succeeded' && a.action === 'fieldglass_sync') {
      fg.passes += 1; fg.updated += Number(r.ingested ?? r.updated ?? 0) || 0; fg.closed += Number(r.closed ?? 0) || 0; fg.created += Number(r.created ?? 0) || 0; fg.failures += Number(r.failures ?? 0) || 0;
      const at = toDate(a.updatedAt); if (at && (!fg.lastAt || at.toISOString() > fg.lastAt)) fg.lastAt = at.toISOString();
    }
    if (a.status === 'succeeded' && a.action === 'indeed_flex_sync') { flex.passes += 1; flex.timesheetRows += Number(r.timesheetRows ?? 0) || 0; flex.attention += Number(r.timesheetAttention ?? 0) || 0; }
    if (a.status === 'succeeded' && a.action === 'accept_job_request' && !r.dryRun) flex.accepts += 1;
    if (['failed', 'needs_human'].includes(s(a.status))) problems.push(`${a.action}: ${s((a.lastError as Record<string, unknown> | undefined)?.message).slice(0, 100)}`);
  }

  // Today's shifts and their confirmation state.
  const todayAsg = await db.collection(`tenants/${tenantId}/assignments`).where('startTime', '>=', admin.firestore.Timestamp.fromDate(today.start)).where('startTime', '<', admin.firestore.Timestamp.fromDate(today.end)).limit(500).get();
  const unconfirmed: unknown[] = [];
  let flexLinked = 0;
  for (const d of todayAsg.docs) {
    const a = d.data() as Record<string, unknown>;
    const st = s(a.status).toLowerCase();
    if (['cancelled', 'canceled', 'declined'].includes(st)) continue;
    if (s(a.assignmentSource) === 'indeed_flex_portal' || a.flexJobId) flexLinked += 1;
    const cort = (a.cortConfirmation ?? {}) as Record<string, unknown>;
    if (!['confirmed', 'checked_in'].includes(s(cort.state)) && unconfirmed.length < 25) {
      unconfirmed.push({ worker: `${s(a.workerFirstName) || s(a.firstName)} ${(s(a.workerLastName) || s(a.lastName)).charAt(0)}`.trim() || s(a.workerName) || 'worker', job: s(a.jobTitle) || s(a.title), site: s(a.locationName) || s(a.worksiteName) || s(a.companyName), start: toDate(a.startTime)?.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }), state: s(cort.state) || 'no response', assignmentId: d.id });
    }
  }

  // Yesterday: late check-in texts with no check-in afterwards, and no-shows.
  const yAsg = await db.collection(`tenants/${tenantId}/assignments`).where('startTime', '>=', admin.firestore.Timestamp.fromDate(yesterday.start)).where('startTime', '<', admin.firestore.Timestamp.fromDate(yesterday.end)).limit(500).get();
  const yesterdayLateNoAnswer: unknown[] = [];
  let yesterdayNoShows = 0;
  for (const d of yAsg.docs) {
    const a = d.data() as Record<string, unknown>;
    const cort = (a.cortConfirmation ?? {}) as Record<string, unknown>;
    if (cort.state === 'no_show') yesterdayNoShows += 1;
    if (cort.lateCheckinTextedAt && cort.state !== 'checked_in' && yesterdayLateNoAnswer.length < 15) {
      yesterdayLateNoAnswer.push({ worker: `${s(a.workerFirstName) || s(a.firstName)} ${(s(a.workerLastName) || s(a.lastName)).charAt(0)}`.trim() || s(a.workerName) || 'worker', job: s(a.jobTitle) || s(a.title), site: s(a.locationName) || s(a.companyName), state: s(cort.state) || 'no response', assignmentId: d.id });
    }
  }

  const workers = await db.collection(`tenants/${tenantId}/portal_workers`).get();
  const portal = {
    fieldglass: fg,
    flex,
    problems: problems.slice(0, 5),
    workers: workers.docs.map((d) => { const w = d.data() as Record<string, unknown>; const hb = toDate(w.lastHeartbeatAt); return { id: d.id, status: w.status, minutesSinceHeartbeat: hb ? Math.round((Date.now() - hb.getTime()) / 60000) : null }; }),
  };

  let weekly: Record<string, number> | undefined;
  if (isMonday) {
    const since = admin.firestore.Timestamp.fromMillis(Date.now() - 7 * 86400_000);
    const actions = await db.collection('natalie_actions').where('createdAt', '>=', since).limit(2000).get();
    weekly = {};
    for (const d of actions.docs) { const k = s(d.get('kind')) || 'other'; weekly[k] = (weekly[k] || 0) + 1; }
    const asks = await db.collectionGroup('flex_team_asks').where('status', '==', 'posted').limit(500).get().catch(() => null);
    if (asks) weekly.replacement_asks_posted = asks.docs.filter((d) => (toDate(d.get('postedAt'))?.getTime() ?? 0) >= since.toMillis()).length;
  }

  let emailNeedingReply: unknown[] = [];
  try {
    const inbox = await readInbox(tenantId, { query: 'in:inbox is:unread newer_than:2d', max: 20 });
    emailNeedingReply = inbox.items.filter((i) => !i.automated).slice(0, 8).map((i) => ({ from: i.from, subject: i.subject, preview: i.preview.slice(0, 160) }));
  } catch {
    emailNeedingReply = [];
  }

  return { dateLabel: today.label, isMonday, unacceptedFlexRequests, fieldglassLast24h: fg, todayShifts: { total: todayAsg.size, unconfirmed, flexLinked }, yesterdayLateNoAnswer, yesterdayNoShows, portal, emailNeedingReply, weekly };
}

/** Deterministic fallback if the model is unavailable. */
export function renderBriefFallback(f: BriefFacts): string {
  const lines = [`*Morning brief — ${f.dateLabel}*`];
  lines.push(`• Flex requests waiting on an accept: ${f.unacceptedFlexRequests.length}`);
  const fg = f.fieldglassLast24h as { passes: number; updated: number; closed: number };
  lines.push(`• Fieldglass (24h): ${fg.passes} passes, ${fg.updated} updated, ${fg.closed} closed`);
  lines.push(`• Today: ${f.todayShifts.total} shifts, ${f.todayShifts.unconfirmed.length} unconfirmed`);
  lines.push(`• Yesterday: ${f.yesterdayNoShows} no-shows, ${f.yesterdayLateNoAnswer.length} late-text no-answers`);
  return lines.join('\n');
}

const BRIEF_SYSTEM = `You are Natalie Brooks, C1 Staffing's recruiting assistant, writing the team's morning brief in Slack. You are given facts as JSON. Write a short, scannable brief in Slack mrkdwn (*bold*, "•" bullets, <url|text> links; no headers, no tables). Lead with what needs a human today (unaccepted Flex requests, unconfirmed shifts, yesterday's no-answers), then a one-line portal health note. Name workers by the label given; link ONLY items that carry an assignmentId, as <https://hrxone.com/assignments/{assignmentId}|job>. Flex requests have no HRX link — write their Flex job id in plain text (e.g. 545618) and link the list once as <https://hrxone.com/shifts/log|Flex request log>. Unread emails: sender and subject only. If a list is empty, say so in three words or fewer, don't invent items. Aim for 8–14 lines. On Mondays add a 3–5 line "Last week I…" section from the weekly counts (plain words, no jargon). No sign-off.`;

export async function composeBrief(facts: BriefFacts): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return renderBriefFallback(facts);
  try {
    const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 });
    const res = await client.beta.messages.create({
      model: NATALIE_MODEL,
      max_tokens: 2000,
      system: BRIEF_SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content: `Facts:\n${JSON.stringify(facts).slice(0, 40_000)}` }],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming & { fallbacks: string });
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
    return text || renderBriefFallback(facts);
  } catch (err) {
    logger.warn('[natalie] brief compose failed, using fallback', { err: err instanceof Error ? err.message : String(err) });
    return renderBriefFallback(facts);
  }
}

export async function postMorningBrief(token: string, tenantId = C1_TENANT_ID): Promise<{ ok: boolean; channel: string; ts?: string }> {
  const cfg = await db.doc('app_config/natalie').get();
  if (cfg.get('briefEnabled') === false) return { ok: false, channel: '' };
  const channel = s(cfg.get('briefChannelId')) || RECRUITING_CHANNEL;
  const facts = await gatherBriefFacts(tenantId);
  const text = await composeBrief(facts);
  const res = await postAsNatalie(token, { channel, text });
  await recordNatalieAction({ tenantId, kind: 'brief', summary: `Posted the morning brief${facts.isMonday ? ' with the weekly recap' : ''}`, slack: res.ok ? { channel, ts: res.ts } : undefined, result: { ok: res.ok, error: res.error ?? null, unacceptedFlex: facts.unacceptedFlexRequests.length, unconfirmedToday: facts.todayShifts.unconfirmed.length } });
  return { ok: res.ok, channel, ts: res.ts };
}

export const natalieMorningBrief = onSchedule(
  {
    schedule: '0 7 * * 1-5',
    timeZone: TZ,
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300,
    secrets: [NATALIE_SLACK_USER_TOKEN],
  },
  async () => {
    const token = NATALIE_SLACK_USER_TOKEN.value() || process.env.NATALIE_SLACK_USER_TOKEN;
    if (!token) { logger.warn('[natalie] brief: no token'); return; }
    const r = await postMorningBrief(token);
    logger.info('[natalie] morning brief', r);
  },
);
