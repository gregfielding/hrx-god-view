/**
 * Sodexo outreach reply desk (Greg 2026-08-11: "offboard as much of this to
 * you as possible").
 *
 * A scheduled scan (3×/day — NOT the always-on watch/history-poll class that
 * killed prior Gmail integrations; ~300 targeted queries per run, idle cost
 * between runs is zero) reads replies to the campaign via the SAME stored
 * OAuth grant the sends use, classifies each with AI, and drafts a reply.
 * Drafts land in `tenants/{t}/sodexo_outreach_replies` as status 'pending'
 * and surface in the Sodexo tab's "Replies to review" section — NOTHING is
 * sent automatically; Greg's Send click (resolveSodexoReply) is the per-
 * message OK. Unsubscribes auto-stamp optedOut. OOO autoresponders are
 * ignored. When a run finds new replies it emails Greg a digest (self-send
 * from his own mailbox).
 *
 * State per contact: sodexoOutreach.processedReplyMsgIds (cap 20) so multi-
 * turn threads keep working — a new message after Greg's reply is picked up
 * as a fresh review card.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { google, gmail_v1 } from 'googleapis';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');
const redirectUri = defineString('GOOGLE_REDIRECT_URI');

/** Single-tenant reality — the cron has no caller to read a tenant from. */
const PRIMARY_TENANT = 'BCiP2bQ9CgVOCTfV6MhD';
const LEAD_SOURCE = 'Sodexo Campus Scrape (sodexomyway.com)';
const AUTO_REPLY_RE = /^(automatic reply|auto(matic)?[- ]?reply|out of office)/i;
const PANEL_URL = 'https://hrxone.com/crm?tab=sodexo-campuses';

const trim = (v: unknown): string => String(v ?? '').trim();

function newOAuthClient() {
  return new google.auth.OAuth2(clientId.value(), clientSecret.value(), redirectUri.value());
}

/** Internal staff gate — same rule as sodexoOutreach.ts. */
async function ensureInternalStaff(uid: string | undefined, tenantId: string): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const snap = await db.doc(`users/${uid}`).get();
  const v = (snap.data() ?? {}) as Record<string, unknown>;
  const map = v.tenantIds as Record<string, Record<string, unknown>> | undefined;
  const lvl = Number(map?.[tenantId]?.securityLevel ?? v.securityLevel ?? 0);
  if (!(Number.isFinite(lvl) && lvl >= 5)) {
    throw new HttpsError('permission-denied', 'Internal staff only.');
  }
}

async function gmailClientFor(tenantId: string): Promise<{ gmail: gmail_v1.Gmail; fromEmail: string } | null> {
  const cfgSnap = await db.doc(`tenants/${tenantId}/integrations/salesOutreachMailbox`).get();
  const cfg = (cfgSnap.data() ?? {}) as Record<string, unknown>;
  const tokens = (cfg.gmailTokens ?? {}) as Record<string, unknown>;
  if (cfg.connected !== true || !tokens.refresh_token) return null;
  const oauth2 = newOAuthClient();
  oauth2.setCredentials({ refresh_token: String(tokens.refresh_token) });
  return {
    gmail: google.gmail({ version: 'v1', auth: oauth2 }),
    fromEmail: trim(tokens.email) || trim(cfg.expectedEmail) || 'g.fielding@c1staffing.com',
  };
}

/** Walk a Gmail payload for the text/plain body; fall back to snippet. */
function extractPlainText(msg: gmail_v1.Schema$Message): string {
  const decode = (data?: string | null): string =>
    data ? Buffer.from(data, 'base64').toString('utf8') : '';
  const walk = (p?: gmail_v1.Schema$MessagePart): string => {
    if (!p) return '';
    if (p.mimeType === 'text/plain' && p.body?.data) return decode(p.body.data);
    for (const child of p.parts ?? []) {
      const t = walk(child);
      if (t) return t;
    }
    return '';
  };
  const raw = walk(msg.payload) || trim(msg.snippet);
  // Drop quoted history: everything from the first quoted-reply marker on.
  const cut = raw.search(/\r?\n\s*(>|On .{5,80} wrote:|From: Greg Fielding|-{4,}\s*Original Message)/i);
  return (cut > 0 ? raw.slice(0, cut) : raw).trim().slice(0, 2000);
}

function header(msg: gmail_v1.Schema$Message, name: string): string {
  return (
    msg.payload?.headers?.find((h) => (h.name ?? '').toLowerCase() === name.toLowerCase())?.value ?? ''
  );
}

interface Classified {
  classification: 'interested' | 'question' | 'not_interested' | 'unsubscribe' | 'other';
  summary: string;
  draftReply: string;
}

async function classifyAndDraft(input: {
  firstName: string;
  campus: string;
  theirMessage: string;
  subject: string;
}): Promise<Classified> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY unset');
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey });
  const prompt = [
    `A Sodexo campus-dining manager replied to Greg Fielding's cold outreach about fall staffing coverage. Classify the reply and draft Greg's response.`,
    ``,
    `Context you may use (never invent beyond it):`,
    `- Greg Fielding runs C1 Staffing, a national hourly staffing agency (cooks, food service workers, dishwashers, utility/janitorial, warehouse).`,
    `- C1 already staffs Sodexo healthcare/government sites and is an active supplier in SAP Fieldglass — if they mention Fieldglass postings, C1 can pick those up; ask which site/req or offer to grab them directly.`,
    `- Offer framing: no minimums, try one shift, C1 handles payroll/WC/onboarding. NEVER state prices, bill rates, or contract terms.`,
    `- Sign-off: "Greg" then "Greg Fielding · C1 Staffing · 925-448-0579".`,
    ``,
    `Draft rules: under 110 words, plain text, greet by first name (${input.firstName || 'there'}), direct and warm like a busy founder, one clear next step (send their open positions, or a 10-minute call), no bullet lists, no corporate filler.`,
    `If not interested: 1–2 gracious sentences keeping the door open for mid-semester call-offs; nothing salesy.`,
    `If they asked a question you can't answer from context: acknowledge and say Greg will follow up with specifics — do not guess.`,
    ``,
    `Campus: ${input.campus}`,
    `Their subject: ${input.subject}`,
    `Their message:\n"""${input.theirMessage}"""`,
    ``,
    `Respond ONLY with JSON: {"classification":"interested|question|not_interested|unsubscribe|other","summary":"<one sentence, what they said>","draftReply":"<the reply text, or empty string for unsubscribe>"}`,
  ].join('\n');
  const completion = await openai.chat.completions.create({
    model: 'gpt-5',
    messages: [
      { role: 'system', content: 'You output only valid JSON. You never invent facts, prices, or commitments beyond the provided context.' },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
  });
  const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}') as Partial<Classified>;
  const cls = ['interested', 'question', 'not_interested', 'unsubscribe', 'other'].includes(
    String(parsed.classification),
  )
    ? (parsed.classification as Classified['classification'])
    : 'other';
  return {
    classification: cls,
    summary: trim(parsed.summary).slice(0, 300),
    draftReply: trim(parsed.draftReply).slice(0, 2500),
  };
}

/** RFC 2822 reply MIME, threaded onto the original conversation. */
function buildReplyMime(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo: string;
}): string {
  const subject = /^re:/i.test(input.subject) ? input.subject : `Re: ${input.subject}`;
  const msg =
    `From: Greg Fielding <${input.from}>\r\n` +
    `To: ${input.to}\r\n` +
    `Subject: ${subject}\r\n` +
    (input.inReplyTo ? `In-Reply-To: ${input.inReplyTo}\r\nReferences: ${input.inReplyTo}\r\n` : '') +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: text/plain; charset="UTF-8"\r\n\r\n` +
    input.body;
  return Buffer.from(msg).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface ScanResult {
  contactsScanned: number;
  newReplies: number;
  autoUnsubscribed: number;
  oooSkipped: number;
  errors: number;
}

export async function scanRepliesCore(tenantId: string): Promise<ScanResult> {
  const result: ScanResult = { contactsScanned: 0, newReplies: 0, autoUnsubscribed: 0, oooSkipped: 0, errors: 0 };
  const client = await gmailClientFor(tenantId);
  if (!client) {
    logger.warn('sodexoReplies: mailbox not connected — nothing to scan');
    return result;
  }
  const { gmail, fromEmail } = client;

  const snap = await db.collection(`tenants/${tenantId}/crm_contacts`).where('leadSource', '==', LEAD_SOURCE).get();
  interface Target {
    ref: FirebaseFirestore.DocumentReference;
    id: string;
    email: string;
    firstName: string;
    name: string;
    campus: string;
    touch1Ms: number;
    processed: string[];
    replied: boolean;
  }
  const targets: Target[] = [];
  snap.forEach((d) => {
    const v = d.data() as Record<string, unknown>;
    const so = (v.sodexoOutreach ?? {}) as Record<string, unknown>;
    const t1 = so.touch1SentAt as admin.firestore.Timestamp | undefined;
    if (!t1?.toMillis) return;
    if (so.optedOut === true) return;
    const email = trim(v.email).toLowerCase();
    if (!email) return;
    targets.push({
      ref: d.ref,
      id: d.id,
      email,
      firstName: trim(v.firstName),
      name: `${trim(v.firstName)} ${trim(v.lastName)}`.trim() || trim(v.fullName) || email,
      campus: trim(v.campusName) || trim(v.accountName) || trim(v.companyName) || '',
      touch1Ms: t1.toMillis(),
      processed: Array.isArray(so.processedReplyMsgIds) ? (so.processedReplyMsgIds as string[]) : [],
      replied: Boolean(so.repliedAt),
    });
  });
  result.contactsScanned = targets.length;

  const digest: string[] = [];
  for (const c of targets) {
    try {
      const q = `from:${c.email} after:${Math.floor(c.touch1Ms / 1000)}`;
      const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: 5 });
      const fresh = (list.data.messages ?? []).filter((m) => m.id && !c.processed.includes(m.id));
      if (fresh.length === 0) continue;
      for (const m of fresh) {
        const full = await gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'full' });
        const subject = header(full.data, 'Subject');
        const markProcessed = async () =>
          c.ref.set(
            { sodexoOutreach: { processedReplyMsgIds: admin.firestore.FieldValue.arrayUnion(m.id) } },
            { mergeFields: ['sodexoOutreach.processedReplyMsgIds'] },
          );
        if (AUTO_REPLY_RE.test(subject.trim())) {
          result.oooSkipped += 1;
          await markProcessed();
          continue;
        }
        const body = extractPlainText(full.data);
        const ai = await classifyAndDraft({
          firstName: c.firstName,
          campus: c.campus,
          theirMessage: body,
          subject,
        }).catch((e) => {
          logger.warn('sodexoReplies: classify failed — filing as other', { email: c.email, e: String(e) });
          return { classification: 'other' as const, summary: '', draftReply: '' };
        });
        const isUnsub = ai.classification === 'unsubscribe' || /^\s*unsubscribe\b/i.test(body);
        const replyRef = db.doc(`tenants/${tenantId}/sodexo_outreach_replies/${m.id}`);
        await replyRef.set({
          tenantId,
          contactId: c.id,
          email: c.email,
          name: c.name,
          campus: c.campus,
          threadId: full.data.threadId ?? null,
          messageId: m.id,
          rfcMessageId: header(full.data, 'Message-ID') || null,
          subject,
          receivedAt: header(full.data, 'Date') || null,
          body,
          classification: isUnsub ? 'unsubscribe' : ai.classification,
          summary: ai.summary,
          aiDraft: isUnsub ? '' : ai.draftReply,
          status: isUnsub ? 'auto_unsubscribed' : 'pending',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        const contactPatch: Record<string, unknown> = {
          processedReplyMsgIds: admin.firestore.FieldValue.arrayUnion(m.id),
          repliedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (isUnsub) {
          contactPatch.optedOut = true;
          contactPatch.optedOutAt = admin.firestore.FieldValue.serverTimestamp();
          contactPatch.optOutReason = 'replied "unsubscribe"';
          result.autoUnsubscribed += 1;
        } else {
          result.newReplies += 1;
          digest.push(`• ${c.name} (${c.campus}) — ${isUnsub ? 'unsubscribe' : ai.classification}: ${ai.summary || subject}`);
        }
        await c.ref.set({ sodexoOutreach: contactPatch }, { merge: true });
      }
      await new Promise((r) => setTimeout(r, 100));
    } catch (e) {
      result.errors += 1;
      logger.warn('sodexoReplies: contact scan failed', { email: c.email, e: String(e) });
    }
  }

  // Digest — self-send so Greg hears about new replies where he already lives.
  if (digest.length > 0) {
    try {
      const bodyText =
        `${digest.length} new Sodexo campaign repl${digest.length === 1 ? 'y' : 'ies'} to review:\n\n` +
        `${digest.join('\n')}\n\nReview + send drafted replies: ${PANEL_URL}\n`;
      await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: buildReplyMime({
            from: fromEmail,
            to: fromEmail,
            subject: `Sodexo replies: ${digest.length} to review`,
            body: bodyText,
            inReplyTo: '',
          }),
        },
      });
    } catch (e) {
      logger.warn('sodexoReplies: digest send failed', { e: String(e) });
    }
  }
  logger.info('sodexoReplies: scan complete', { ...result });
  return result;
}

/** 8am / 12pm / 4pm Pacific — three short runs, zero idle cost between. */
export const sodexoReplyScanCron = onSchedule(
  {
    schedule: '0 8,12,16 * * *',
    timeZone: 'America/Los_Angeles',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 540,
  },
  async () => {
    await scanRepliesCore(PRIMARY_TENANT);
  },
);

/** Manual "Check replies now" from the panel. */
export const sodexoReplyScanNow = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 540 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId) || PRIMARY_TENANT;
    await ensureInternalStaff(request.auth?.uid, tenantId);
    return await scanRepliesCore(tenantId);
  },
);

/**
 * Greg's per-reply decision from the panel: send (possibly edited) or
 * dismiss. Sends thread onto the original conversation via In-Reply-To +
 * threadId — this click IS the explicit OK for the outbound message.
 */
export const resolveSodexoReply = onCall(
  { region: 'us-central1', memory: '512MiB' },
  async (request) => {
    const tenantId = trim(request.data?.tenantId) || PRIMARY_TENANT;
    const replyId = trim(request.data?.replyId);
    const action = trim(request.data?.action);
    if (!replyId || !['send', 'dismiss'].includes(action)) {
      throw new HttpsError('invalid-argument', 'replyId and action (send|dismiss) are required.');
    }
    await ensureInternalStaff(request.auth?.uid, tenantId);
    const ref = db.doc(`tenants/${tenantId}/sodexo_outreach_replies/${replyId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Reply not found.');
    const r = snap.data() as Record<string, unknown>;
    if (trim(r.status) !== 'pending') {
      throw new HttpsError('failed-precondition', `Reply already ${trim(r.status)}.`);
    }

    if (action === 'dismiss') {
      await ref.set(
        { status: 'dismissed', resolvedAt: admin.firestore.FieldValue.serverTimestamp(), resolvedBy: request.auth?.uid ?? null },
        { merge: true },
      );
      return { ok: true, status: 'dismissed' };
    }

    const body = trim(request.data?.body) || trim(r.aiDraft);
    if (!body) throw new HttpsError('invalid-argument', 'Reply body is empty.');
    const client = await gmailClientFor(tenantId);
    if (!client) throw new HttpsError('failed-precondition', 'Mailbox not connected.');
    const res = await client.gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: buildReplyMime({
          from: client.fromEmail,
          to: trim(r.email),
          subject: trim(r.subject) || 'Re: your note',
          body,
          inReplyTo: trim(r.rfcMessageId),
        }),
        threadId: trim(r.threadId) || undefined,
      },
    });
    await ref.set(
      {
        status: 'sent',
        sentBody: body,
        sentMessageId: res.data.id ?? null,
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        resolvedBy: request.auth?.uid ?? null,
      },
      { merge: true },
    );
    return { ok: true, status: 'sent' };
  },
);
