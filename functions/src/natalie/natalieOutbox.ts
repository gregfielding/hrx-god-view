/**
 * Natalie's outbox — drained by the inbox tick every minute with her token:
 *   1. follow-ups: portal actions she queued from Slack → outcome posted in-thread
 *   2. escalations: recruiter DMs (no-show / unreachable worker)
 *   3. relays: a worker's SMS reply posted into the escalation / ask thread
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { postAsNatalie } from '../messaging/slackAsNatalie';
import { recordNatalieAction } from './natalieAudit';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const RECRUITING_CHANNEL = 'C0BF02MEKUP';
const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const tsToDate = (v: unknown): Date | null => (v && typeof (v as { toDate?: () => Date }).toDate === 'function' ? (v as { toDate: () => Date }).toDate() : typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);

async function slackGet<T>(token: string, method: string, params: Record<string, string>): Promise<T & { ok: boolean; error?: string }> {
  const res = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params).toString()}`, { headers: { authorization: `Bearer ${token}` } });
  return (await res.json()) as T & { ok: boolean; error?: string };
}

/** Pure: summarize a finished portal action for a human. */
export function summarizePortalOutcome(action: Record<string, unknown>): string {
  const status = s(action.status);
  const kind = s(action.action);
  const r = (action.result ?? {}) as Record<string, unknown>;
  const err = (action.lastError ?? {}) as Record<string, unknown>;
  if (status === 'succeeded') {
    if (kind === 'accept_job_request') {
      if (r.alreadyAccepted) return `Flex request ${r.jobId} was already accepted in the portal — nothing to do.`;
      if (r.dryRun) return `Rehearsed the accept for Flex request ${r.jobId} (dry run, no Confirm click).`;
      return `Accepted Flex request ${r.jobId} in the portal${r.verified ? ' and confirmed it shows In Progress' : ''}. HRX is pulling the job in now.`;
    }
    if (kind === 'fieldglass_sync') {
      return `Fieldglass sync done: ${r.postingsVisited ?? r.postingsListed ?? '?'} postings checked, ${r.ingested ?? r.updated ?? 0} updated, ${r.closed ?? 0} closed${r.failures ? `, ${r.failures} failed` : ''}.`;
    }
    if (kind === 'indeed_flex_sync') {
      return `Flex sync done: ${r.jobsListed ?? 0} jobs listed, ${r.rostersIngested ?? 0} rosters updated, ${r.timesheetRows ?? 0} timesheet rows${r.timesheetAttention ? ` (${r.timesheetAttention} need attention)` : ''}.`;
    }
    return `${kind} finished.`;
  }
  const msg = s(err.message).slice(0, 200);
  if (status === 'needs_human') return `${kind} needs a person: ${msg || 'the portal worker could not finish it'}.`;
  if (status === 'failed') return `${kind} failed: ${msg || 'unknown error'}.`;
  if (status === 'cancelled') return `${kind} was cancelled.`;
  return `${kind} is ${status}.`;
}

async function drainFollowups(token: string): Promise<number> {
  const snap = await db.collection('natalie_followups').where('status', '==', 'pending').limit(20).get();
  let posted = 0;
  for (const d of snap.docs) {
    const f = d.data() as Record<string, unknown>;
    const exp = tsToDate(f.expiresAt);
    const act = await db.doc(`tenants/${f.tenantId}/portal_actions/${f.portalActionId}`).get();
    const status = s(act.get('status'));
    const terminal = ['succeeded', 'failed', 'needs_human', 'cancelled'].includes(status);
    if (!terminal) {
      if (exp && exp.getTime() < Date.now()) await d.ref.update({ status: 'expired', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      continue;
    }
    const slack = (f.slack ?? {}) as { channel?: string; ts?: string; threadTs?: string };
    const text = summarizePortalOutcome(act.data() as Record<string, unknown>);
    const res = slack.channel ? await postAsNatalie(token, { channel: slack.channel, text, threadTs: slack.threadTs || slack.ts }) : { ok: false, error: 'no channel' };
    await d.ref.update({ status: res.ok ? 'posted' : 'failed', outcomeStatus: status, text, postedTs: res.ts ?? null, lastError: res.error ?? null, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    if (res.ok) posted += 1;
  }
  return posted;
}

async function slackUserForHrxUser(tenantId: string, uid: string): Promise<string | null> {
  try {
    const q = await db.collection(`tenants/${tenantId}/slackUsers`).where('hrxUserId', '==', uid).limit(1).get();
    if (!q.empty) return q.docs[0].id;
    const u = await db.collection('users').doc(uid).get();
    return s(u.get('slackUserId')) || null;
  } catch {
    return null;
  }
}

function fmtWhen(v: unknown): string {
  const d = tsToDate(v);
  return d ? d.toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit' }) + ' CT' : 'today';
}

async function drainEscalations(token: string): Promise<number> {
  const snap = await db.collection('natalie_escalations').where('status', '==', 'pending').limit(10).get();
  let posted = 0;
  for (const d of snap.docs) {
    const e = d.data() as Record<string, unknown>;
    const tenantId = s(e.tenantId);
    let recruiters: string[] = [];
    if (e.jobOrderId) {
      const jo = await db.doc(`tenants/${tenantId}/job_orders/${e.jobOrderId}`).get();
      const modern = (jo.get('assignedRecruiters') as unknown[] | undefined)?.filter((x): x is string => typeof x === 'string') ?? [];
      recruiters = modern.length ? modern : s(jo.get('recruiterId')) ? [s(jo.get('recruiterId'))] : [];
    }
    let phone = '';
    if (e.userId) {
      const u = await db.collection('users').doc(s(e.userId)).get();
      phone = s(u.get('phoneE164')) || s(u.get('phone'));
    }
    const who = s(e.workerName) || 'The worker';
    const lead =
      e.kind === 'no_show'
        ? `${who} hasn't checked in for ${s(e.jobTitle) || 'their shift'}${e.site ? ` at ${e.site}` : ''} (${fmtWhen(e.startTime)}) and didn't answer my text.`
        : e.kind === 'cancelled'
          ? `${who} just cancelled ${s(e.jobTitle) || 'their shift'}${e.site ? ` at ${e.site}` : ''} (${fmtWhen(e.startTime)}) by text.`
          : `${who} isn't responding about ${s(e.jobTitle) || 'their shift'}${e.site ? ` at ${e.site}` : ''} (${fmtWhen(e.startTime)}).`;
    const text = `${lead}${e.detail ? ` ${e.detail}` : ''}\n• Phone: ${phone || 'none on file'}\n• <https://hrxone.com/assignments/${e.assignmentId}|Open in HRX>${e.userId ? ` · <https://hrxone.com/users/${e.userId}|Profile>` : ''}\nI've asked the client whether they want a replacement where that applies. Want me to text anyone else?`;

    const dmIds: string[] = [];
    for (const uid of recruiters) {
      const su = await slackUserForHrxUser(tenantId, uid);
      if (su) dmIds.push(su);
    }
    const sent: Array<{ channel: string; ts?: string }> = [];
    for (const su of dmIds) {
      const open = await slackGet<{ channel?: { id: string } }>(token, 'conversations.open', { users: su });
      if (!open.ok || !open.channel?.id) continue;
      const r = await postAsNatalie(token, { channel: open.channel.id, text });
      if (r.ok) sent.push({ channel: open.channel.id, ts: r.ts });
    }
    if (sent.length === 0) {
      // No mapped recruiter: post to #recruiting so a human still sees it.
      const r = await postAsNatalie(token, { channel: RECRUITING_CHANNEL, text: `(No recruiter is mapped to this order in Slack, so posting here.) ${text}` });
      if (r.ok) sent.push({ channel: RECRUITING_CHANNEL, ts: r.ts });
    }
    await d.ref.update({ status: sent.length ? 'posted' : 'failed', sent, recruiters, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    if (sent.length) {
      posted += 1;
      await db.doc(`tenants/${tenantId}/assignments/${e.assignmentId}`).set({ natalieEscalation: { ...sent[0], kind: e.kind, at: new Date().toISOString() } }, { merge: true }).catch(() => undefined);
      await recordNatalieAction({ tenantId, kind: 'escalation', summary: `Escalated ${e.kind} for ${who} to ${recruiters.length ? 'the assigned recruiter' : '#recruiting'}`, userId: s(e.userId) || null, assignmentId: s(e.assignmentId), jobOrderId: s(e.jobOrderId) || null, slack: sent[0] });
    }
  }
  return posted;
}

async function drainRelays(token: string): Promise<number> {
  const snap = await db.collection('natalie_relays').where('status', '==', 'pending').limit(20).get();
  let posted = 0;
  for (const d of snap.docs) {
    const r = d.data() as Record<string, unknown>;
    const targets = (r.targets ?? []) as Array<{ channel: string; ts?: string }>;
    const who = s(r.workerName) || 'The worker';
    const text = `${who} just texted back: "${s(r.text)}"${r.intent && r.intent !== 'none' ? ` (read as: ${r.intent})` : ''}`;
    let ok = false;
    for (const t of targets) {
      const res = await postAsNatalie(token, { channel: t.channel, text, threadTs: t.ts });
      ok = ok || res.ok;
    }
    await d.ref.update({ status: ok ? 'posted' : 'failed', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    if (ok) posted += 1;
  }
  return posted;
}

export async function drainNatalieOutbox(token: string): Promise<{ followups: number; escalations: number; relays: number }> {
  const out = { followups: 0, escalations: 0, relays: 0 };
  try { out.followups = await drainFollowups(token); } catch (e) { logger.warn('[natalie] followup drain failed', { err: String(e) }); }
  try { out.escalations = await drainEscalations(token); } catch (e) { logger.warn('[natalie] escalation drain failed', { err: String(e) }); }
  try { out.relays = await drainRelays(token); } catch (e) { logger.warn('[natalie] relay drain failed', { err: String(e) }); }
  return out;
}
