/**
 * Persona Gmail — Natalie (n.brooks@c1staffing.com, roadmap Phase 4) and Marco
 * (m.gomez@c1staffing.com, 2026-09-11; personas.ts).
 *
 * Same tenant-level grant shape as the sales-outreach mailbox
 * (tenants/{t}/integrations/{natalieMailbox|marcoMailbox} { connected,
 * gmailTokens.refresh_token, email }), obtained once by opening the consent URL
 * while signed into Google as the persona. The shared gmailOAuthCallback HTTP
 * handler routes state.purpose === 'natalieMailbox' / 'marcoMailbox' here.
 *
 * Tools built on it: read_inbox (recent threads, who/what/needs-reply) and
 * send_email (as the persona, only when a recruiter explicitly asks). The
 * morning brief lists unread threads that look like they need a human.
 */
import * as admin from 'firebase-admin';
import { google, type gmail_v1 } from 'googleapis';
import { defineString } from 'firebase-functions/params';
import type { Response } from 'express';
import { logger } from 'firebase-functions/v2';
import { PERSONAS, type PersonaId } from './personas';
import { buildMimeMessage, repairMojibake } from '../sales/mimeHeaders';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const NATALIE_EMAIL = PERSONAS.natalie.email;
const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');
const redirectUri = defineString('GOOGLE_REDIRECT_URI');
export const NATALIE_GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
];
/** Marco also gets settings.basic so his Gmail signature can be set by API (Natalie's was set in the UI). */
export const PERSONA_GMAIL_SCOPES: Record<PersonaId, string[]> = {
  natalie: NATALIE_GMAIL_SCOPES,
  marco: [...NATALIE_GMAIL_SCOPES, 'https://www.googleapis.com/auth/gmail.settings.basic'],
};
/** OAuth state.purpose and the integrations doc id. */
export const MAILBOX_PURPOSE: Record<PersonaId, string> = { natalie: 'natalieMailbox', marco: 'marcoMailbox' };

const trim = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
export const mailboxRef = (tenantId: string, persona: PersonaId = 'natalie') => db.doc(`tenants/${tenantId}/integrations/${MAILBOX_PURPOSE[persona]}`);

function newOAuthClient() {
  return new google.auth.OAuth2(clientId.value(), clientSecret.value(), redirectUri.value());
}

/** Consent URL for Greg to open while signed into Google as the persona. */
export function personaMailboxAuthUrl(persona: PersonaId, tenantId: string, connectedBy: string): string {
  return newOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: PERSONA_GMAIL_SCOPES[persona],
    login_hint: PERSONAS[persona].email,
    state: JSON.stringify({ purpose: MAILBOX_PURPOSE[persona], tenantId, connectedBy }),
  });
}

export function natalieMailboxAuthUrl(tenantId: string, connectedBy: string): string {
  return personaMailboxAuthUrl('natalie', tenantId, connectedBy);
}

/** Branch of the shared gmailOAuthCallback HTTP handler. */
export async function handlePersonaMailboxOAuth(persona: PersonaId, code: string, state: { tenantId?: string; connectedBy?: string }, res: Response): Promise<void> {
  const P = PERSONAS[persona];
  const page = (title: string, body: string) =>
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family: Arial, sans-serif; padding: 24px;"><h1>${title}</h1><p>${body}</p><p>You can close this window.</p></body></html>`;
  try {
    const tenantId = trim(state.tenantId);
    if (!tenantId) {
      res.status(400).send(page('Connection failed', 'Missing tenant in OAuth state.'));
      return;
    }
    const oauth2 = newOAuthClient();
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const email = trim(profile.data.emailAddress).toLowerCase();
    if (email !== P.email) {
      res.status(400).send(page('Wrong Google account', `This connect is for <b>${P.email}</b>, but you authorized <b>${email || 'an unknown account'}</b>. Nothing was saved — open the link in a window signed in as ${P.firstName}.`));
      return;
    }
    if (!tokens.refresh_token) {
      res.status(400).send(page('No refresh token', `Google did not return a refresh token. Remove the app at myaccount.google.com/permissions for ${P.firstName} and try the link again.`));
      return;
    }
    await mailboxRef(tenantId, persona).set(
      {
        connected: true,
        email,
        gmailTokens: { refresh_token: tokens.refresh_token, email },
        connectedBy: trim(state.connectedBy) || null,
        connectedAt: admin.firestore.FieldValue.serverTimestamp(),
        scopes: PERSONA_GMAIL_SCOPES[persona],
      },
      { merge: true },
    );
    res.status(200).send(page(`${P.firstName}'s mailbox is connected`, `HRX can now read and send as <b>${email}</b>.`));
  } catch (err) {
    logger.error(`[${persona}] mailbox OAuth failed`, { err: err instanceof Error ? err.message : String(err) });
    res.status(500).send(page('Connection failed', 'Something went wrong storing the grant. Check the function logs.'));
  }
}

export async function handleNatalieMailboxOAuth(code: string, state: { tenantId?: string; connectedBy?: string }, res: Response): Promise<void> {
  return handlePersonaMailboxOAuth('natalie', code, state, res);
}

export async function personaGmail(persona: PersonaId, tenantId: string): Promise<gmail_v1.Gmail | null> {
  const cfg = (await mailboxRef(tenantId, persona).get()).data() ?? {};
  const rt = trim((cfg.gmailTokens as Record<string, unknown> | undefined)?.refresh_token);
  if (cfg.connected !== true || !rt) return null;
  const oauth2 = newOAuthClient();
  oauth2.setCredentials({ refresh_token: rt });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

export async function natalieGmail(tenantId: string): Promise<gmail_v1.Gmail | null> {
  return personaGmail('natalie', tenantId);
}

function header(msg: gmail_v1.Schema$Message, name: string): string {
  return msg.payload?.headers?.find((h) => (h.name ?? '').toLowerCase() === name.toLowerCase())?.value ?? '';
}

function plainText(msg: gmail_v1.Schema$Message): string {
  const decode = (data?: string | null) => (data ? Buffer.from(data, 'base64').toString('utf8') : '');
  const walk = (p?: gmail_v1.Schema$MessagePart): string => {
    if (!p) return '';
    if (p.mimeType === 'text/plain' && p.body?.data) return decode(p.body.data);
    for (const c of p.parts ?? []) {
      const t = walk(c);
      if (t) return t;
    }
    return '';
  };
  const raw = walk(msg.payload) || trim(msg.snippet);
  const cut = raw.search(/\r?\n\s*(>|On .{5,80} wrote:|-{4,}\s*Original Message)/i);
  return (cut > 0 ? raw.slice(0, cut) : raw).trim().slice(0, 1500);
}

/** For personaConversations (staff email threads). */
export const messageHeader = header;
export const messagePlainText = plainText;

const AUTOMATED_SENDER = /noreply|no-reply|notifications?@|donotreply|mailer-daemon|fieldglass\.net|indeedflex\.com|@indeed\.com/i;

export interface InboxItem {
  threadId: string;
  messageId: string;
  from: string;
  subject: string;
  date: string;
  unread: boolean;
  automated: boolean;
  preview: string;
}

/** Recent inbox threads (newest first). `query` is Gmail search syntax. */
export async function readInbox(tenantId: string, opts: { query?: string; max?: number; persona?: PersonaId } = {}): Promise<{ connected: boolean; items: InboxItem[] }> {
  const gmail = await personaGmail(opts.persona ?? 'natalie', tenantId);
  if (!gmail) return { connected: false, items: [] };
  const list = await gmail.users.messages.list({ userId: 'me', q: opts.query || 'in:inbox newer_than:3d', maxResults: Math.min(opts.max ?? 15, 40) });
  const items: InboxItem[] = [];
  const seenThreads = new Set<string>();
  for (const m of list.data.messages ?? []) {
    if (!m.id) continue;
    const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
    const d = full.data;
    if (d.threadId && seenThreads.has(d.threadId)) continue;
    if (d.threadId) seenThreads.add(d.threadId);
    const from = header(d, 'From');
    items.push({
      threadId: d.threadId ?? '',
      messageId: d.id ?? m.id,
      from,
      subject: repairMojibake(header(d, 'Subject')) || '(no subject)',
      date: header(d, 'Date'),
      unread: (d.labelIds ?? []).includes('UNREAD'),
      automated: AUTOMATED_SENDER.test(from),
      preview: plainText(d).slice(0, 400),
    });
  }
  return { connected: true, items };
}

/**
 * Pure: the Gmail `raw` payload for a persona email. Goes through buildMimeMessage (RFC 2047 encoded Subject and
 * From name, CRLF) — the hand-rolled `Subject: ${subject}` it replaces shipped raw UTF-8 in the header, so an em
 * dash reached people as "Ã¢Â€Â”" and every reply re-garbled it (docs/claude/feedback_email_header_encoding.md).
 */
export function composePersonaEmailRaw(persona: PersonaId, input: { to: string; subject: string; body: string }, threading: { inReplyTo?: string; references?: string } = {}): string {
  const P = PERSONAS[persona];
  return buildMimeMessage({
    fromName: P.displayName,
    fromEmail: P.email,
    to: input.to,
    subject: repairMojibake(input.subject),
    body: `${input.body.trim()}\n\n—\n${P.displayName}\n${P.title}, C1 Staffing\n${P.email}`,
    inReplyTo: threading.inReplyTo,
    references: threading.references,
  });
}

/** Send (or reply, when threadId + inReplyTo are given) as the persona. */
export async function sendEmail(tenantId: string, input: { to: string; subject: string; body: string; threadId?: string; inReplyToMessageId?: string }, persona: PersonaId = 'natalie'): Promise<{ sent: boolean; messageId?: string; error?: string }> {
  const P = PERSONAS[persona];
  const gmail = await personaGmail(persona, tenantId);
  if (!gmail) return { sent: false, error: `${P.firstName}'s mailbox is not connected yet` };
  const threading: { inReplyTo?: string; references?: string } = {};
  if (input.inReplyToMessageId) {
    try {
      const orig = await gmail.users.messages.get({ userId: 'me', id: input.inReplyToMessageId, format: 'metadata', metadataHeaders: ['Message-ID', 'References'] });
      const mid = header(orig.data, 'Message-ID');
      const prior = header(orig.data, 'References');
      if (mid) {
        threading.inReplyTo = mid;
        threading.references = [prior, mid].filter(Boolean).join(' ');
      }
    } catch {
      /* send without threading headers */
    }
  }
  const raw = composePersonaEmailRaw(persona, input, threading);
  try {
    const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw, ...(input.threadId ? { threadId: input.threadId } : {}) } });
    return { sent: true, messageId: res.data.id ?? undefined };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}
