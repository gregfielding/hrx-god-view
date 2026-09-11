/**
 * Staff ↔ persona conversations over SMS and email (Greg 2026-09-11: "Rosa will be texting Marco a lot
 * (her preferred contact method)"). The same context-aware conversation Natalie has in Slack, for texts
 * and emails, for both personas.
 *
 * Who: C1 staff only — HRX users at tenant securityLevel >= 5 with a @c1staffing.com email, not a persona.
 * Client contacts with level-7 accounts (Venue Smart, TI Sales) and outside bookkeepers never get the
 * agent. The directory is materialized hourly into app_config/persona_staff_directory so the SMS webhook
 * matches a sender with one read (staff phones are stored unnormalized, e.g. "(512) 555-0100").
 *
 * SMS: handleInboundSms → enqueueStaffSms (persona = the Twilio number texted; sender in the directory;
 * not a STOP/HELP keyword) → persona_sms_inbox/{MessageSid} → drainStaffSms in the natalieSlackInbox tick
 * answers with the Slack brain (surface 'sms'). History = persona_sms_threads/{persona}__{phone}. The
 * reply goes out from the persona's number as `{prefix}staff_reply`.
 *
 * Email: drainStaffEmail reads each connected persona mailbox for unread mail from staff, answers in the
 * same Gmail thread with the whole thread as history, marks it read, and records
 * persona_email_handled/{persona}__{messageId}. Mail from anyone else is left for humans — no automatic
 * replies to clients or applicants.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import type { gmail_v1 } from 'googleapis';
import { answerAsNatalie, type NatalieTurn } from './natalieAgent';
import { PERSONAS, type PersonaId, type PersonaRuntime } from './personas';
import { normalizeReplySubject, repairMojibake } from '../sales/mimeHeaders';

const db = () => admin.firestore();
const TENANT = 'BCiP2bQ9CgVOCTfV6MhD';
const DIRECTORY_DOC = 'app_config/persona_staff_directory';
const DIRECTORY_MAX_AGE_MS = 60 * 60_000;
const STAFF_DOMAIN = '@c1staffing.com';
const MAX_TURNS = 30;
const SMS_MAX_CHARS = 1200;
const INBOX = 'persona_sms_inbox';
const SMS_THREADS = 'persona_sms_threads';
const EMAIL_LEDGER = 'persona_email_handled';

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));

/** Pure: US phone in any format → +1XXXXXXXXXX, or ''. */
export function normalizeUsPhone(v: unknown): string {
  const d = s(v).replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return '';
}

export interface StaffMember { uid: string; name: string; firstName: string; email: string; phoneE164: string; slackUserId: string }

/** Pure: a users doc → a staff member who may talk to the personas, or null. */
export function staffFromUser(uid: string, u: Record<string, unknown>, tenantId: string): StaffMember | null {
  if (u.isAutomationPersona === true) return null;
  const email = s(u.email).toLowerCase();
  if (!email.endsWith(STAFF_DOMAIN)) return null;
  const m = ((u.tenantIds ?? {}) as Record<string, Record<string, unknown>>)[tenantId] ?? {};
  if (!(Number(m.securityLevel ?? u.securityLevel ?? 0) >= 5)) return null;
  if (['inactive', 'terminated', 'disabled', 'removed'].includes(s(m.status).toLowerCase())) return null;
  const firstName = s(u.firstName) || s(u.preferredName) || email.split('@')[0];
  const slack = ((u.integrations ?? {}) as Record<string, Record<string, unknown>>).slack ?? {};
  return {
    uid,
    name: `${firstName} ${s(u.lastName)}`.trim(),
    firstName,
    email,
    phoneE164: normalizeUsPhone(u.phoneE164) || normalizeUsPhone(u.phone),
    slackUserId: s(slack.slackUserId) || s(u.slackUserId),
  };
}

export interface StaffDirectory { byPhone: Record<string, StaffMember>; byEmail: Record<string, StaffMember> }

/** The cached directory; rebuilt when missing, or when `refresh` is set and it is over an hour old. */
export async function loadStaffDirectory(opts: { refresh?: boolean } = {}): Promise<StaffDirectory> {
  const ref = db().doc(DIRECTORY_DOC);
  const cur = (await ref.get()).data();
  const age = Date.now() - ((cur?.refreshedAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0);
  if (cur && (!opts.refresh || age < DIRECTORY_MAX_AGE_MS)) return { byPhone: cur.byPhone ?? {}, byEmail: cur.byEmail ?? {} };
  const levels = ['5', '6', '7', '8', '9', '10', 5, 6, 7, 8, 9, 10];
  const snap = await db().collection('users').where(`tenantIds.${TENANT}.securityLevel`, 'in', levels).limit(300).get();
  const byPhone: Record<string, StaffMember> = {};
  const byEmail: Record<string, StaffMember> = {};
  for (const d of snap.docs) {
    const m = staffFromUser(d.id, d.data(), TENANT);
    if (!m) continue;
    byEmail[m.email] = m;
    if (m.phoneE164) byPhone[m.phoneE164] = m;
  }
  await ref.set({ byPhone, byEmail, count: Object.keys(byEmail).length, refreshedAt: admin.firestore.FieldValue.serverTimestamp() });
  return { byPhone, byEmail };
}

/** Pure: which persona owns the Twilio number that was texted. */
export function personaForNumber(to: unknown): PersonaId | null {
  const e164 = normalizeUsPhone(to);
  return (Object.values(PERSONAS).find((p) => p.fromNumber === e164)?.id as PersonaId | undefined) ?? null;
}

/** STOP / HELP / START family — compliance handling owns these, never the agent. A plain "yes" is a conversation. */
const KEYWORD_RE = /^\s*(stop|stopall|unsubscribe|end|quit|revoke|optout|cancel|help|info|start|unstop)\s*[.!]*\s*$/i;

/** Called by the inbound SMS webhook. True when the text was a staff message to a persona (queued; nothing else should handle it). */
export async function enqueueStaffSms(input: { from: unknown; to: unknown; body: string; messageSid?: string }): Promise<boolean> {
  const persona = personaForNumber(input.to);
  if (!persona) return false;
  const from = normalizeUsPhone(input.from);
  if (!from || !s(input.body) || KEYWORD_RE.test(input.body)) return false;
  const staff = (await loadStaffDirectory()).byPhone[from];
  if (!staff) return false;
  const ref = input.messageSid ? db().collection(INBOX).doc(String(input.messageSid)) : db().collection(INBOX).doc();
  await ref.set({
    persona, fromE164: from, staffUid: staff.uid, staffName: staff.name, text: s(input.body).slice(0, 1600),
    status: 'pending', createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return true;
}

/** Pure: Slack mrkdwn → plain SMS text, clamped. */
export function toSmsText(text: string): string {
  const plain = text
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2: $1')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1$2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return plain.length > SMS_MAX_CHARS ? `${plain.slice(0, SMS_MAX_CHARS - 1).trimEnd()}…` : plain;
}

const nowTs = () => (Date.now() / 1000).toFixed(6);

export async function drainStaffSms(runtime: PersonaRuntime): Promise<number> {
  const snap = await db().collection(INBOX).where('status', '==', 'pending').limit(5).get();
  const docs = [...snap.docs].sort((a, b) => (a.get('createdAt')?.toMillis?.() ?? 0) - (b.get('createdAt')?.toMillis?.() ?? 0));
  let answered = 0;
  for (const d of docs) {
    const claimed = await db().runTransaction(async (tx) => {
      const cur = await tx.get(d.ref);
      if (cur.get('status') !== 'pending') return false;
      tx.update(d.ref, { status: 'answering', claimedAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    }).catch(() => false);
    if (!claimed) continue;
    const x = d.data();
    const persona: PersonaId = x.persona === 'marco' ? 'marco' : 'natalie';
    const P = PERSONAS[persona];
    const phone = s(x.fromE164);
    const staff = (await loadStaffDirectory()).byPhone[phone];
    const threadRef = db().collection(SMS_THREADS).doc(`${persona}__${phone}`);
    const stored = ((await threadRef.get()).get('turns') as NatalieTurn[] | undefined) ?? [];
    const turn: NatalieTurn = { role: 'user', text: s(x.text), by: staff?.slackUserId || staff?.uid || phone, byName: staff?.firstName || 'Staff', ts: nowTs() };
    const { sendWorkerMessageInternal } = await import('../twilio');
    const text = async (body: string) => sendWorkerMessageInternal(phone, body, { tenantId: TENANT, source: 'system', messageTypeId: `${P.smsPrefix}staff_reply`, systemContext: true } as never);
    try {
      const ans = await answerAsNatalie({
        history: stored.slice(-MAX_TURNS), message: turn, surface: 'sms', marcoLive: runtime.marcoEnabled,
        ctx: { tenantId: TENANT, askedBySlackUserId: staff?.slackUserId || '', askedByName: staff?.firstName || 'staff', persona },
      });
      const reply = toSmsText(ans.text);
      const r = await text(reply);
      await threadRef.set({
        persona, phoneE164: phone, staffUid: staff?.uid ?? null, staffName: staff?.name ?? null,
        turns: [...stored, turn, { role: 'assistant', text: reply, by: persona, byName: P.firstName, ts: nowTs() }].slice(-60),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      await d.ref.update({ status: r.success ? 'answered' : 'send_failed', reply, sendError: r.success ? null : r.error ?? r.errorCode ?? 'unknown', tools: ans.toolCalls.map((t) => t.name), answeredAt: admin.firestore.FieldValue.serverTimestamp() });
      if (r.success) answered += 1;
      logger.info('[persona-sms] answered', { persona, staff: staff?.uid ?? null, tools: ans.toolCalls.map((t) => t.name), sent: r.success });
    } catch (err) {
      logger.error('[persona-sms] answer failed', { persona, err: err instanceof Error ? err.message : String(err) });
      await d.ref.update({ status: 'failed', lastError: String(err).slice(0, 300) });
      await text('Sorry — I hit an error looking that up. Give me a minute and try again.').catch(() => undefined);
    }
  }
  return answered;
}

/** Pure: Slack mrkdwn → plain email body. */
export function toEmailText(text: string): string {
  const plain = text
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2: $1')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .trim();
  return plain || 'Got it.';
}

/** Pure: a Gmail message → a conversation turn from the persona's point of view. */
export function emailTurn(msg: gmail_v1.Schema$Message, personaEmail: string, persona: PersonaId, helpers: { header: (m: gmail_v1.Schema$Message, n: string) => string; body: (m: gmail_v1.Schema$Message) => string }): NatalieTurn {
  const from = helpers.header(msg, 'From');
  const mine = from.toLowerCase().includes(personaEmail.toLowerCase());
  const name = from.replace(/<[^>]*>/, '').replace(/"/g, '').trim() || from;
  return { role: mine ? 'assistant' : 'user', text: helpers.body(msg), by: mine ? persona : from, byName: mine ? PERSONAS[persona].firstName : name.split(' ')[0], ts: String(Number(msg.internalDate ?? 0) / 1000) };
}

export async function drainStaffEmail(runtime: PersonaRuntime): Promise<number> {
  const { personaGmail, sendEmail, messageHeader, messagePlainText } = await import('./natalieMailbox');
  const helpers = { header: messageHeader, body: messagePlainText };
  const dir = await loadStaffDirectory();
  let answered = 0;
  for (const persona of Object.keys(PERSONAS) as PersonaId[]) {
    const gmail = await personaGmail(persona, TENANT).catch(() => null);
    if (!gmail) continue;
    const P = PERSONAS[persona];
    const list = await gmail.users.messages.list({ userId: 'me', q: `in:inbox is:unread newer_than:2d from:${STAFF_DOMAIN.slice(1)} -from:${P.email}`, maxResults: 10 }).catch((err) => {
      logger.warn('[persona-email] list failed', { persona, err: String(err) });
      return null;
    });
    for (const item of list?.data.messages ?? []) {
      if (!item.id) continue;
      const ledger = db().collection(EMAIL_LEDGER).doc(`${persona}__${item.id}`);
      const msg = (await gmail.users.messages.get({ userId: 'me', id: item.id, format: 'full' })).data;
      const fromHeader = messageHeader(msg, 'From');
      const fromEmail = (fromHeader.match(/<([^>]+)>/)?.[1] ?? fromHeader).trim().toLowerCase();
      const staff = dir.byEmail[fromEmail];
      if (!staff) continue; // not staff — stays unread for a human
      try {
        await ledger.create({ persona, messageId: item.id, threadId: msg.threadId ?? null, from: fromEmail, status: 'answering', createdAt: admin.firestore.FieldValue.serverTimestamp() });
      } catch {
        continue; // another tick has it
      }
      try {
        const thread = msg.threadId ? (await gmail.users.threads.get({ userId: 'me', id: msg.threadId, format: 'full' })).data : { messages: [msg] };
        const history = (thread.messages ?? [])
          .filter((m) => m.id !== item.id && Number(m.internalDate ?? 0) <= Number(msg.internalDate ?? 0))
          .map((m) => emailTurn(m, P.email, persona, helpers))
          .filter((t) => t.text)
          .slice(-MAX_TURNS);
        const subject = repairMojibake(messageHeader(msg, 'Subject')) || '(no subject)';
        const turn: NatalieTurn = { role: 'user', text: `Subject: ${subject}\n\n${messagePlainText(msg)}`, by: staff.slackUserId || staff.uid, byName: staff.firstName, ts: String(Number(msg.internalDate ?? 0) / 1000) };
        const ans = await answerAsNatalie({
          history, message: turn, surface: 'email', marcoLive: runtime.marcoEnabled,
          ctx: { tenantId: TENANT, askedBySlackUserId: staff.slackUserId || '', askedByName: staff.firstName, persona },
        });
        const sent = await sendEmail(TENANT, { to: fromEmail, subject: normalizeReplySubject(subject), body: toEmailText(ans.text), threadId: msg.threadId ?? undefined, inReplyToMessageId: item.id }, persona);
        await gmail.users.messages.modify({ userId: 'me', id: item.id, requestBody: { removeLabelIds: ['UNREAD'] } }).catch(() => undefined);
        await ledger.update({ status: sent.sent ? 'answered' : 'send_failed', sendError: sent.error ?? null, tools: ans.toolCalls.map((t) => t.name), answeredAt: admin.firestore.FieldValue.serverTimestamp() });
        if (sent.sent) answered += 1;
        logger.info('[persona-email] answered', { persona, staff: staff.uid, tools: ans.toolCalls.map((t) => t.name), sent: sent.sent });
      } catch (err) {
        logger.error('[persona-email] answer failed', { persona, err: err instanceof Error ? err.message : String(err) });
        await ledger.update({ status: 'failed', lastError: String(err).slice(0, 300) }).catch(() => undefined);
      }
    }
  }
  return answered;
}
