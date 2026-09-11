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
import Anthropic from '@anthropic-ai/sdk';
import { NATALIE_MODEL } from './natalieAgent';
import { drainAcceptFills } from './natalieAcceptFill';
import { drainCraigslistDrafts } from './natalieCraigslist';
import { drainThinJobDescriptions } from './natalieDescriptions';
import { PUBLIC_APP_ORIGIN } from '../config/appOrigin';

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

/** Pure: Slack users to DM for an escalation — never Natalie herself. */
export function escalationDmTargets(slackIds: string[], natalieSlackUserId: string): string[] {
  return [...new Set(slackIds.filter((id) => id && id !== natalieSlackUserId))];
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
    const text = `${lead}${e.detail ? ` ${e.detail}` : ''}\n• Phone: ${phone || 'none on file'}\n• <${PUBLIC_APP_ORIGIN}/assignments/${e.assignmentId}|Open in HRX>${e.userId ? ` · <${PUBLIC_APP_ORIGIN}/users/${e.userId}|Profile>` : ''}\nI've asked the client whether they want a replacement where that applies. Want me to text anyone else?`;

    const slackIds: string[] = [];
    for (const uid of recruiters) {
      const su = await slackUserForHrxUser(tenantId, uid);
      if (su) slackIds.push(su);
    }
    // Natalie is the assigned recruiter on some orders (OnTrac, 2026-09-11); a DM to her own Slack
    // user reaches nobody, so she is dropped and a Natalie-only order falls back to #recruiting.
    const { NATALIE_SLACK_USER_ID } = await import('./natalieSlackInbox');
    const dmIds = escalationDmTargets(slackIds, NATALIE_SLACK_USER_ID);
    const natalieOnly = slackIds.length > 0 && dmIds.length === 0;
    const sent: Array<{ channel: string; ts?: string }> = [];
    for (const su of dmIds) {
      const open = await slackGet<{ channel?: { id: string } }>(token, 'conversations.open', { users: su });
      if (!open.ok || !open.channel?.id) continue;
      const r = await postAsNatalie(token, { channel: open.channel.id, text });
      if (r.ok) sent.push({ channel: open.channel.id, ts: r.ts });
    }
    if (sent.length === 0) {
      // No mapped recruiter: post to #recruiting so a human still sees it.
      const why = natalieOnly ? "I'm the only recruiter assigned to this order" : 'No recruiter is mapped to this order in Slack';
      const r = await postAsNatalie(token, { channel: RECRUITING_CHANNEL, text: `(${why}, so posting here.) ${text}` });
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

const DEV_CHANNEL = 'C08U7U0FL03';
const GITHUB_REPO = 'gregfielding/hrx-god-view';

async function github<T>(method: string, path: string, body?: unknown): Promise<T | null> {
  const token = process.env.GITHUB_NATALIE_TOKEN;
  if (!token) return null;
  const res = await fetch(`https://api.github.com${path}`, { method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'hrx-natalie' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) { logger.warn('[natalie] github call failed', { path, status: res.status }); return null; }
  return (await res.json()) as T;
}

/**
 * Worker-reported technical problems (natalie_tech_issues, written by the
 * inbound SMS webhook): gather evidence from HRX, have Claude write a short
 * diagnosis + suggested fix, post it to #dev as Natalie, acknowledge the
 * worker by text, and leave the row 'triaged' for a Claude Code session (or
 * the scheduled routine) to fix and close.
 */
async function drainTechIssues(token: string): Promise<number> {
  const snap = await db.collection('natalie_tech_issues').where('status', '==', 'open').limit(5).get();
  let posted = 0;
  for (const d of snap.docs) {
    const t = d.data() as Record<string, unknown>;
    const tenantId = s(t.tenantId) || 'BCiP2bQ9CgVOCTfV6MhD';
    const uid = s(t.userId);
    const evidence: Record<string, unknown> = { reported: t.text, lastOutbound: t.lastOutbound ?? null };
    if (uid) {
      try {
        const u = (await db.collection('users').doc(uid).get()).data() ?? {};
        evidence.user = { name: `${s(u.firstName)} ${s(u.lastName)}`.trim(), interviewStatus: u.interviewStatus ?? null, createdAt: tsToDate(u.createdAt)?.toISOString() ?? null, lastActiveAt: tsToDate(u.lastActiveAt ?? u.updatedAt)?.toISOString() ?? null, platform: u.lastPlatform ?? u.appVersion ?? null };
        const logs = await db.collection(`tenants/${tenantId}/messageLogs`).where('userId', '==', uid).orderBy('createdAt', 'desc').limit(8).get();
        evidence.recentMessages = logs.docs.map((m) => ({ at: tsToDate(m.get('createdAt'))?.toISOString(), dir: m.get('direction'), type: m.get('messageTypeId'), text: s(m.get('contentSent')).slice(0, 160) }));
        const apps = await db.collection(`tenants/${tenantId}/applications`).where('userId', '==', uid).limit(5).get();
        evidence.applications = apps.docs.map((a) => ({ jobOrderId: a.get('jobOrderId'), status: a.get('status'), prescreenOutcome: a.get('workerAiPrescreenReminderLastOutcome') ?? null, prescreenSentAt: tsToDate(a.get('workerAiPrescreenReminderSentAt'))?.toISOString() ?? null }));
        const ivs = await db.collection('users').doc(uid).collection('interviews').orderBy('createdAt', 'desc').limit(2).get().catch(() => null);
        evidence.interviews = ivs ? ivs.docs.map((i) => ({ at: tsToDate(i.get('createdAt'))?.toISOString(), score: i.get('score10') ?? i.get('score') ?? null, questions: Array.isArray(i.get('questions')) ? (i.get('questions') as unknown[]).length : null })) : [];
      } catch (err) {
        evidence.evidenceError = err instanceof Error ? err.message : String(err);
      }
    }
    let diagnosis = '';
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
        const res = await client.beta.messages.create({
          model: NATALIE_MODEL,
          max_tokens: 800,
          system: 'You are the on-call engineer for HRX, a staffing platform (React web app, Firebase Cloud Functions, Firestore, Twilio SMS). A worker texted a problem. From the evidence JSON, write for #dev in Slack mrkdwn: one line stating the most likely cause (name the feature/function if the evidence points to one, e.g. the worker AI prescreen submit, the jobs-board link, phone login), one line on confidence, and 1–3 bullet next steps for an engineer with a Claude Code session (what to check in the repo or logs). If a known recent fix likely covers it, say so. Under 120 words. No preamble.',
          thinking: { type: 'adaptive' },
          output_config: { effort: 'low' },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          messages: [{ role: 'user', content: JSON.stringify(evidence).slice(0, 12_000) }],
        } as Anthropic.Beta.MessageCreateParamsNonStreaming & { fallbacks: string });
        diagnosis = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
      }
    } catch (err) {
      logger.warn('[natalie] tech issue diagnosis failed', { err: String(err) });
    }
    const who = s(t.workerName) || `…${s(t.phoneE164).slice(-4)}`;
    const text = `:wrench: *Worker-reported problem* — ${who}${uid ? ` (<${PUBLIC_APP_ORIGIN}/users/${uid}|profile>)` : ''} texted: "${s(t.text).slice(0, 300)}"\n${t.lastOutbound ? `Last thing we sent them: ${s((t.lastOutbound as Record<string, unknown>).messageTypeId)} — "${s((t.lastOutbound as Record<string, unknown>).text).slice(0, 140)}"\n` : ''}${diagnosis ? `\n${diagnosis}\n` : ''}\nI've told them we're on it. Reply here when it's fixed and I'll text them (issue \`${d.id}\`).`;
    const res = await postAsNatalie(token, { channel: DEV_CHANNEL, text });
    if (!res.ok) { logger.warn('[natalie] tech issue post failed', { error: res.error }); continue; }
    // Acknowledge the worker by text (once).
    if (uid && s(t.phoneE164)) {
      try {
        const { sendWorkerMessageInternal } = await import('../twilio');
        await sendWorkerMessageInternal(s(t.phoneE164), "Thanks for letting us know — that sounds like a problem on our side. I've flagged it to our tech team and I'll text you as soon as it's fixed. — Natalie, C1 Staffing", { tenantId, userId: uid, source: 'system', messageTypeId: 'natalie_tech_ack', systemContext: true } as never);
      } catch (err) {
        logger.warn('[natalie] tech ack text failed', { err: String(err) });
      }
    }
    // GitHub issue → the scheduled "Natalie tech-issue fixer" routine picks it up.
    let issueNumber: number | null = null;
    const issue = await github<{ number: number; html_url: string }>('POST', `/repos/${GITHUB_REPO}/issues`, {
      title: `Worker-reported: ${s(t.text).slice(0, 70)}`,
      labels: ['natalie-tech'],
      body: `**Reported by** ${who} via SMS on ${new Date().toISOString()}${uid ? ` — HRX user \`${uid}\`` : ''}\n\n> ${s(t.text).slice(0, 500)}\n\n**Last message we sent them:** ${t.lastOutbound ? `${s((t.lastOutbound as Record<string, unknown>).messageTypeId)} — "${s((t.lastOutbound as Record<string, unknown>).text).slice(0, 300)}"` : 'n/a'}\n\n**Initial diagnosis (Natalie):**\n${diagnosis || '_none_'}\n\n**Evidence:**\n\`\`\`json\n${JSON.stringify(evidence, null, 1).slice(0, 4000)}\n\`\`\`\n\nSlack thread: https://c1staffing.slack.com/archives/${DEV_CHANNEL}/p${String(res.ts ?? '').replace('.', '')}`,
    });
    if (issue) issueNumber = issue.number;
    await d.ref.update({ status: 'triaged', diagnosis, slack: { channel: DEV_CHANNEL, ts: res.ts ?? null }, githubIssue: issueNumber, triagedAt: admin.firestore.FieldValue.serverTimestamp() });
    await recordNatalieAction({ tenantId, kind: 'tech_issue', summary: `Flagged a worker-reported problem to #dev: "${s(t.text).slice(0, 80)}"`, userId: uid || null, slack: { channel: DEV_CHANNEL, ts: res.ts } });
    posted += 1;
  }
  return posted;
}

/** Close the loop: when the fixer routine leaves a verdict on the issue, tell the worker and #dev. */
async function drainTechVerdicts(token: string): Promise<number> {
  if (!process.env.GITHUB_NATALIE_TOKEN) return 0;
  const snap = await db.collection('natalie_tech_issues').where('status', '==', 'triaged').limit(10).get();
  let closed = 0;
  for (const d of snap.docs) {
    const t = d.data() as Record<string, unknown>;
    const n = Number(t.githubIssue);
    if (!n) continue;
    const comments = await github<Array<{ body: string; html_url: string }>>('GET', `/repos/${GITHUB_REPO}/issues/${n}/comments?per_page=20`);
    const verdict = (comments ?? []).map((c) => c.body).find((b) => /^\[fixer\] verdict:/m.test(b));
    if (!verdict) continue;
    const kind = /verdict:\s*(fixed_in_pr\s*#?\d+|already_fixed|needs_human)/i.exec(verdict)?.[1] ?? 'unknown';
    const workerNote = /what natalie should text the worker[^\n]*\n+([\s\S]{20,400}?)(\n\n|$)/i.exec(verdict)?.[1]?.trim() ?? null;
    const slack = (t.slack ?? {}) as { channel?: string; ts?: string };
    const text = /already_fixed/i.test(kind)
      ? `Fixer verdict on issue #${n}: already fixed on main. ${workerNote && s(t.phoneE164) ? 'Texting the worker now.' : workerNote ? 'No phone on the report, so no text sent.' : ''}`
      : /fixed_in_pr/i.test(kind)
        ? `Fixer verdict on issue #${n}: fix opened as PR ${kind.replace(/fixed_in_pr\s*/i, '')}. Once it is merged and deployed, reply "deployed" in this thread and I'll text the worker.`
        : `Fixer verdict on issue #${n}: needs a human. See the issue comment.`;
    await postAsNatalie(token, { channel: slack.channel || DEV_CHANNEL, text, threadTs: slack.ts });
    if (/already_fixed/i.test(kind) && workerNote && s(t.phoneE164)) {
      try {
        const { sendWorkerMessageInternal } = await import('../twilio');
        await sendWorkerMessageInternal(s(t.phoneE164), workerNote, { tenantId: s(t.tenantId) || 'BCiP2bQ9CgVOCTfV6MhD', userId: s(t.userId) || undefined, source: 'system', messageTypeId: 'natalie_tech_resolved', systemContext: true } as never);
      } catch (err) {
        logger.warn('[natalie] tech resolution text failed', { err: String(err) });
      }
    }
    await d.ref.update({ status: /already_fixed/i.test(kind) ? 'resolved' : /fixed_in_pr/i.test(kind) ? 'fix_pending_deploy' : 'needs_human', verdict: kind, workerNote, verdictAt: admin.firestore.FieldValue.serverTimestamp() });
    closed += 1;
  }
  return closed;
}

/**
 * Background-check follow-ups: watches with `bgFollowup.active` — text the
 * AccuSource form link once it exists, nudge every 24h (max 3), close out
 * (and tell the Slack thread) when the applicant finishes or after 6 days.
 */
async function drainBackgroundFollowups(token: string): Promise<number> {
  const snap = await db.collection('natalie_sms_watches').where('bgFollowup.active', '==', true).limit(50).get();
  const { latestBackgroundCheckDoc, portalLinkText } = await import('./natalieFill');
  const { sendWorkerMessageInternal } = await import('../twilio');
  let touched = 0;
  for (const d of snap.docs) {
    const w = d.data() as Record<string, unknown>;
    const f = (w.bgFollowup ?? {}) as Record<string, unknown>;
    const tenantId = s(w.tenantId) || 'BCiP2bQ9CgVOCTfV6MhD';
    const userId = s(w.userId) || d.id;
    const slack = (w.slack ?? {}) as { channel?: string; ts?: string };
    const who = s(w.workerName) || userId;
    const startedAt = tsToDate(f.startedAt)?.getTime() ?? Date.now();
    const ageH = (Date.now() - startedAt) / 3600_000;
    const close = async (status: string, text: string) => {
      await d.ref.set({ bgFollowup: { ...f, active: false, closedAt: admin.firestore.FieldValue.serverTimestamp(), closeReason: status } }, { merge: true });
      if (slack.channel) await postAsNatalie(token, { channel: slack.channel, text, threadTs: slack.ts });
      touched += 1;
    };
    const bgDoc = s(f.checkId) ? await db.collection('backgroundChecks').doc(s(f.checkId)).get() : await latestBackgroundCheckDoc(tenantId, userId);
    if (!bgDoc || !bgDoc.exists) {
      if (ageH > 0.5) await close('no_order', `Heads up: no AccuSource order exists for *${who}* even though I tried to start one — someone may need to order it from their profile.`);
      continue;
    }
    const hrxStatus = s(bgDoc.get('hrxStatus'));
    // partial_profile orders sit at awaiting_applicant until the worker finishes the form; any later hrxStatus means they did.
    const done = bgDoc.get('profileCompleted') === true || ['submitted', 'in_progress', 'report_ready', 'drug_report_ready', 'completed'].includes(hrxStatus);
    if (done || bgDoc.get('finalReportReady') === true) { await close('completed', `*${who}* completed the AccuSource form — their ${s(bgDoc.get('requestedPackageName')) || 'background check'} is now ${hrxStatus.replace(/_/g, ' ') || 'in progress'}.`); continue; }
    if (['canceled', 'error'].includes(hrxStatus)) { await close(hrxStatus, `*${who}*'s background order is ${hrxStatus} — needs a human look: ${PUBLIC_APP_ORIGIN}/users/${userId}`); continue; }
    if (ageH > 6 * 24) { await close('gave_up', `*${who}* still hasn't completed the AccuSource form after 6 days and ${Number(f.nudges ?? 0)} reminders — parking it. ${PUBLIC_APP_ORIGIN}/users/${userId}`); continue; }
    const link = s(bgDoc.get('applicantPortalLink')) || s(bgDoc.get('applicantPortalUrl'));
    if (!link) continue; // link not issued yet — check again next minute
    const to = s(w.phoneE164);
    if (!to) { await close('no_phone', `*${who}* has no usable phone, so I can't text the AccuSource form link — please send it manually: ${PUBLIC_APP_ORIGIN}/users/${userId}`); continue; }
    const lastNudge = tsToDate(f.lastNudgeAt)?.getTime() ?? 0;
    const nudges = Number(f.nudges ?? 0);
    const firstName = s(who).split(' ')[0];
    if (f.linkTexted !== true) {
      const r = await sendWorkerMessageInternal(to, portalLinkText(firstName, link, s(bgDoc.get('requestedPackageName')) || 'background check'), { tenantId, userId, source: 'system', messageTypeId: 'natalie_bg_portal_link', systemContext: true } as never);
      await d.ref.set({ bgFollowup: { ...f, linkTexted: Boolean(r.success), lastNudgeAt: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });
      if (r.success && slack.channel) await postAsNatalie(token, { channel: slack.channel, text: `Texted *${who}* their AccuSource form link (${s(bgDoc.get('requestedPackageName')) || 'background check'}). I'll remind them daily until it's done.`, threadTs: slack.ts });
      touched += 1;
      continue;
    }
    if (nudges < 3 && Date.now() - lastNudge > 24 * 3600_000) {
      const hourMT = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Denver', hour: 'numeric', hour12: false }));
      if (hourMT < 9 || hourMT > 19) continue; // daytime reminders only
      const r = await sendWorkerMessageInternal(to, portalLinkText(firstName, link, s(bgDoc.get('requestedPackageName')) || 'background check', true), { tenantId, userId, source: 'system', messageTypeId: 'natalie_bg_reminder', systemContext: true } as never);
      await d.ref.set({ bgFollowup: { ...f, nudges: nudges + 1, lastNudgeAt: admin.firestore.FieldValue.serverTimestamp(), lastNudgeOk: Boolean(r.success) } }, { merge: true });
      touched += 1;
    }
  }
  return touched;
}

/** Scheduled Natalie actions whose time has come (created by schedule_blast or seeded). */
async function drainScheduledActions(token: string): Promise<number> {
  const snap = await db.collection('natalie_scheduled_actions').where('status', '==', 'pending').limit(20).get();
  let ran = 0;
  for (const d of snap.docs) {
    const a = d.data() as Record<string, unknown>;
    const runAt = tsToDate(a.runAt);
    if (!runAt || runAt.getTime() > Date.now()) continue;
    const claimed = await db.runTransaction(async (tx) => {
      const cur = await tx.get(d.ref);
      if (cur.get('status') !== 'pending') return false;
      tx.update(d.ref, { status: 'running', startedAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    });
    if (!claimed) continue;
    const slack = (a.slack ?? {}) as { channel?: string; ts?: string };
    const params = (a.params ?? {}) as Record<string, unknown>;
    let text = '';
    try {
      if (a.kind === 'worker_reach_blast') {
        const { workerReachBlast } = await import('./natalieFill');
        const r = await workerReachBlast({ tenantId: s(a.tenantId), jobOrderId: s(params.jobOrderId), radiusMiles: Number(params.radiusMiles) || 15, askedByName: s(a.askedByName) || 'schedule', slack: slack.channel ? { channel: slack.channel, ts: slack.ts } : undefined });
        text = `Scheduled Worker Reach blast ran for the order at ${Number(params.radiusMiles) || 15} miles: ${JSON.stringify(r).slice(0, 600)}`;
      } else {
        text = `Scheduled action ${s(a.kind)} is not supported yet.`;
      }
      await d.ref.update({ status: 'done', finishedAt: admin.firestore.FieldValue.serverTimestamp(), resultText: text });
    } catch (err) {
      text = `Scheduled ${s(a.kind).replace(/_/g, ' ')} failed: ${err instanceof Error ? err.message : String(err)}`;
      await d.ref.update({ status: 'failed', finishedAt: admin.firestore.FieldValue.serverTimestamp(), lastError: text });
    }
    if (slack.channel) await postAsNatalie(token, { channel: slack.channel, text, threadTs: slack.ts });
    ran += 1;
  }
  return ran;
}

const FLEX_BOOKING_WINDOW_H = 4;
function venueTz(venue: string): { tz: string; label: string } {
  if (/denver|\bCO\b|colorado|utah|\bUT\b|arizona|\bAZ\b/i.test(venue)) return { tz: 'America/Denver', label: 'MT' };
  if (/san francisco|\bCA\b|california|seattle|\bWA\b|oregon|\bOR\b|nevada|\bNV\b/i.test(venue)) return { tz: 'America/Los_Angeles', label: 'PT' };
  if (/new york|\bNY\b|\bNJ\b|florida|\bFL\b|georgia|\bGA\b|\bPA\b|\bMA\b|\bNC\b|\bVA\b|\bOH\b|\bMI\b/i.test(venue)) return { tz: 'America/New_York', label: 'ET' };
  return { tz: 'America/Chicago', label: 'CT' };
}
function fmtClock(d: Date, tz: string): string {
  return d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
}

/**
 * Flex request notices (Greg 2026-09-08, after three OnTrac requests expired
 * unseen): every new request, expiring/expired notice and headcount change
 * that the email ingest turns into an external_shift_requests row is posted
 * to Slack within a minute, with the book-by estimate. Flex revokes unbooked
 * headcount ~4h after a request is posted; accepting alone does not hold it.
 */
async function drainFlexNotices(token: string): Promise<number> {
  const cfg = (await db.doc('tenants/BCiP2bQ9CgVOCTfV6MhD/app_config/natalie').get()).data() as Record<string, unknown> | undefined;
  const channel = s(cfg?.flexNoticeChannelId) || 'C0BF02MEKUP';
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - 3 * 3600_000);
  const snap = await db.collection('tenants/BCiP2bQ9CgVOCTfV6MhD/external_shift_requests').where('createdAt', '>=', since).limit(60).get();
  let posted = 0;
  for (const d of snap.docs) {
    const r = d.data() as Record<string, unknown>;
    if (r.natalieNoticeAt || s(r.provider) !== 'indeed_flex') continue;
    const ev = (r.event ?? {}) as Record<string, unknown>;
    const kind = s(r.eventType) === 'info_notice' ? s(ev.noticeKind) : s(r.eventType);
    if (!['new_request', 'booking_expiring', 'booking_expired', 'change_headcount'].includes(kind)) continue;
    const venue = s(ev.venueName) || s(r.matchedAccountName) || 'unknown venue';
    const { tz, label } = venueTz(`${venue} ${s(ev.venueAddress)}`);
    const created = tsToDate(r.createdAt) ?? new Date();
    const id = s(ev.jobId);
    const account = s(r.matchedAccountName);
    let text = '';
    if (kind === 'new_request') {
      const pa = (r.portalAccept ?? {}) as Record<string, unknown>;
      const bookBy = new Date(created.getTime() + FLEX_BOOKING_WINDOW_H * 3600_000);
      const accept = pa.actionId && pa.dryRun !== true ? "I've queued the accept." : pa.actionId ? `Auto-accept is in *dry run*, so nobody has accepted it — accept it in Flex or tell me "accept ${id}".` : `It didn't match an account I'm allowed to auto-accept — accept it in Flex or tell me "accept ${id}".`;
      text = `New Flex request *#${id}*${account ? ` (${account})` : ''}: ${s(ev.roleName) || 'shift'} at ${venue}, ${s(ev.workDate)} ${s(ev.startTime)}–${s(ev.endTime)}, *${ev.headcount ?? '?'} workers*. ${accept} Flex revokes whatever isn't *booked* about ${FLEX_BOOKING_WINDOW_H}h after posting — book by ~${fmtClock(bookBy, tz)} ${label}.`;
    } else if (kind === 'booking_expiring') {
      text = `:warning: Flex says request *#${id}* is expiring soon — any headcount not booked in the next hour or so gets revoked. ${s(ev.summary)}`;
    } else if (kind === 'booking_expired') {
      text = `:x: Flex request *#${id}* expired unbooked — that headcount is gone; the client would have to re-post it. ${s(ev.summary)}`;
    } else {
      text = `Flex changed the booking at ${venue} on ${s(ev.workDate)}: *${ev.previousHeadcount ?? '?'} → ${ev.newHeadcount ?? '?'} workers*${Number(ev.newHeadcount) < Number(ev.previousHeadcount) ? ' (unfilled headcount revoked at the booking deadline)' : ''}.`;
    }
    const res = await postAsNatalie(token, { channel, text });
    await d.ref.set({ natalieNoticeAt: admin.firestore.FieldValue.serverTimestamp(), natalieNoticeTs: res.ts ?? null, natalieNoticeError: res.error ?? null }, { merge: true });
    if (res.ok) posted += 1;
  }
  return posted;
}

export async function drainNatalieOutbox(token: string): Promise<{ followups: number; escalations: number; relays: number; techIssues: number }> {
  const out = { followups: 0, escalations: 0, relays: 0, techIssues: 0 };
  try { out.followups = await drainFollowups(token); } catch (e) { logger.warn('[natalie] followup drain failed', { err: String(e) }); }
  try { out.escalations = await drainEscalations(token); } catch (e) { logger.warn('[natalie] escalation drain failed', { err: String(e) }); }
  try { out.relays = await drainRelays(token); } catch (e) { logger.warn('[natalie] relay drain failed', { err: String(e) }); }
  try { out.techIssues = await drainTechIssues(token); } catch (e) { logger.warn('[natalie] tech issue drain failed', { err: String(e) }); }
  try { await drainTechVerdicts(token); } catch (e) { logger.warn('[natalie] tech verdict drain failed', { err: String(e) }); }
  try { await drainBackgroundFollowups(token); } catch (e) { logger.warn('[natalie] background followup drain failed', { err: String(e) }); }
  try { await drainScheduledActions(token); } catch (e) { logger.warn('[natalie] scheduled action drain failed', { err: String(e) }); }
  try { await drainFlexNotices(token); } catch (e) { logger.warn('[natalie] flex notice drain failed', { err: String(e) }); }
  // Onboarding + screening follow-ups (Greg 2026-09-09): enroll new onboarding starts / screening
  // orders, run the 24h / 72h / 7d checks, and answer worker replies by text.
  try {
    const { enrollOnboardingFollowups, runOnboardingCheckpoints, drainSmsConversations } = await import('./natalieOnboarding');
    await enrollOnboardingFollowups(token);
    await runOnboardingCheckpoints(token);
    await drainSmsConversations(token);
  } catch (e) { logger.warn('[natalie] onboarding followup drain failed', { err: String(e) }); }
  try { await drainAcceptFills(token); } catch (e) { logger.warn('[natalie] accept fill drain failed', { err: String(e) }); }
  try { await drainCraigslistDrafts(token); } catch (e) { logger.warn('[natalie] craigslist drain failed', { err: String(e) }); }
  try { await drainThinJobDescriptions(token); } catch (e) { logger.warn('[natalie] description autofill drain failed', { err: String(e) }); }
  return out;
}
