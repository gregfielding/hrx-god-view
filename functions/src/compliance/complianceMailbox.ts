/**
 * Compliance mailbox intake (Migration Plan P4, 2026-07-14).
 *
 * The shared compliance@c1staffing.com mailbox receives candidate replies
 * to adverse-action notices (notices themselves go out via SendGrid). This
 * module connects that ONE mailbox at the tenant level and polls it:
 *
 *  - getComplianceGmailAuthUrl — compliance-gated callable returning a
 *    Google consent URL (gmail.readonly only — least privilege; we never
 *    send from Gmail). State carries purpose:'complianceMailbox' so the
 *    shared gmailOAuthCallback routes here instead of users/{uid}.
 *  - handleComplianceMailboxOAuth — callback branch: exchanges the code,
 *    REFUSES any Google account other than the expected mailbox address,
 *    and stores tokens on tenants/{tid}/integrations/complianceMailbox
 *    (deliberately NOT users/{uid}.gmailTokens, which is a per-recruiter
 *    connection this must never clobber).
 *  - complianceMailboxIntakeCron — every 10 minutes: new inbound mail is
 *    matched by sender address against open adjudication cases. A match
 *    flips awaiting_candidate/window_expired → candidate_responded (the
 *    FCRA failure this exists to prevent is deciding while a response
 *    sits unread), appends the audit event with a body excerpt, files the
 *    email + attachments into the Drive case folder, flags dispute
 *    language, and notifies the compliance reviewers. Unmatched human
 *    mail gets a content-light reviewer nudge. A Firestore ledger
 *    (processedMessages subcollection) makes every message exactly-once.
 *
 * Reviewers keep the judgment; this guarantees visibility + paper trail.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { google } from 'googleapis';
import type { Response } from 'express';
import { ensureAccusourceComplianceReviewer } from '../integrations/accusource/accusourceAdminGate';
import { accusourceLog } from '../integrations/accusource/accusourceLogger';
import { appendCaseEvent, type AdjudicationCaseStatus } from './adjudicationCases';
import { notifyComplianceReviewers } from './adjudicationNotices';
import { uploadToCaseFolder } from './driveCaseFolders';
import { writeWorkerActivityLog } from './workerActivityLog';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');
const redirectUri = defineString('GOOGLE_REDIRECT_URI');

const DEFAULT_MAILBOX = 'compliance@c1staffing.com';
/** Read-only: intake never sends or modifies mail (outbound is SendGrid). */
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
/** Statuses a candidate reply is relevant to (includes 'open' for
 *  proactive mail before the pre-adverse notice goes out). */
const MATCHABLE_STATUSES: AdjudicationCaseStatus[] = [
  'open',
  'awaiting_candidate',
  'candidate_responded',
  'disputed',
  'window_expired',
];
const DISPUTE_KEYWORDS = [
  'dispute', 'disput', 'inaccurate', 'incorrect', 'not mine', 'wrong person',
  'never convicted', 'expunged', 'sealed', 'identity theft', 'mistake',
  'no es mío', 'no es mio', 'incorrecto', 'equivocado', 'robo de identidad',
];
const MAX_MESSAGES_PER_POLL = 50;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const BODY_EXCERPT_CHARS = 1500;

function trim(v: unknown): string {
  return String(v ?? '').trim();
}

function newOAuthClient() {
  return new google.auth.OAuth2(clientId.value(), clientSecret.value(), redirectUri.value());
}

function mailboxCfgRef(tenantId: string) {
  return db.doc(`tenants/${tenantId}/integrations/complianceMailbox`);
}

function decodeB64Url(data?: string | null): Buffer {
  if (!data) return Buffer.alloc(0);
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function headerValue(payload: any, name: string): string {
  const headers: Array<{ name?: string; value?: string }> = payload?.headers ?? [];
  return trim(headers.find((h) => trim(h.name).toLowerCase() === name.toLowerCase())?.value);
}

function senderEmailOf(fromHeader: string): string {
  const m = fromHeader.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  return (m?.[1] ?? '').toLowerCase();
}

function isSystemSender(email: string): boolean {
  const local = email.split('@')[0] ?? '';
  return /no-?reply|mailer-daemon|postmaster|notifications?$|donotreply/.test(local);
}

function collectParts(payload: any, out: any[] = []): any[] {
  if (!payload) return out;
  out.push(payload);
  for (const p of Array.isArray(payload.parts) ? payload.parts : []) collectParts(p, out);
  return out;
}

function plainBodyOf(message: any): string {
  const parts = collectParts(message?.payload);
  const plain = parts.find((p) => p.mimeType === 'text/plain' && p.body?.data);
  if (plain) return decodeB64Url(plain.body.data).toString('utf8');
  const html = parts.find((p) => p.mimeType === 'text/html' && p.body?.data);
  if (html) {
    return decodeB64Url(html.body.data)
      .toString('utf8')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return trim(message?.snippet);
}

function hasDisputeLanguage(text: string): boolean {
  const hay = text.toLowerCase();
  return DISPUTE_KEYWORDS.some((k) => hay.includes(k));
}

// ─────────────────────────────────────────────────────────────────────
// Connect: consent URL + OAuth callback branch
// ─────────────────────────────────────────────────────────────────────

export const getComplianceGmailAuthUrl = onCall({ cors: true }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const tenantId = trim((request.data as Record<string, unknown>)?.tenantId);
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
  await ensureAccusourceComplianceReviewer(uid, request.auth?.token as never, tenantId, 'compliance_mailbox_connect');

  const cfg = (await mailboxCfgRef(tenantId).get()).data() ?? {};
  const expectedEmail = trim(cfg.expectedEmail).toLowerCase() || DEFAULT_MAILBOX;
  const authUrl = newOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    login_hint: expectedEmail,
    state: JSON.stringify({ purpose: 'complianceMailbox', tenantId, connectedBy: uid }),
  });
  return { authUrl, expectedEmail };
});

/**
 * Branch of the shared gmailOAuthCallback HTTP handler (the OAuth client's
 * registered redirect URI is fixed, so all Google callbacks land there).
 */
export async function handleComplianceMailboxOAuth(
  code: string,
  state: { tenantId?: string; connectedBy?: string },
  res: Response,
): Promise<void> {
  const page = (title: string, body: string, notify: boolean) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family: Arial, sans-serif; padding: 24px;">
<h1>${title}</h1><p>${body}</p><p>You can close this window.</p>
${notify ? `<script>if (window.opener && typeof window.opener.postMessage === 'function') { window.opener.postMessage({ type: 'google-auth-success' }, '*'); }</script>` : ''}
</body></html>`;

  try {
    const tenantId = trim(state.tenantId);
    if (!tenantId) {
      res.status(400).send(page('Connection failed', 'Missing tenant in OAuth state.', false));
      return;
    }
    const oauth2 = newOAuthClient();
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const email = trim(profile.data.emailAddress).toLowerCase();

    const cfgRef = mailboxCfgRef(tenantId);
    const cfg = (await cfgRef.get()).data() ?? {};
    const expectedEmail = trim(cfg.expectedEmail).toLowerCase() || DEFAULT_MAILBOX;
    if (!email || email !== expectedEmail) {
      // Strict: connecting a personal account here would silently route
      // candidate-response intake through the wrong inbox.
      res.status(400).send(page(
        'Wrong Google account',
        `This connect is for <b>${expectedEmail}</b>, but you authorized <b>${email || 'an unknown account'}</b>. ` +
          'Nothing was saved — sign into the compliance mailbox in this browser and try again.',
        false,
      ));
      return;
    }
    if (!tokens.refresh_token) {
      res.status(400).send(page(
        'Connection incomplete',
        'Google did not return a refresh token — close this window and click Connect again (the retry re-prompts consent, which forces one).',
        false,
      ));
      return;
    }

    await cfgRef.set(
      {
        gmailTokens: {
          access_token: tokens.access_token ?? null,
          refresh_token: tokens.refresh_token,
          scope: tokens.scope ?? SCOPES.join(' '),
          token_type: tokens.token_type ?? 'Bearer',
          expiry_date: tokens.expiry_date ?? null,
          email,
        },
        expectedEmail,
        connected: true,
        connectedAt: admin.firestore.FieldValue.serverTimestamp(),
        connectedBy: trim(state.connectedBy) || null,
        tokenError: null,
      },
      { merge: true },
    );
    accusourceLog('info', 'mailbox', 'Compliance mailbox connected', {
      tenantId,
      email,
      by: trim(state.connectedBy),
    });
    res.status(200).send(page(
      'Compliance mailbox connected',
      `<b>${email}</b> is connected (read-only). Candidate replies will now be matched to adjudication cases automatically.`,
      true,
    ));
  } catch (err) {
    logger.error('[complianceMailbox] OAuth callback failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    res.status(500).send(page('Connection failed', 'Could not complete the Google connection — close this window and try again.', false));
  }
}

export const getComplianceMailboxStatus = onCall({ cors: true }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const tenantId = trim((request.data as Record<string, unknown>)?.tenantId);
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
  await ensureAccusourceComplianceReviewer(uid, request.auth?.token as never, tenantId, 'compliance_mailbox_status');

  const cfg = (await mailboxCfgRef(tenantId).get()).data() ?? {};
  const ts = (v: unknown) => (v instanceof admin.firestore.Timestamp ? v.toMillis() : null);
  return {
    connected: cfg.connected === true,
    email: trim((cfg.gmailTokens as Record<string, unknown> | undefined)?.email) || null,
    expectedEmail: trim(cfg.expectedEmail) || DEFAULT_MAILBOX,
    connectedAt: ts(cfg.connectedAt),
    lastPollAt: ts(cfg.lastPollAt),
    lastPollProcessed: Number(cfg.lastPollProcessed ?? 0),
    lastPollMatched: Number(cfg.lastPollMatched ?? 0),
    tokenError: trim(cfg.tokenError) || null,
  };
});

// ─────────────────────────────────────────────────────────────────────
// Intake cron
// ─────────────────────────────────────────────────────────────────────

interface CaseMatch {
  ref: FirebaseFirestore.DocumentReference;
  caseId: string;
  data: Record<string, unknown>;
  candidateEmail: string;
}

/** email → most relevant open case (open cases per tenant are a handful). */
async function loadMatchableCases(tenantId: string): Promise<Map<string, CaseMatch>> {
  const snap = await db
    .collection(`tenants/${tenantId}/adjudication_cases`)
    .where('status', 'in', MATCHABLE_STATUSES)
    .get();
  const out = new Map<string, CaseMatch>();
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const notices = Array.isArray(data.notices) ? (data.notices as Array<Record<string, unknown>>) : [];
    let email = trim(notices[notices.length - 1]?.emailTo).toLowerCase();
    if (!email) {
      const u = (await db.collection('users').doc(trim(data.candidateId)).get()).data() ?? {};
      email = trim((u as Record<string, unknown>).email).toLowerCase();
    }
    if (!email) continue;
    // Prefer the case actively waiting on the candidate if two share an email.
    const existing = out.get(email);
    if (!existing || trim(data.status) === 'awaiting_candidate') {
      out.set(email, { ref: doc.ref, caseId: doc.id, data, candidateEmail: email });
    }
  }
  return out;
}

async function fileInboundToDrive(
  gmail: ReturnType<typeof google.gmail>,
  message: any,
  match: CaseMatch,
  meta: { senderEmail: string; subject: string; bodyText: string },
): Promise<{ filedNames: string[]; driveFiled: boolean }> {
  const driveFolderId = trim(match.data.driveFolderId);
  const filedNames: string[] = [];
  if (!driveFolderId) return { filedNames, driveFiled: false };

  const stamp = new Date(Number(message.internalDate) || Date.now()).toISOString().slice(0, 10);
  const emailFileId = await uploadToCaseFolder({
    folderId: driveFolderId,
    name: `inbound-${stamp}-${trim(message.id)}.txt`,
    content: `From: ${meta.senderEmail}\nSubject: ${meta.subject}\nGmail message id: ${trim(message.id)}\nReceived: ${new Date(Number(message.internalDate) || Date.now()).toISOString()}\n\n${meta.bodyText}`,
    mimeType: 'text/plain',
  });
  if (emailFileId) filedNames.push('email body');

  let budget = MAX_ATTACHMENT_BYTES;
  for (const part of collectParts(message.payload)) {
    const filename = trim(part.filename);
    const attachmentId = trim(part.body?.attachmentId);
    if (!filename || !attachmentId) continue;
    const size = Number(part.body?.size ?? 0);
    if (size > budget) {
      logger.warn('[complianceMailbox] attachment skipped (size budget)', { filename, size });
      continue;
    }
    try {
      const att = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: trim(message.id),
        id: attachmentId,
      });
      const buf = decodeB64Url(att.data.data);
      budget -= buf.length;
      const fileId = await uploadToCaseFolder({
        folderId: driveFolderId,
        name: `inbound-${stamp}-${filename}`,
        content: buf,
        mimeType: trim(part.mimeType) || 'application/octet-stream',
      });
      if (fileId) filedNames.push(filename);
    } catch (err) {
      logger.warn('[complianceMailbox] attachment filing failed', {
        filename,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { filedNames, driveFiled: filedNames.length > 0 };
}

async function processMessage(
  tenantId: string,
  gmail: ReturnType<typeof google.gmail>,
  messageId: string,
  selfEmail: string,
  cases: Map<string, CaseMatch>,
): Promise<string> {
  const full = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const message = full.data as any;
  const senderEmail = senderEmailOf(headerValue(message.payload, 'From'));
  const subject = headerValue(message.payload, 'Subject') || '(no subject)';

  if (!senderEmail || senderEmail === selfEmail) return 'self';

  const match = cases.get(senderEmail);
  if (!match) {
    if (isSystemSender(senderEmail)) return 'skipped_system';
    await notifyComplianceReviewers(
      tenantId,
      'Compliance inbox: new mail',
      `From ${senderEmail}: "${subject}" — no matching adjudication case; review it in the compliance inbox.`,
      '',
      '',
    ).catch(() => undefined);
    return 'unmatched';
  }

  const bodyText = plainBodyOf(message);
  const disputeDetected = hasDisputeLanguage(`${subject}\n${bodyText}`);
  const statusBefore = trim(match.data.status) as AdjudicationCaseStatus;
  const flipsToResponded = statusBefore === 'awaiting_candidate' || statusBefore === 'window_expired';
  const statusAfter: AdjudicationCaseStatus = flipsToResponded ? 'candidate_responded' : statusBefore;

  const patch: Record<string, unknown> = {
    lastInboundEmailAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (flipsToResponded) {
    patch.status = statusAfter;
    patch.candidateRespondedAt = admin.firestore.FieldValue.serverTimestamp();
  }
  if (disputeDetected) patch.disputeLanguageDetected = true;
  await match.ref.update(patch);
  if (flipsToResponded) match.data.status = statusAfter;

  const filed = await fileInboundToDrive(gmail, message, match, { senderEmail, subject, bodyText });

  await appendCaseEvent(match.ref, 'system', 'candidate_email_received', {
    gmailMessageId: messageId,
    from: senderEmail,
    subject,
    bodyExcerpt: bodyText.slice(0, BODY_EXCERPT_CHARS),
    attachmentsFiled: filed.filedNames,
    driveFiled: filed.driveFiled,
    disputeLanguageDetected: disputeDetected,
    statusBefore,
    statusAfter,
  });

  const candidateId = trim(match.data.candidateId);
  const candidateName = trim(match.data.candidateName) || senderEmail;
  await writeWorkerActivityLog({
    userId: candidateId,
    action: 'adjudication_candidate_reply_received',
    description: `Candidate replied to the compliance mailbox ("${subject}")`,
    severity: 'medium',
    metadata: { caseId: match.caseId, gmailMessageId: messageId, disputeLanguageDetected: disputeDetected },
  }).catch(() => undefined);

  const disputeNote = disputeDetected
    ? ' Possible dispute language detected — if they are disputing report accuracy, open a dispute on the case (stops the clock).'
    : '';
  const lateNote = statusBefore === 'window_expired' ? ' (response arrived after the window expired)' : '';
  await notifyComplianceReviewers(
    tenantId,
    'Candidate responded',
    `${candidateName} replied to the compliance mailbox${lateNote}: "${subject}".${disputeNote}`,
    match.caseId,
    candidateId,
  ).catch(() => undefined);

  return `matched:${match.caseId}`;
}

export const complianceMailboxIntakeCron = onSchedule(
  { schedule: 'every 10 minutes', timeZone: 'America/Los_Angeles', memory: '512MiB', timeoutSeconds: 300 },
  async () => {
    const tenants = await db.collection('tenants').listDocuments();
    for (const tenantRef of tenants) {
      const cfgRef = mailboxCfgRef(tenantRef.id);
      const cfg = (await cfgRef.get()).data();
      const tokens = cfg?.gmailTokens as Record<string, unknown> | undefined;
      if (cfg?.connected !== true || !trim(tokens?.refresh_token)) continue;

      try {
        const oauth2 = newOAuthClient();
        oauth2.setCredentials({
          access_token: trim(tokens?.access_token) || undefined,
          refresh_token: trim(tokens?.refresh_token),
          expiry_date: Number(tokens?.expiry_date) || undefined,
        });
        const gmail = google.gmail({ version: 'v1', auth: oauth2 });
        const selfEmail = trim(tokens?.email).toLowerCase();

        const list = await gmail.users.messages.list({
          userId: 'me',
          q: 'newer_than:14d',
          maxResults: MAX_MESSAGES_PER_POLL,
        });
        const ids = (list.data.messages ?? []).map((m) => trim(m.id)).filter(Boolean);
        if (ids.length === 0) {
          await cfgRef.set({ lastPollAt: admin.firestore.FieldValue.serverTimestamp(), lastPollProcessed: 0, lastPollMatched: 0 }, { merge: true });
          continue;
        }

        const ledger = cfgRef.collection('processedMessages');
        const seen = await db.getAll(...ids.map((id) => ledger.doc(id)));
        const fresh = ids.filter((_, i) => !seen[i].exists);
        if (fresh.length === 0) {
          await cfgRef.set({ lastPollAt: admin.firestore.FieldValue.serverTimestamp(), lastPollProcessed: 0, lastPollMatched: 0 }, { merge: true });
          continue;
        }

        const cases = await loadMatchableCases(tenantRef.id);
        let matched = 0;
        for (const messageId of fresh) {
          let outcome = 'error';
          try {
            outcome = await processMessage(tenantRef.id, gmail, messageId, selfEmail, cases);
          } catch (err) {
            // Ledger the failure anyway: one poison message must not wedge
            // the poll loop forever; the event trail has the Gmail id.
            logger.error('[complianceMailbox] message processing failed', {
              tenantId: tenantRef.id,
              messageId,
              err: err instanceof Error ? err.message : String(err),
            });
          }
          if (outcome.startsWith('matched:')) matched += 1;
          await ledger.doc(messageId).set({
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
            outcome,
          });
        }
        await cfgRef.set(
          {
            lastPollAt: admin.firestore.FieldValue.serverTimestamp(),
            lastPollProcessed: fresh.length,
            lastPollMatched: matched,
            tokenError: null,
          },
          { merge: true },
        );
        if (fresh.length > 0) {
          accusourceLog('info', 'mailbox', 'Compliance inbox poll', {
            tenantId: tenantRef.id,
            processed: fresh.length,
            matched,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const tokenDead = /invalid_grant|invalid_client|unauthorized_client|token has been (expired|revoked)/i.test(msg);
        logger.error('[complianceMailbox] poll failed', { tenantId: tenantRef.id, tokenDead, err: msg });
        if (tokenDead) {
          await cfgRef.set(
            { connected: false, tokenError: msg, tokenErrorAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true },
          );
          await notifyComplianceReviewers(
            tenantRef.id,
            'Compliance mailbox disconnected',
            'Google revoked or expired the compliance mailbox connection — candidate replies are NOT being matched. Reconnect it from the policy page.',
            '',
            '',
          ).catch(() => undefined);
        }
      }
    }
  },
);
