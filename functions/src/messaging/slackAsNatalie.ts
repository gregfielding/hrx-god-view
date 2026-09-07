/**
 * Slack as Natalie Brooks (persona user token) — 2026-09-07.
 *
 * Greg: when a Flex-linked worker cancels or no-shows, Natalie should ask the
 * Indeed Flex team in #indeedflex_c1staffing whether they want a replacement
 * today, "like a regular user" (see docs/claude/reference_slack_natalie_persona.md).
 *
 * Same decoupled shape as smsDeliveryAlerts.ts so the cadence code never
 * needs the Slack secret:
 *   1. `enqueueFlexTeamAsk` — called from the worker-cancel and no-show
 *      branches. Writes `tenants/{t}/flex_team_asks/{kind__assignmentId}`
 *      (idempotent) only when the assignment is Flex-linked.
 *   2. `drainFlexTeamAsks` — called by dispatchScheduledWorkerReminders
 *      (every 5 min, binds NATALIE_SLACK_USER_TOKEN). Composes the message,
 *      posts as Natalie, marks the doc posted.
 *
 * Channel comes from `tenants/{t}/app_config/indeed_flex.flexTeamAskChannelId`;
 * until Greg points it at the Slack Connect channel (C0B8ACFEU21) it defaults
 * to #dev so the first live messages are reviewed internally.
 */
import * as admin from 'firebase-admin';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/** Bind on any function that calls drainFlexTeamAsks / postAsNatalie. */
export const NATALIE_SLACK_USER_TOKEN = defineSecret('NATALIE_SLACK_USER_TOKEN');

/** #dev — internal review channel until app_config points at the Flex channel. */
export const DEFAULT_FLEX_ASK_CHANNEL = 'C08U7U0FL03';
/** #indeedflex_c1staffing (Slack Connect with the Indeed Flex team). */
export const INDEED_FLEX_TEAM_CHANNEL = 'C0B8ACFEU21';

export type FlexTeamAskKind = 'cancelled' | 'no_show';

/** True when the assignment came from / is tracked in Indeed Flex. */
export function isFlexLinkedAssignment(a: Record<string, unknown> | null | undefined): boolean {
  if (!a) return false;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const src = `${str(a.assignmentSource)} ${str(a.source)} ${str(a.origin)}`.toLowerCase();
  if (/indeed_flex|indeedflex|flex_portal/.test(src)) return true;
  if (a.flexJobId || a.flexWorkerId || a.flexShiftId) return true;
  const refs = (a.refs ?? a.externalRefs ?? {}) as Record<string, unknown>;
  if (refs.flexJobId || refs.indeedFlexJobId || refs.indeedFlex) return true;
  if (a.indeedFlex && typeof a.indeedFlex === 'object') return true;
  const clock = `${str(a.clockInUrl)} ${str((a.shift as Record<string, unknown> | undefined)?.clockInUrl)}`;
  return /time\.indeed\.com/.test(clock);
}

export interface FlexTeamAskInput {
  tenantId: string;
  assignmentId: string;
  assignment: Record<string, unknown>;
  kind: FlexTeamAskKind;
  /** Free-form detail (matched SMS token, minutes late, …). */
  detail?: string;
}

function pickName(a: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const first = s(a.workerFirstName) || s(a.firstName) || s(a.workerName).split(' ')[0] || '';
  const last = s(a.workerLastName) || s(a.lastName) || s(a.workerName).split(' ').slice(1).join(' ') || '';
  if (first && last) return `${first} ${last.charAt(0)}.`;
  return first || s(a.workerName) || 'the worker';
}

function pickDateLabel(a: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const raw = a.startTime ?? a.startDate ?? a.shiftDate ?? a.workDate;
  const d = raw && typeof (raw as { toDate?: () => Date }).toDate === 'function'
    ? (raw as { toDate: () => Date }).toDate()
    : typeof raw === 'string' && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : null;
  const tz = s(a.timezone) || 'America/Chicago';
  if (!d) return s(a.startDate) || s(a.shiftDate) || 'today';
  try {
    return d.toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/**
 * Pure message composer — unit-tested. `priorNoShows` counts the worker's
 * earlier no-call-no-shows (excluding this one).
 */
export function composeFlexTeamAsk(input: {
  kind: FlexTeamAskKind;
  workerLabel: string;
  jobTitle: string;
  venue: string;
  whenLabel: string;
  priorNoShows: number;
  detail?: string;
}): string {
  const { kind, workerLabel, jobTitle, venue, whenLabel, priorNoShows } = input;
  const where = venue ? ` at ${venue}` : '';
  const what = jobTitle ? ` (${jobTitle})` : '';
  const lead =
    kind === 'cancelled'
      ? `Hi team — ${workerLabel} just let us know they can't make their shift${what}${where}, ${whenLabel}.`
      : `Hi team — ${workerLabel} hasn't checked in for their shift${what}${where}, ${whenLabel}, and we haven't been able to reach them.`;
  const ask = 'Would you like us to send a replacement today? Reply here and I\'ll get someone booked right away.';
  const repeat =
    priorNoShows >= 2
      ? ` This is also their ${ordinal(priorNoShows + 1)} no-call/no-show with us, so if you'd rather we line up a permanent replacement for the rest of the booking, just say the word.`
      : priorNoShows === 1
        ? ' Heads up that this is their second no-show with us; we\'re happy to arrange a permanent replacement if you prefer.'
        : '';
  const detail = input.detail ? ` (${input.detail})` : '';
  return `${lead}${detail} ${ask}${repeat}`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/**
 * Queue an ask for the drain. Idempotent per (kind, assignment). Never
 * throws. Returns true when a new doc was written.
 */
export async function enqueueFlexTeamAsk(input: FlexTeamAskInput): Promise<boolean> {
  try {
    if (!isFlexLinkedAssignment(input.assignment)) return false;
    const a = input.assignment;
    const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const ref = db.doc(`tenants/${input.tenantId}/flex_team_asks/${input.kind}__${input.assignmentId}`);
    const snap = await ref.get();
    if (snap.exists) return false;
    await ref.set({
      kind: input.kind,
      status: 'pending',
      tenantId: input.tenantId,
      assignmentId: input.assignmentId,
      userId: s(a.userId) || s(a.candidateId) || s(a.workerId) || null,
      workerLabel: pickName(a),
      jobTitle: s(a.jobTitle) || s(a.title) || s(a.jobOrderName) || '',
      venue: s(a.locationName) || s(a.worksiteName) || s(a.venueName) || s(a.companyName) || '',
      whenLabel: pickDateLabel(a),
      flexJobId: s(a.flexJobId) || s((a.refs as Record<string, unknown> | undefined)?.flexJobId) || null,
      detail: input.detail ?? null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    logger.info('[slackAsNatalie] flex team ask queued', { tenantId: input.tenantId, assignmentId: input.assignmentId, kind: input.kind });
    return true;
  } catch (err) {
    logger.warn('[slackAsNatalie] enqueueFlexTeamAsk failed (non-fatal)', { err: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export async function postAsNatalie(
  token: string,
  msg: { channel: string; text: string; threadTs?: string },
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ channel: msg.channel, text: msg.text, ...(msg.threadTs ? { thread_ts: msg.threadTs } : {}), unfurl_links: false }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; ts?: string; error?: string };
  return { ok: body.ok === true, ts: body.ts, error: body.error };
}

async function countPriorNoShows(tenantId: string, userId: string | null, excludeAssignmentId: string): Promise<number> {
  if (!userId) return 0;
  try {
    const snap = await db.collection(`tenants/${tenantId}/assignments`).where('userId', '==', userId).limit(500).get();
    let n = 0;
    for (const d of snap.docs) {
      if (d.id === excludeAssignmentId) continue;
      const cort = (d.get('cortConfirmation') ?? {}) as Record<string, unknown>;
      if (cort.state === 'no_show' || d.get('status') === 'no_show' || d.get('noShow') === true) n += 1;
    }
    return n;
  } catch {
    return 0;
  }
}

/**
 * Post pending asks as Natalie. Caller supplies the bound token. Never
 * throws. Returns the number posted.
 */
export async function drainFlexTeamAsks(token: string | null | undefined, limit = 10): Promise<number> {
  if (!token) return 0;
  try {
    const snap = await db.collectionGroup('flex_team_asks').where('status', '==', 'pending').limit(limit).get();
    let posted = 0;
    for (const d of snap.docs) {
      const a = d.data() as Record<string, unknown>;
      const tenantId = String(a.tenantId ?? '');
      let channel = DEFAULT_FLEX_ASK_CHANNEL;
      try {
        const cfg = await db.doc(`tenants/${tenantId}/app_config/indeed_flex`).get();
        if (cfg.get('flexTeamAsksEnabled') === false) {
          await d.ref.update({ status: 'suppressed', suppressedReason: 'flexTeamAsksEnabled=false', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
          continue;
        }
        channel = String(cfg.get('flexTeamAskChannelId') ?? '').trim() || DEFAULT_FLEX_ASK_CHANNEL;
      } catch {
        /* default channel */
      }
      const priorNoShows = await countPriorNoShows(tenantId, (a.userId as string | null) ?? null, String(a.assignmentId ?? ''));
      const text = composeFlexTeamAsk({
        kind: a.kind as FlexTeamAskKind,
        workerLabel: String(a.workerLabel ?? 'the worker'),
        jobTitle: String(a.jobTitle ?? ''),
        venue: String(a.venue ?? ''),
        whenLabel: String(a.whenLabel ?? 'today'),
        priorNoShows,
        detail: typeof a.detail === 'string' && a.detail ? a.detail : undefined,
      });
      const res = await postAsNatalie(token, { channel, text });
      if (res.ok) {
        await d.ref.update({ status: 'posted', postedAt: admin.firestore.FieldValue.serverTimestamp(), slackChannel: channel, slackTs: res.ts ?? null, priorNoShows, text });
        posted += 1;
      } else {
        await d.ref.update({ status: res.error === 'channel_not_found' || res.error === 'not_in_channel' ? 'failed' : 'pending', lastError: res.error ?? 'unknown', attempts: admin.firestore.FieldValue.increment(1), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        logger.warn('[slackAsNatalie] post failed', { id: d.id, error: res.error });
      }
    }
    return posted;
  } catch (err) {
    logger.warn('[slackAsNatalie] drain failed (non-fatal)', { err: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}
