/**
 * Sodexo campus outreach — send-only Gmail campaign rails (Greg 2026-08-06).
 *
 * COST DESIGN (load-bearing): previous Gmail integrations were killed
 * because monitoring crons + watch renewals ran constantly. This module has
 * NO cron, NO Gmail watch, NO polling — nothing executes until Greg clicks
 * "Send batch" in the CRM Sodexo tab. Idle cost is zero. The only Gmail
 * READS are targeted per-contact reply checks at follow-up send time
 * (`users.messages.list q=from:<contact>`), so anyone who replied drops
 * out of the sequence automatically.
 *
 *  - getSalesOutreachGmailAuthUrl — consent URL for Greg's own mailbox
 *    (gmail.send + gmail.readonly). State purpose 'salesOutreachMailbox'
 *    routes the shared gmailOAuthCallback here. Tokens live on
 *    tenants/{t}/integrations/salesOutreachMailbox — NOT users/{uid}
 *    .gmailTokens (per-recruiter connection this must never clobber).
 *  - getSodexoOutreachStatus — connection state + per-touch eligible counts.
 *  - sodexoOutreachSendBatch — {touch, limit, dryRun}: renders the 3-touch
 *    sequence for tier-1 campus contacts and sends AS Greg's mailbox, so
 *    replies land natively in his inbox. Per-batch OK = the button click.
 *
 * Sequence gates: touch 1 never-touched; touch 2 ≥4 days after touch 1;
 * touch 3 ≥5 days after touch 2; any detected reply (or optedOut) halts.
 * State on each crm_contact: sodexoOutreach { touch1SentAt.., repliedAt,
 * optedOut, lastBatchId }.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { google } from 'googleapis';
import type { Response } from 'express';
import { isSuppressed, loadSuppressions } from './outreachSuppressions';
import { buildMimeMessage } from './mimeHeaders';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');
const redirectUri = defineString('GOOGLE_REDIRECT_URI');

const DEFAULT_MAILBOX = 'g.fielding@c1staffing.com';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  // Inbox chief-of-staff (Greg 2026-08-12 "go"): labels, archive, and
  // in-thread reply drafts. gmail.modify = everything except permanent
  // deletion — deliberately NOT requesting delete capability.
  'https://www.googleapis.com/auth/gmail.modify',
];
const LEAD_SOURCE = 'Sodexo Campus Scrape (sodexomyway.com)';
const ACCOUNT_SOURCE = 'sodexomyway_scrape_2026-07-14';
const TOUCH2_MIN_MS = 4 * 24 * 60 * 60 * 1000;
const TOUCH3_MIN_MS = 5 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 150;

const trim = (v: unknown): string => String(v ?? '').trim();

function newOAuthClient() {
  return new google.auth.OAuth2(clientId.value(), clientSecret.value(), redirectUri.value());
}

function mailboxCfgRef(tenantId: string) {
  return db.doc(`tenants/${tenantId}/integrations/salesOutreachMailbox`);
}

/** Internal staff gate (securityLevel 5+ in the tenant map or legacy field). */
async function ensureInternalStaff(uid: string, tenantId: string): Promise<void> {
  const snap = await db.doc(`users/${uid}`).get();
  const v = (snap.data() ?? {}) as Record<string, unknown>;
  const map = v.tenantIds as Record<string, Record<string, unknown>> | undefined;
  const lvl = Number(map?.[tenantId]?.securityLevel ?? v.securityLevel ?? 0);
  if (!(Number.isFinite(lvl) && lvl >= 5)) {
    throw new HttpsError('permission-denied', 'Internal staff only.');
  }
}

// ─────────────────────────────────────────────────────────────────────
// Connect
// ─────────────────────────────────────────────────────────────────────

export const getSalesOutreachGmailAuthUrl = onCall({ cors: true }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const tenantId = trim((request.data as Record<string, unknown>)?.tenantId);
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
  await ensureInternalStaff(uid, tenantId);

  const cfg = (await mailboxCfgRef(tenantId).get()).data() ?? {};
  const expectedEmail = trim(cfg.expectedEmail).toLowerCase() || DEFAULT_MAILBOX;
  const authUrl = newOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    login_hint: expectedEmail,
    state: JSON.stringify({ purpose: 'salesOutreachMailbox', tenantId, connectedBy: uid }),
  });
  return { authUrl, expectedEmail };
});

/** Branch of the shared gmailOAuthCallback HTTP handler. */
export async function handleSalesOutreachMailboxOAuth(
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
      res.status(400).send(page(
        'Wrong Google account',
        `This connect is for <b>${expectedEmail}</b>, but you authorized <b>${email || 'an unknown account'}</b>. ` +
          'Nothing was saved — sign into that mailbox in this browser and try again.',
        false,
      ));
      return;
    }
    if (!tokens.refresh_token) {
      res.status(400).send(page(
        'Connection incomplete',
        'Google did not return a refresh token — close this window and click Connect again.',
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
    res.status(200).send(page(
      'Outreach mailbox connected',
      `<b>${email}</b> is connected for campaign sending. Emails go out as this address and replies land in its inbox.`,
      true,
    ));
  } catch (err) {
    logger.error('[sodexoOutreach] OAuth callback failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    res.status(500).send(page('Connection failed', 'Something went wrong exchanging the code — try again.', false));
  }
}

// ─────────────────────────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────────────────────────

const FOOTER =
  '\n\n—\nGreg Fielding · C1 Staffing · 925-448-0579\n' +
  'linkedin.com/in/gregpfielding · c1staffing.com\n' +
  '1309 Coffeen Ave STE 1200, Sheridan, WY 82801\n' +
  "If you'd rather not hear from me, reply “unsubscribe” and I won't email again.";

function renderTouch(touch: number, firstName: string, campus: string): { subject: string; body: string } {
  const name = firstName || 'there';
  if (touch === 1) {
    return {
      subject: `Fall ramp-up coverage for ${campus}`,
      body:
        `Hi ${name} — fall move-in is a few weeks out, and if your dining halls are anything like the Sodexo sites we already staff, the first month is a scramble of call-outs and unfilled dish and prep shifts.\n\n` +
        `C1 Staffing is an existing Sodexo vendor (we support Sodexo healthcare and government accounts through Fieldglass today) — W-2 food service workers, cooks, and catering staff, background-checked and ready on short notice.\n\n` +
        `What positions do you still need filled at ${campus}?${FOOTER}`,
    };
  }
  if (touch === 2) {
    return {
      subject: `One shift, zero risk — ${campus}`,
      body:
        `Hi ${name} — following up. The way this usually starts: you give us one hard-to-fill shift — a weekend dish crew, a catering event, a call-out — and we cover it. If the crew's good, we talk about more.\n\n` +
        `No contract minimums, no platform to learn; we're already in Sodexo's vendor ecosystem.\n\n` +
        `What's the shift that's hardest to keep staffed at ${campus}?${FOOTER}`,
    };
  }
  return {
    subject: `Last note — ${campus}`,
    body:
      `Hi ${name} — last note from me. If staffing's covered for the fall, great — I'll check back in the spring. If move-in week gets ugly, reply here; we can usually field workers within 48 hours.\n\n` +
      `Either way, good luck with the semester.${FOOTER}`,
  };
}

function buildMime(from: string, to: string, subject: string, body: string): string {
  // Subjects here carry em dashes ("One shift, zero risk — {campus}"), which
  // MUST be RFC 2047 encoded — raw UTF-8 in a header reaches inboxes as
  // mojibake. See mimeHeaders.ts.
  return buildMimeMessage({ fromName: 'Greg Fielding', fromEmail: from, to, subject, body });
}

// ─────────────────────────────────────────────────────────────────────
// Candidates + status
// ─────────────────────────────────────────────────────────────────────

interface Candidate {
  ref: FirebaseFirestore.DocumentReference;
  email: string;
  firstName: string;
  campus: string;
  touch1At: number;
  touch2At: number;
}

async function campusNamesByAccount(tenantId: string): Promise<Map<string, string>> {
  const accounts = await db
    .collection(`tenants/${tenantId}/accounts`)
    .where('source', '==', ACCOUNT_SOURCE)
    .get();
  const out = new Map<string, string>();
  accounts.forEach((d) => {
    const name = trim((d.data() as Record<string, unknown>).name).replace(/^Sodexo\s*—\s*/i, '');
    out.set(d.id, name || d.id.replace(/^sdxacct_/, ''));
  });
  return out;
}

async function eligibleCandidates(tenantId: string, touch: number): Promise<Candidate[]> {
  const now = Date.now();
  // Do-not-contact suppression list (2026-08-14): shared with the
  // re-engagement campaign — covers contacts imported after the opt-out.
  const suppressions = await loadSuppressions(db, tenantId);
  const campuses = await campusNamesByAccount(tenantId);
  const contacts = await db
    .collection(`tenants/${tenantId}/crm_contacts`)
    .where('leadSource', '==', LEAD_SOURCE)
    .where('tier', '==', 1)
    .get();
  const out: Candidate[] = [];
  contacts.forEach((d) => {
    const v = d.data() as Record<string, unknown>;
    const email = trim(v.email).toLowerCase();
    if (!email) return;
    const so = (v.sodexoOutreach as Record<string, unknown>) ?? {};
    if (so.optedOut === true || so.repliedAt) return;
    if (v.emailBounced === true) return; // dead address (bounce sweep) — no more sends until rescued
    if (isSuppressed(suppressions, email, [campuses.get(trim(v.accountId)), trim(v.campusName), trim(v.accountName)])) return;
    const t1 = (so.touch1SentAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
    const t2 = (so.touch2SentAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
    const t3 = (so.touch3SentAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
    if (touch === 1 && t1) return;
    if (touch === 2 && (!t1 || t2 || now - t1 < TOUCH2_MIN_MS)) return;
    if (touch === 3 && (!t2 || t3 || now - t2 < TOUCH3_MIN_MS)) return;
    const firstName = trim(v.firstName) || trim(v.name).split(/\s+/)[0] || '';
    out.push({
      ref: d.ref,
      email,
      firstName,
      campus: campuses.get(trim(v.accountId)) ?? 'your campus',
      touch1At: t1,
      touch2At: t2,
    });
  });
  // Stable order → deterministic batching.
  out.sort((a, b) => a.email.localeCompare(b.email));
  return out;
}

export const getSodexoOutreachStatus = onCall({ cors: true, memory: '512MiB' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const tenantId = trim((request.data as Record<string, unknown>)?.tenantId);
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
  await ensureInternalStaff(uid, tenantId);

  const cfg = (await mailboxCfgRef(tenantId).get()).data() ?? {};
  // One pass over the contacts for all three touch counts — the per-touch
  // eligibleCandidates() rescan made this callable painfully slow (the
  // panel sat invisible in its loading state, Greg 2026-08-07).
  const now = Date.now();
  const counts: Record<string, number> = { touch1: 0, touch2: 0, touch3: 0 };
  const contactsSnap = await db
    .collection(`tenants/${tenantId}/crm_contacts`)
    .where('leadSource', '==', LEAD_SOURCE)
    .where('tier', '==', 1)
    .get();
  contactsSnap.forEach((d) => {
    const v = d.data() as Record<string, unknown>;
    if (!trim(v.email)) return;
    const so = (v.sodexoOutreach as Record<string, unknown>) ?? {};
    if (so.optedOut === true || so.repliedAt) return;
    if (v.emailBounced === true) return; // dead address (bounce sweep) — no more sends until rescued
    const t1 = (so.touch1SentAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
    const t2 = (so.touch2SentAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
    const t3 = (so.touch3SentAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
    if (!t1) counts.touch1 += 1;
    else if (!t2 && now - t1 >= TOUCH2_MIN_MS) counts.touch2 += 1;
    else if (t2 && !t3 && now - t2 >= TOUCH3_MIN_MS) counts.touch3 += 1;
  });
  const batches = await db
    .collection(`tenants/${tenantId}/sodexo_outreach_batches`)
    .orderBy('sentAt', 'desc')
    .limit(10)
    .get()
    .catch(() => null);
  // Reply desk (2026-08-11): pending AI-drafted replies for the review section.
  const pendingReplies = await db
    .collection(`tenants/${tenantId}/sodexo_outreach_replies`)
    .where('status', '==', 'pending')
    .limit(25)
    .get()
    .catch(() => null);
  return {
    connected: cfg.connected === true,
    email: trim((cfg.gmailTokens as Record<string, unknown>)?.email) || null,
    expectedEmail: trim(cfg.expectedEmail) || DEFAULT_MAILBOX,
    eligible: counts,
    recentBatches: (batches?.docs ?? []).map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })),
    pendingReplies: (pendingReplies?.docs ?? [])
      .map((d) => {
        const v = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          name: trim(v.name),
          campus: trim(v.campus),
          email: trim(v.email),
          subject: trim(v.subject),
          receivedAt: trim(v.receivedAt),
          body: trim(v.body),
          classification: trim(v.classification),
          summary: trim(v.summary),
          aiDraft: trim(v.aiDraft),
        };
      })
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1)),
  };
});

// ─────────────────────────────────────────────────────────────────────
// Send batch
// ─────────────────────────────────────────────────────────────────────

export const sodexoOutreachSendBatch = onCall(
  { cors: true, memory: '512MiB', timeoutSeconds: 540 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
    const data = (request.data ?? {}) as Record<string, unknown>;
    const tenantId = trim(data.tenantId);
    if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
    await ensureInternalStaff(uid, tenantId);
    const touch = Number(data.touch);
    if (![1, 2, 3].includes(touch)) throw new HttpsError('invalid-argument', 'touch must be 1, 2, or 3.');
    const limit = Math.min(Math.max(1, Number(data.limit) || DEFAULT_LIMIT), MAX_LIMIT);
    const dryRun = data.dryRun !== false; // dry-run unless explicitly false

    const cfg = (await mailboxCfgRef(tenantId).get()).data() ?? {};
    const tokens = (cfg.gmailTokens ?? {}) as Record<string, unknown>;
    if (cfg.connected !== true || !tokens.refresh_token) {
      throw new HttpsError('failed-precondition', 'Outreach mailbox is not connected yet.');
    }
    const fromEmail = trim(tokens.email) || DEFAULT_MAILBOX;

    const candidates = (await eligibleCandidates(tenantId, touch)).slice(0, limit);
    if (dryRun) {
      return {
        dryRun: true,
        touch,
        count: candidates.length,
        preview: candidates.slice(0, 20).map((c) => ({ email: c.email, firstName: c.firstName, campus: c.campus })),
        sampleSubject: candidates.length ? renderTouch(touch, candidates[0].firstName, candidates[0].campus).subject : null,
      };
    }

    const oauth2 = newOAuthClient();
    oauth2.setCredentials({ refresh_token: String(tokens.refresh_token) });
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });

    const batchRef = db.collection(`tenants/${tenantId}/sodexo_outreach_batches`).doc();
    let sent = 0;
    let skippedReplied = 0;
    const errors: string[] = [];

    for (const c of candidates) {
      // Follow-ups: targeted reply check — a single Gmail search for mail
      // FROM this contact since touch 1. Repliers exit the sequence.
      if (touch > 1 && c.touch1At) {
        try {
          const q = `from:${c.email} after:${Math.floor(c.touch1At / 1000)}`;
          const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: 3 });
          // Out-of-office autoresponders are not engagement (2026-08-11: 5 of
          // the first 10 "replies" were OOO) — only a message whose subject
          // isn't an auto-reply counts, so those contacts stay in sequence.
          let humanReply = false;
          for (const m of res.data.messages ?? []) {
            if (!m.id) continue;
            const meta = await gmail.users.messages.get({
              userId: 'me',
              id: m.id,
              format: 'metadata',
              metadataHeaders: ['Subject'],
            });
            const subject =
              meta.data.payload?.headers?.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? '';
            if (!/^(automatic reply|auto(matic)?[- ]?reply|out of office)/i.test(subject.trim())) {
              humanReply = true;
              break;
            }
          }
          if (humanReply) {
            await c.ref.set(
              { sodexoOutreach: { repliedAt: admin.firestore.FieldValue.serverTimestamp() } },
              { mergeFields: ['sodexoOutreach.repliedAt'] },
            );
            skippedReplied += 1;
            continue;
          }
        } catch (e) {
          logger.warn('sodexoOutreach: reply check failed — sending anyway', {
            email: c.email,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      const { subject, body } = renderTouch(touch, c.firstName, c.campus);
      try {
        await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: buildMime(fromEmail, c.email, subject, body) },
        });
        await c.ref.set(
          {
            sodexoOutreach: {
              [`touch${touch}SentAt`]: admin.firestore.FieldValue.serverTimestamp(),
              lastBatchId: batchRef.id,
            },
          },
          { merge: true },
        );
        sent += 1;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${c.email}: ${msg.slice(0, 120)}`);
        logger.warn('sodexoOutreach: send failed', { email: c.email, error: msg });
      }
      // Human-ish pacing; also keeps Gmail per-second quotas comfortable.
      await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 500)));
    }

    await batchRef.set({
      touch,
      sent,
      skippedReplied,
      errors: errors.slice(0, 20),
      requested: candidates.length,
      fromEmail,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      triggeredByUid: uid,
    });

    logger.info('sodexoOutreach: batch done', { tenantId, touch, sent, skippedReplied, errors: errors.length });
    return { dryRun: false, touch, sent, skippedReplied, errors, batchId: batchRef.id };
  },
);
