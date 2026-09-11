/**
 * Deborah Waltermyer's Gmail (d.waltermyer@c1staffing.com) — Sodexo
 * account owner (Greg 2026-09-11).
 *
 * Same tenant-level grant shape as the Natalie / sales-outreach mailboxes
 * (tenants/{t}/integrations/deborahMailbox { connected, email,
 * gmailTokens.refresh_token }), obtained once by opening the consent URL
 * while signed into Google as Deborah. The shared gmailOAuthCallback HTTP
 * handler routes state.purpose === 'deborahMailbox' here. Deliberately NOT
 * users/{uid}.gmailTokens — that's her per-recruiter connection, which this
 * must never clobber.
 *
 * Consumer: sodexoContactIntro (intro + 48h no-reply follow-up to a new
 * Sodexo job order's contact, sent AS Deborah so replies land in her
 * inbox). The consent URL is minted from functions/.scratch/deborah-mailbox.ts
 * — no callable (Cloud Run service cap).
 */
import * as admin from 'firebase-admin';
import { google, type gmail_v1 } from 'googleapis';
import { defineString } from 'firebase-functions/params';
import type { Response } from 'express';
import { logger } from 'firebase-functions/v2';
import { buildMimeMessage } from './mimeHeaders';
import { composeEmailWithSignature } from './gmailSignature';
import type { MailSummary } from './sodexoContactIntroRules';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const DEBORAH_EMAIL = 'd.waltermyer@c1staffing.com';
export const DEBORAH_NAME = 'Deborah Waltermyer';
const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');
const redirectUri = defineString('GOOGLE_REDIRECT_URI');
export const DEBORAH_GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  // Read-only: prior-correspondence check before the intro, reply/bounce
  // detection before the follow-up.
  'https://www.googleapis.com/auth/gmail.readonly',
];

const trim = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
export const deborahMailboxRef = (tenantId: string) => db.doc(`tenants/${tenantId}/integrations/deborahMailbox`);

function newOAuthClient(creds?: { clientId: string; clientSecret: string; redirectUri: string }) {
  return creds
    ? new google.auth.OAuth2(creds.clientId, creds.clientSecret, creds.redirectUri)
    : new google.auth.OAuth2(clientId.value(), clientSecret.value(), redirectUri.value());
}

/**
 * Consent URL for Deborah (or Greg in a window signed in as Deborah).
 * `creds` lets the scratch script mint it outside the functions runtime.
 */
export function deborahMailboxAuthUrl(
  tenantId: string,
  connectedBy: string,
  creds?: { clientId: string; clientSecret: string; redirectUri: string },
): string {
  return newOAuthClient(creds).generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: DEBORAH_GMAIL_SCOPES,
    login_hint: DEBORAH_EMAIL,
    state: JSON.stringify({ purpose: 'deborahMailbox', tenantId, connectedBy }),
  });
}

/** Branch of the shared gmailOAuthCallback HTTP handler. */
export async function handleDeborahMailboxOAuth(
  code: string,
  state: { tenantId?: string; connectedBy?: string },
  res: Response,
): Promise<void> {
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
    if (email !== DEBORAH_EMAIL) {
      res
        .status(400)
        .send(
          page(
            'Wrong Google account',
            `This connect is for <b>${DEBORAH_EMAIL}</b>, but you authorized <b>${email || 'an unknown account'}</b>. Nothing was saved — open the link in a window signed in as Deborah.`,
          ),
        );
      return;
    }
    if (!tokens.refresh_token) {
      res
        .status(400)
        .send(
          page(
            'No refresh token',
            'Google did not return a refresh token. Remove the app at myaccount.google.com/permissions for Deborah and try the link again.',
          ),
        );
      return;
    }
    await deborahMailboxRef(tenantId).set(
      {
        connected: true,
        email,
        gmailTokens: { refresh_token: tokens.refresh_token, email },
        connectedBy: trim(state.connectedBy) || null,
        connectedAt: admin.firestore.FieldValue.serverTimestamp(),
        scopes: DEBORAH_GMAIL_SCOPES,
      },
      { merge: true },
    );
    logger.info('[deborahMailbox] connected', { tenantId, email });
    res.status(200).send(page("Deborah's mailbox is connected", `HRX can now send as <b>${email}</b>.`));
  } catch (err) {
    logger.error('[deborahMailbox] OAuth failed', { err: err instanceof Error ? err.message : String(err) });
    res.status(500).send(page('Connection failed', 'Something went wrong storing the grant. Check the function logs.'));
  }
}

export async function deborahGmail(tenantId: string): Promise<gmail_v1.Gmail | null> {
  const cfg = (await deborahMailboxRef(tenantId).get()).data() ?? {};
  const rt = trim((cfg.gmailTokens as Record<string, unknown> | undefined)?.refresh_token);
  if (cfg.connected !== true || !rt) return null;
  const oauth2 = newOAuthClient();
  oauth2.setCredentials({ refresh_token: rt });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

function header(msg: gmail_v1.Schema$Message, name: string): string {
  return msg.payload?.headers?.find((h) => (h.name ?? '').toLowerCase() === name.toLowerCase())?.value ?? '';
}

const searchAddr = (email: string) => email.replace(/[\s"()]/g, '');

/** True when Deborah's mailbox already has any mail from or to `email`. */
export async function deborahHasCorrespondedWith(gmail: gmail_v1.Gmail, email: string): Promise<boolean> {
  const addr = searchAddr(email);
  const list = await gmail.users.messages.list({
    userId: 'me',
    q: `from:${addr} OR to:${addr}`,
    maxResults: 1,
    includeSpamTrash: false,
  });
  return (list.data.messages ?? []).length > 0;
}

/**
 * Used only when her Gmail signature can't be read or is empty — mirrors
 * the signature on her own mail as of 2026-09-11 (minus the logo).
 */
export const DEBORAH_FALLBACK_SIGNATURE_HTML =
  '<b>Deborah Waltermyer</b><br>National Recruiter<br>714-371-6566 (M)<br>' +
  '<a href="mailto:d.waltermyer@c1staffing.com">d.waltermyer@c1staffing.com</a><br>' +
  '<a href="https://www.c1staffing.com">www.c1staffing.com</a>';

/** Her real Gmail signature (HTML, logo included), or null when unset/unreadable. */
export async function deborahSignatureHtml(gmail: gmail_v1.Gmail): Promise<string | null> {
  try {
    const res = await gmail.users.settings.sendAs.get({ userId: 'me', sendAsEmail: DEBORAH_EMAIL });
    return trim(res.data.signature) || null;
  } catch (err) {
    logger.warn('[deborahMailbox] signature read failed', { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Send as Deborah: the template body (ending at the sign-off) + her real
 * Gmail signature, read at send time so signature edits in Gmail carry
 * over. Pass threadId + inReplyTo/references to reply inside a thread.
 */
export async function sendAsDeborah(
  gmail: gmail_v1.Gmail,
  input: {
    to: string;
    subject: string;
    body: string;
    threadId?: string | null;
    inReplyTo?: string | null;
    references?: string | null;
  },
): Promise<{ messageId: string | null; threadId: string | null; rfcMessageId: string | null; signatureSource: 'gmail' | 'fallback' }> {
  const gmailSignature = await deborahSignatureHtml(gmail);
  const signatureSource = gmailSignature ? 'gmail' : 'fallback';
  if (!gmailSignature) logger.warn('[deborahMailbox] no Gmail signature — using fallback signature');
  const composed = composeEmailWithSignature(input.body, gmailSignature ?? DEBORAH_FALLBACK_SIGNATURE_HTML);
  const raw = buildMimeMessage({
    fromName: DEBORAH_NAME,
    fromEmail: DEBORAH_EMAIL,
    to: input.to,
    subject: input.subject,
    body: composed.text,
    html: composed.html,
    inReplyTo: input.inReplyTo ?? undefined,
    references: input.references ?? undefined,
  });
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw, ...(input.threadId ? { threadId: input.threadId } : {}) },
  });
  const messageId = res.data.id ?? null;
  let rfcMessageId: string | null = null;
  if (messageId) {
    try {
      const sent = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'metadata', metadataHeaders: ['Message-ID'] });
      rfcMessageId = header(sent.data, 'Message-ID') || null;
    } catch {
      /* the follow-up still threads by threadId */
    }
  }
  return { messageId, threadId: res.data.threadId ?? null, rfcMessageId, signatureSource };
}

const SUMMARY_HEADERS = ['From', 'To', 'Cc', 'Subject', 'Auto-Submitted', 'X-Autoreply'];

function toSummary(m: gmail_v1.Schema$Message): MailSummary {
  const autoSubmitted = header(m, 'Auto-Submitted').toLowerCase();
  return {
    id: m.id ?? '',
    from: header(m, 'From'),
    to: `${header(m, 'To')} ${header(m, 'Cc')}`.trim(),
    internalDateMs: Number(m.internalDate) || 0,
    autoReply:
      (autoSubmitted !== '' && autoSubmitted !== 'no') ||
      Boolean(header(m, 'X-Autoreply')) ||
      /^(automatic reply|auto[- ]?reply|out of (the )?office)/i.test(header(m, 'Subject')),
  };
}

/**
 * Mail involving the contact since the intro went out: every message in
 * the intro's thread, plus anything from/to them — or a bounce naming
 * them — outside it.
 */
export async function deborahMailSince(
  gmail: gmail_v1.Gmail,
  p: { email: string; threadId: string | null; sinceMs: number },
): Promise<MailSummary[]> {
  const byId = new Map<string, MailSummary>();
  if (p.threadId) {
    const thread = await gmail.users.threads.get({ userId: 'me', id: p.threadId, format: 'metadata', metadataHeaders: SUMMARY_HEADERS });
    for (const m of thread.data.messages ?? []) if (m.id) byId.set(m.id, toSummary(m));
  }
  const addr = searchAddr(p.email);
  const after = Math.floor(p.sinceMs / 1000) - 60;
  const list = await gmail.users.messages.list({
    userId: 'me',
    q: `(from:${addr} OR to:${addr} OR ((from:mailer-daemon OR from:postmaster) "${addr}")) after:${after}`,
    maxResults: 20,
  });
  for (const m of list.data.messages ?? []) {
    if (!m.id || byId.has(m.id)) continue;
    const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: SUMMARY_HEADERS });
    byId.set(m.id, toSummary(full.data));
  }
  return [...byId.values()];
}
