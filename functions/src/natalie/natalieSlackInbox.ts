/**
 * Natalie's Slack inbox — every minute, read new DMs to her and @mentions of
 * her in channels she is in (using HER user token, so no bot user is
 * involved), answer with the Claude tool loop, and post the reply as her.
 *
 * Why polling: a user-token app needs no Events API request URL, signing
 * secret, or bot user, and the persona posts as a real member. Latency is
 * up to ~60s. Scopes: channels:history / groups:history cover @mentions in
 * channels; DMs need im:history + im:read (+ mpim:*) which the persona must
 * grant on a re-authorization — until then `users.conversations` for DM
 * types returns missing_scope and we silently skip them.
 *
 * State: app_config/natalie_slack_inbox { cursors: { <channel>: lastTs },
 * threads: { <channel>__<threadTs>: lastTs } }. Thread transcripts (for
 * follow-ups) live in natalie_slack_threads/{channel__threadTs}.
 */
import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { NATALIE_SLACK_USER_TOKEN, postAsNatalie } from '../messaging/slackAsNatalie';
import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN } from '../messaging/twilioSecrets';
import { answerAsNatalie, type NatalieTurn } from './natalieAgent';
import { C1_TENANT_ID } from './natalieTools';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const NATALIE_SLACK_USER_ID = 'U0BV79X65R9';
const STATE_DOC = 'app_config/natalie_slack_inbox';
const THREADS = 'natalie_slack_threads';
const TICK_BUDGET_MS = 50_000;
const MAX_MESSAGES_PER_TICK = 6;
const THREAD_ACTIVE_HOURS = 36;

interface SlackMessage {
  type: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  reply_count?: number;
  latest_reply?: string;
}

interface InboxState {
  cursors: Record<string, string>;
  threads: Record<string, string>;
  initializedAt?: string;
}

/** Pure: should Natalie answer this message? */
export function shouldAnswer(m: SlackMessage, opts: { isDm: boolean; natalieId: string }): boolean {
  if (!m || m.type !== 'message') return false;
  if (m.subtype && !['file_share', 'thread_broadcast'].includes(m.subtype)) return false;
  if (!m.user || m.user === opts.natalieId || m.bot_id) return false;
  const text = m.text ?? '';
  if (opts.isDm) return text.trim().length > 0;
  return text.includes(`<@${opts.natalieId}>`);
}

/** Pure: strip the mention and Slack escapes for the model. */
export function cleanText(text: string, natalieId: string): string {
  return text
    .replace(new RegExp(`<@${natalieId}>`, 'g'), '')
    .replace(/<@([A-Z0-9]+)>/g, '@$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function slack<T = Record<string, unknown>>(token: string, method: string, params: Record<string, string | number | undefined>): Promise<T & { ok: boolean; error?: string }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
  const res = await fetch(`https://slack.com/api/${method}?${qs.toString()}`, { headers: { authorization: `Bearer ${token}` } });
  return (await res.json()) as T & { ok: boolean; error?: string };
}

const userCache = new Map<string, { name: string; teamId: string | null; isBot: boolean }>();
async function userInfo(token: string, id: string): Promise<{ name: string; teamId: string | null; isBot: boolean }> {
  if (userCache.has(id)) return userCache.get(id)!;
  const r = await slack<{ user?: { real_name?: string; name?: string; team_id?: string; is_bot?: boolean; is_stranger?: boolean; profile?: { display_name?: string; first_name?: string; team?: string } } }>(token, 'users.info', { user: id });
  const u = r.ok ? r.user : undefined;
  const info = {
    name: u?.profile?.first_name || u?.real_name || u?.profile?.display_name || u?.name || id,
    teamId: u?.team_id || u?.profile?.team || null,
    isBot: Boolean(u?.is_bot),
  };
  userCache.set(id, info);
  return info;
}

let homeTeamId: string | null = null;
async function natalieTeamId(token: string): Promise<string | null> {
  if (homeTeamId) return homeTeamId;
  const r = await slack<{ team_id?: string }>(token, 'auth.test', {});
  homeTeamId = r.ok ? r.team_id ?? null : null;
  return homeTeamId;
}

async function loadState(): Promise<InboxState> {
  const snap = await db.doc(STATE_DOC).get();
  const d = (snap.data() ?? {}) as Partial<InboxState>;
  return { cursors: d.cursors ?? {}, threads: d.threads ?? {}, initializedAt: d.initializedAt };
}

async function saveState(state: InboxState): Promise<void> {
  await db.doc(STATE_DOC).set({ ...state, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
}

async function loadThread(key: string): Promise<NatalieTurn[]> {
  const snap = await db.collection(THREADS).doc(key).get();
  const turns = (snap.get('turns') as NatalieTurn[] | undefined) ?? [];
  return turns.slice(-20);
}

async function appendThread(key: string, meta: { channel: string; threadTs: string; isDm: boolean }, turns: NatalieTurn[]): Promise<void> {
  await db.collection(THREADS).doc(key).set(
    { ...meta, turns: admin.firestore.FieldValue.arrayUnion(...turns), updatedAt: admin.firestore.FieldValue.serverTimestamp(), lastActiveAt: new Date().toISOString() },
    { merge: true },
  );
}

interface Pending { channel: string; isDm: boolean; message: SlackMessage; threadTs: string }

async function collectNew(token: string, state: InboxState, firstRun: boolean): Promise<Pending[]> {
  const pending: Pending[] = [];
  // 1. Conversations Natalie is in. DM types need im:read/mpim:read; fall back when missing.
  let convs = await slack<{ channels?: Array<{ id: string; is_im?: boolean; is_mpim?: boolean; is_member?: boolean; name?: string }> }>(token, 'users.conversations', {
    types: 'public_channel,private_channel,im,mpim', limit: 200, exclude_archived: 'true',
  });
  if (!convs.ok && convs.error === 'missing_scope') {
    convs = await slack(token, 'users.conversations', { types: 'public_channel,private_channel', limit: 200, exclude_archived: 'true' });
  }
  if (!convs.ok) {
    logger.warn('[natalie] users.conversations failed', { error: convs.error });
    return pending;
  }
  const nowTs = (Date.now() / 1000).toFixed(6);
  for (const c of convs.channels ?? []) {
    const isDm = Boolean(c.is_im || c.is_mpim);
    const cursor = state.cursors[c.id];
    if (!cursor) {
      // Never answer a backlog: start from now.
      state.cursors[c.id] = nowTs;
      continue;
    }
    if (firstRun) continue;
    const hist = await slack<{ messages?: SlackMessage[] }>(token, 'conversations.history', { channel: c.id, oldest: cursor, limit: 50, inclusive: 'false' });
    if (!hist.ok) {
      if (hist.error !== 'missing_scope' && hist.error !== 'not_in_channel') logger.warn('[natalie] history failed', { channel: c.id, error: hist.error });
      continue;
    }
    let maxTs = cursor;
    for (const m of hist.messages ?? []) {
      if (Number(m.ts) > Number(maxTs)) maxTs = m.ts;
      if (shouldAnswer(m, { isDm, natalieId: NATALIE_SLACK_USER_ID })) {
        pending.push({ channel: c.id, isDm, message: m, threadTs: m.thread_ts || m.ts });
      }
    }
    state.cursors[c.id] = maxTs;
  }
  // 2. Threads Natalie has already replied in: catch follow-ups (history omits thread replies).
  const activeSince = Date.now() - THREAD_ACTIVE_HOURS * 3600_000;
  for (const [key, lastTs] of Object.entries(state.threads)) {
    const [channel, threadTs] = key.split('__');
    if (!channel || !threadTs || Number(threadTs) * 1000 < activeSince - 7 * 86400_000) continue;
    const isDm = convs.channels?.some((c) => c.id === channel && (c.is_im || c.is_mpim)) ?? false;
    const rep = await slack<{ messages?: SlackMessage[] }>(token, 'conversations.replies', { channel, ts: threadTs, oldest: lastTs, limit: 50, inclusive: 'false' });
    if (!rep.ok) continue;
    let maxTs = lastTs;
    for (const m of rep.messages ?? []) {
      if (m.ts === threadTs || Number(m.ts) <= Number(lastTs)) continue;
      if (Number(m.ts) > Number(maxTs)) maxTs = m.ts;
      // In a thread she's part of, answer any human message (no mention needed).
      if (shouldAnswer({ ...m, text: `<@${NATALIE_SLACK_USER_ID}> ${m.text ?? ''}` }, { isDm: true, natalieId: NATALIE_SLACK_USER_ID })) {
        if (!pending.some((p) => p.message.ts === m.ts)) pending.push({ channel, isDm, message: m, threadTs });
      }
    }
    state.threads[key] = maxTs;
  }
  pending.sort((a, b) => Number(a.message.ts) - Number(b.message.ts));
  return pending;
}

export async function pollNatalieInbox(token: string): Promise<{ answered: number; skipped: number }> {
  const started = Date.now();
  const state = await loadState();
  const firstRun = !state.initializedAt;
  const pending = await collectNew(token, state, firstRun);
  if (firstRun) {
    state.initializedAt = new Date().toISOString();
    await saveState(state);
    logger.info('[natalie] inbox initialized; backlog ignored', { channels: Object.keys(state.cursors).length });
    return { answered: 0, skipped: 0 };
  }
  await saveState(state);
  let answered = 0, skipped = 0;
  for (const p of pending) {
    if (answered >= MAX_MESSAGES_PER_TICK || Date.now() - started > TICK_BUDGET_MS) { skipped += 1; continue; }
    const key = `${p.channel}__${p.threadTs}`;
    const askedBy = p.message.user!;
    const who = await userInfo(token, askedBy);
    const askedByName = who.name;
    // Only C1 Staffing's own members: in Slack Connect channels (e.g. the
    // Indeed Flex team's) an outside user can @mention her — never hand
    // internal HRX data to another workspace.
    const home = await natalieTeamId(token);
    if (who.isBot || (home && who.teamId && who.teamId !== home)) {
      logger.info('[natalie] ignoring message from outside the workspace', { channel: p.channel, askedBy, teamId: who.teamId });
      skipped += 1;
      continue;
    }
    const text = cleanText(p.message.text ?? '', NATALIE_SLACK_USER_ID);
    const history = await loadThread(key);
    const turn: NatalieTurn = { role: 'user', text, by: askedBy, byName: askedByName, ts: p.message.ts };
    try {
      const ans = await answerAsNatalie({ history, message: turn, ctx: { tenantId: C1_TENANT_ID, askedBySlackUserId: askedBy, askedByName } });
      // DMs: reply inline (no thread) unless the person is already in a thread. Channels: always thread.
      const threadTs = p.isDm && p.threadTs === p.message.ts ? undefined : p.threadTs;
      const post = await postAsNatalie(token, { channel: p.channel, text: ans.text, threadTs });
      if (!post.ok) {
        logger.warn('[natalie] post failed', { channel: p.channel, error: post.error });
        continue;
      }
      const reply: NatalieTurn = { role: 'assistant', text: ans.text, by: 'natalie', ts: post.ts };
      await appendThread(key, { channel: p.channel, threadTs: p.threadTs, isDm: p.isDm }, [turn, reply]);
      if (threadTs) state.threads[key] = post.ts ?? p.message.ts;
      answered += 1;
      logger.info('[natalie] answered', { channel: p.channel, askedBy, tools: ans.toolCalls.map((t) => t.name), usage: ans.usage });
    } catch (err) {
      logger.error('[natalie] answer failed', { channel: p.channel, err: err instanceof Error ? err.message : String(err) });
      await postAsNatalie(token, { channel: p.channel, text: "Sorry — I hit an error looking that up. Give me a minute and try again, or ping Greg if it keeps happening.", threadTs: p.isDm ? undefined : p.threadTs }).catch(() => undefined);
    }
  }
  await saveState(state);
  return { answered, skipped };
}

export const natalieSlackInbox = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: 'UTC',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
    maxInstances: 1,
    secrets: [NATALIE_SLACK_USER_TOKEN, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async () => {
    const token = NATALIE_SLACK_USER_TOKEN.value() || process.env.NATALIE_SLACK_USER_TOKEN;
    if (!token) {
      logger.warn('[natalie] no NATALIE_SLACK_USER_TOKEN bound');
      return;
    }
    const r = await pollNatalieInbox(token);
    if (r.answered || r.skipped) logger.info('[natalie] tick', r);
  },
);
