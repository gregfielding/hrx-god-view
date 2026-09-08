/**
 * Conversation context for Natalie, built from Slack itself (Greg 2026-09-08:
 * Deborah answered "yes please" to Natalie's own question and Natalie replied
 * "what am I saying yes to?" — history was stored per `channel__threadTs`, so
 * in a DM every top-level message started an empty conversation).
 *
 * DMs: the last ~40 messages of the DM (both sides) plus the replies of any
 * thread in that window, in time order. Channels: the thread the message is
 * in plus the last few top-level channel messages. Natalie's own posts become
 * assistant turns; everyone else's become user turns. Nothing here depends on
 * what the inbox stored, so a missed tick or a redeploy never drops context.
 */
import type { NatalieTurn } from './natalieAgent';

interface SlackMsg {
  type?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  reply_count?: number;
}

type SlackCall = <T extends { ok: boolean; error?: string }>(method: string, params: Record<string, string>) => Promise<T>;
type NameResolver = (userId: string) => Promise<string>;

export interface SlackContextInput {
  channel: string;
  isDm: boolean;
  /** The message being answered — history is everything before it. */
  messageTs: string;
  threadTs: string;
  natalieId: string;
  cleanText: (text: string) => string;
}

const DM_WINDOW = 40;
const CHANNEL_WINDOW = 8;
const MAX_TURNS = 30;
const MAX_THREADS_EXPANDED = 4;

function isConversational(m: SlackMsg): boolean {
  if (!m || (m.type && m.type !== 'message')) return false;
  if (m.subtype && !['file_share', 'thread_broadcast'].includes(m.subtype)) return false;
  return Boolean(m.user) && Boolean((m.text ?? '').trim());
}

export async function buildSlackHistory(slack: SlackCall, resolveName: NameResolver, input: SlackContextInput): Promise<NatalieTurn[]> {
  const { channel, isDm, messageTs, threadTs, natalieId } = input;
  const collected = new Map<string, SlackMsg>();
  const add = (m: SlackMsg) => { if (isConversational(m) && Number(m.ts) < Number(messageTs)) collected.set(m.ts, m); };

  try {
    if (isDm) {
      const hist = await slack<{ ok: boolean; error?: string; messages?: SlackMsg[] }>('conversations.history', { channel, latest: messageTs, inclusive: 'false', limit: String(DM_WINDOW) });
      const top = hist.ok ? hist.messages ?? [] : [];
      top.forEach(add);
      // Threads inside the DM (a reply Natalie posted in-thread lives only there).
      const threaded = top.filter((m) => (m.reply_count ?? 0) > 0).sort((a, b) => Number(b.ts) - Number(a.ts)).slice(0, MAX_THREADS_EXPANDED);
      for (const t of threaded) {
        const rep = await slack<{ ok: boolean; error?: string; messages?: SlackMsg[] }>('conversations.replies', { channel, ts: t.ts, limit: '30' });
        if (rep.ok) (rep.messages ?? []).forEach(add);
      }
    } else {
      const recent = await slack<{ ok: boolean; error?: string; messages?: SlackMsg[] }>('conversations.history', { channel, latest: messageTs, inclusive: 'false', limit: String(CHANNEL_WINDOW) });
      if (recent.ok) (recent.messages ?? []).forEach(add);
    }
    if (threadTs && threadTs !== messageTs) {
      const rep = await slack<{ ok: boolean; error?: string; messages?: SlackMsg[] }>('conversations.replies', { channel, ts: threadTs, limit: '60' });
      if (rep.ok) (rep.messages ?? []).forEach(add);
    }
  } catch {
    // fail open: the caller merges whatever we got with its stored turns
  }

  const ordered = [...collected.values()].sort((a, b) => Number(a.ts) - Number(b.ts)).slice(-MAX_TURNS);
  const turns: NatalieTurn[] = [];
  for (const m of ordered) {
    const mine = m.user === natalieId;
    turns.push({ role: mine ? 'assistant' : 'user', text: input.cleanText(m.text ?? ''), by: mine ? 'natalie' : m.user!, byName: mine ? 'Natalie' : await resolveName(m.user!), ts: m.ts });
  }
  return turns;
}

/** Stored turns fill gaps Slack didn't return (deleted messages, rate limits); Slack wins on conflicts. */
export function mergeTurns(stored: NatalieTurn[], live: NatalieTurn[]): NatalieTurn[] {
  const byTs = new Map<string, NatalieTurn>();
  for (const t of stored) if (t.ts) byTs.set(t.ts, t);
  for (const t of live) if (t.ts) byTs.set(t.ts, t);
  const untimed = stored.filter((t) => !t.ts);
  return [...untimed, ...[...byTs.values()].sort((a, b) => Number(a.ts) - Number(b.ts))].slice(-MAX_TURNS);
}
