/**
 * Sodexo outreach reply desk (Greg 2026-08-11: "offboard as much of this to
 * you as possible").
 *
 * A scheduled scan (3×/day — NOT the always-on watch/history-poll class that
 * killed prior Gmail integrations; ~300 targeted queries per run, idle cost
 * between runs is zero) reads replies to the campaign via the SAME stored
 * OAuth grant the sends use, classifies each with AI, and drafts a reply.
 * Drafts land in `tenants/{t}/sodexo_outreach_replies` and surface in the
 * Sodexo tab's "Replies to review" section. Autonomy tiers (Greg 2026-08-11
 * "flip it"): the not_interested gracious close AUTO-SENDS at scan time
 * (lowest-risk class; failures degrade to a pending card); interested /
 * question / other stay behind Greg's Send click (resolveSodexoReply).
 * Unsubscribes auto-stamp optedOut. OOO autoresponders are ignored. Every
 * run that finds replies emails Greg a digest (self-send from his own
 * mailbox) listing both the auto-handled and the needs-review items.
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
import { GENERIC_EMAIL_DOMAINS, normCompany } from './outreachSuppressions';

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
// Hard opt-out phrasings (Greg 2026-08-14, "Do not contact me or anyone
// affiliated with Matrix Bottling Group"): any of these in the fresh reply
// text forces the unsubscribe path no matter how the AI classifies it — a
// do-not-contact must NEVER get the auto-sent gracious close.
const DNC_RE =
  /\b(?:do not|don'?t|please stop|stop|never) (?:contact|e-?mail|message|call|reach)|remove (?:me|us) from|take (?:me|us) off|opt (?:me|us) out|no longer wish to (?:receive|hear)|do not solicit/i;
// "…me or anyone at X" extends the opt-out to the whole company.
const COMPANY_WIDE_RE =
  /\b(?:anyone|any one|everyone|nobody|no one|all of us|our (?:company|team|organi[sz]ation|firm)|entire (?:company|team|organi[sz]ation)|colleagues?|affiliated with|associated with)\b/i;
const PANEL_URL = 'https://hrxone.com/crm?tab=sodexo-campuses';

const trim = (v: unknown): string => String(v ?? '').trim();

function newOAuthClient() {
  return new google.auth.OAuth2(clientId.value(), clientSecret.value(), redirectUri.value());
}

/** Internal staff gate — same rule as sodexoOutreach.ts. Shared with crmReengagement.ts. */
export async function ensureInternalStaff(uid: string | undefined, tenantId: string): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const snap = await db.doc(`users/${uid}`).get();
  const v = (snap.data() ?? {}) as Record<string, unknown>;
  const map = v.tenantIds as Record<string, Record<string, unknown>> | undefined;
  const lvl = Number(map?.[tenantId]?.securityLevel ?? v.securityLevel ?? 0);
  if (!(Number.isFinite(lvl) && lvl >= 5)) {
    throw new HttpsError('permission-denied', 'Internal staff only.');
  }
}

export async function gmailClientFor(tenantId: string): Promise<{ gmail: gmail_v1.Gmail; fromEmail: string } | null> {
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
  campaign: 'sodexo' | 'reengagement';
}): Promise<Classified> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY unset');
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey });
  const prompt = [
    input.campaign === 'sodexo'
      ? `A Sodexo campus-dining manager replied to Greg Fielding's cold outreach about fall staffing coverage. Classify the reply and draft Greg's response.`
      : `A business contact replied to Greg Fielding's re-engagement outreach about hourly staffing (warehouse, food service, events, janitorial). Classify the reply and draft Greg's response.`,
    ``,
    `Context you may use (never invent beyond it):`,
    `- Greg Fielding runs C1 Staffing, a national hourly staffing agency (cooks, food service workers, dishwashers, utility/janitorial, warehouse).`,
    `- C1 already staffs Sodexo healthcare/government sites and is an active supplier in SAP Fieldglass — if they mention Fieldglass postings, C1 can pick those up; ask which site/req or offer to grab them directly.`,
    `- NEVER state C1's prices, bill rates, or contract terms. Asking what THEY pay for a position is fine — it's a qualifying question Greg likes.`,
    `- Sign-off: "Greg" then "Greg Fielding · C1 Staffing · 925-448-0579" then "linkedin.com/in/gregpfielding".`,
    ``,
    `Draft rules — Greg's real voice is calm, brief, and unhurried; drafts must read like he dashed them off between calls:`,
    `- Under 70 words, 3–4 sentences, plain text. Greet by first name (${input.firstName || 'there'}); close with "Thank you!" before the sign-off.`,
    `- Match their pace. If they're still deciding or checking internally, don't push and don't over-promise — acknowledge, and ask them to send details when they're ready. Never promise same-day resumes or turnaround times.`,
    `- No capability lists (don't recite payroll/WC/onboarding), no bullet lists, no corporate filler. Mention no-minimums/try-one-shift ONLY if it directly answers a hesitation they raised.`,
    `- Where natural, end with 1–2 short qualifying questions — e.g. "What does the position pay?" and "Do you use Fieldglass?".`,
    `- Example of Greg's actual tone (a real reply he sent): "Paul, Absolutely - we definitely have experienced catering cooks in the area. Please send more details after you see how coverage looks. 2 questions... what does the position pay? And do you use Fieldglass? Thank you!"`,
    `If not interested: 1–2 gracious sentences keeping the door open for future call-offs; nothing salesy.`,
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

/** One threaded outbound reply — shared by the resolve callable + auto-send. */
async function sendThreadedReply(
  gmail: gmail_v1.Gmail,
  fromEmail: string,
  input: { to: string; subject: string; body: string; inReplyTo: string; threadId?: string },
): Promise<string | null> {
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: buildReplyMime({
        from: fromEmail,
        to: input.to,
        subject: input.subject || 'Re: your note',
        body: input.body,
        inReplyTo: input.inReplyTo,
      }),
      threadId: input.threadId || undefined,
    },
  });
  return res.data.id ?? null;
}

interface ScanResult {
  contactsScanned: number;
  newReplies: number;
  autoReplied: number;
  autoUnsubscribed: number;
  oooSkipped: number;
  errors: number;
}

/**
 * A reply asked us off the whole company ("me or anyone affiliated with X"):
 * write durable suppression rows (domain + company name — both senders'
 * eligibility checks them, covering contacts imported later) and retire
 * every existing colleague from BOTH campaigns. Colleague = same non-generic
 * email domain, or company/campus name matching the replier's.
 */
async function suppressCompanyWide(
  tenantId: string,
  contactsSnap: FirebaseFirestore.QuerySnapshot,
  replier: { id: string; email: string; campus: string; name: string },
  replyText: string,
): Promise<{ label: string; swept: number }> {
  const FV = admin.firestore.FieldValue;
  const reason = `company-wide DNC reply from ${replier.email}: "${replyText.slice(0, 140).replace(/\s+/g, ' ').trim()}"`;
  const domain = replier.email.toLowerCase().split('@')[1] ?? '';
  const domainOk = Boolean(domain) && !GENERIC_EMAIL_DOMAINS.has(domain);
  const company = normCompany(replier.campus);
  const rows: Array<{ id: string; kind: 'domain' | 'company'; value: string }> = [];
  if (domainOk) rows.push({ id: `domain__${domain}`, kind: 'domain', value: domain });
  if (company.length >= 6) {
    rows.push({ id: `company__${company.replace(/ /g, '_').slice(0, 80)}`, kind: 'company', value: company });
  }
  for (const r of rows) {
    await db.doc(`tenants/${tenantId}/outreach_suppressions/${r.id}`).set(
      {
        tenantId,
        kind: r.kind,
        value: r.value,
        reason,
        sourceEmail: replier.email,
        sourceContactId: replier.id,
        createdAt: FV.serverTimestamp(),
        createdBy: 'reply_desk_auto',
      },
      { merge: true },
    );
  }
  let swept = 0;
  for (const d of contactsSnap.docs) {
    if (d.id === replier.id) continue;
    const v = d.data() as Record<string, any>;
    const email = trim(v.email).toLowerCase();
    const dom = email.split('@')[1] ?? '';
    const co = normCompany(trim(v.campusName) || trim(v.accountName) || trim(v.companyName));
    const hit =
      (domainOk && dom === domain) ||
      (company.length >= 6 && co.length >= 6 && (co.includes(company) || company.includes(co)));
    if (!hit) continue;
    if (v.crmReengagement?.optedOut === true && v.sodexoOutreach?.optedOut === true) continue;
    const stamp = { optedOut: true, optedOutAt: FV.serverTimestamp(), optOutReason: reason };
    await d.ref.set({ crmReengagement: stamp, sodexoOutreach: stamp }, { merge: true });
    swept += 1;
  }
  return { label: rows.map((r) => r.value).join(' + '), swept };
}

export async function scanRepliesCore(tenantId: string): Promise<ScanResult> {
  const result: ScanResult = { contactsScanned: 0, newReplies: 0, autoReplied: 0, autoUnsubscribed: 0, oooSkipped: 0, errors: 0 };
  const client = await gmailClientFor(tenantId);
  if (!client) {
    logger.warn('sodexoReplies: mailbox not connected — nothing to scan');
    return result;
  }
  const { gmail, fromEmail } = client;

  // BOTH campaigns share this desk (2026-08-11): sodexo contacts keyed by
  // leadSource, everyone else via crmReengagement state. One full scan.
  const snap = await db.collection(`tenants/${tenantId}/crm_contacts`).get();
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
    campaign: 'sodexo' | 'reengagement';
    stateKey: 'sodexoOutreach' | 'crmReengagement';
    accountId: string;
  }
  const targets: Target[] = [];
  snap.forEach((d) => {
    const v = d.data() as Record<string, unknown>;
    const isSodexo = (trim(v.leadSource) || trim(v.source)).startsWith('Sodexo Campus Scrape');
    const stateKey = isSodexo ? 'sodexoOutreach' : 'crmReengagement';
    const so = (v[stateKey] ?? {}) as Record<string, unknown>;
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
      campaign: isSodexo ? 'sodexo' : 'reengagement',
      stateKey,
      accountId: trim(v.accountId),
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
            { [c.stateKey]: { processedReplyMsgIds: admin.firestore.FieldValue.arrayUnion(m.id) } },
            { mergeFields: [`${c.stateKey}.processedReplyMsgIds`] },
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
          campaign: c.campaign,
        }).catch((e) => {
          logger.warn('sodexoReplies: classify failed — filing as other', { email: c.email, e: String(e) });
          return { classification: 'other' as const, summary: '', draftReply: '' };
        });
        const isUnsub =
          ai.classification === 'unsubscribe' || /^\s*unsubscribe\b/i.test(body) || DNC_RE.test(body);
        // Auto-send tier (Greg 2026-08-11 "flip it"): the not_interested
        // gracious close is the lowest-risk class — send it without review.
        // Interested/question/other stay behind Greg's click. A failed send
        // degrades to a normal pending card, never a lost reply.
        let autoSentId: string | null = null;
        const rfcMessageId = header(full.data, 'Message-ID') || '';
        if (!isUnsub && ai.classification === 'not_interested' && ai.draftReply) {
          try {
            autoSentId = await sendThreadedReply(gmail, fromEmail, {
              to: c.email,
              subject,
              body: ai.draftReply,
              inReplyTo: rfcMessageId,
              threadId: full.data.threadId ?? undefined,
            });
          } catch (e) {
            logger.warn('sodexoReplies: auto-send failed — leaving pending', { email: c.email, e: String(e) });
          }
        }
        const replyRef = db.doc(`tenants/${tenantId}/sodexo_outreach_replies/${m.id}`);
        await replyRef.set({
          tenantId,
          campaign: c.campaign,
          contactId: c.id,
          email: c.email,
          name: c.name,
          campus: c.campus,
          threadId: full.data.threadId ?? null,
          messageId: m.id,
          rfcMessageId: rfcMessageId || null,
          subject,
          receivedAt: header(full.data, 'Date') || null,
          body,
          classification: isUnsub ? 'unsubscribe' : ai.classification,
          summary: ai.summary,
          aiDraft: isUnsub ? '' : ai.draftReply,
          status: isUnsub ? 'auto_unsubscribed' : autoSentId ? 'auto_sent' : 'pending',
          ...(autoSentId
            ? {
                sentBody: ai.draftReply,
                sentMessageId: autoSentId,
                resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
                resolvedBy: 'auto',
              }
            : {}),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        const contactPatch: Record<string, unknown> = {
          processedReplyMsgIds: admin.firestore.FieldValue.arrayUnion(m.id),
          repliedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (isUnsub) {
          contactPatch.optedOut = true;
          contactPatch.optedOutAt = admin.firestore.FieldValue.serverTimestamp();
          contactPatch.optOutReason = 'reply asked not to be contacted';
          result.autoUnsubscribed += 1;
          digest.push(`• ${c.name} (${c.campus}) — asked not to be contacted → opted out of all campaigns`);
        } else if (autoSentId) {
          result.autoReplied += 1;
          digest.push(`• ${c.name} (${c.campus}) — not interested → auto-replied with a gracious close`);
        } else {
          result.newReplies += 1;
          digest.push(`• ${c.name} (${c.campus}) — ${ai.classification}: ${ai.summary || subject} — NEEDS REVIEW`);
        }
        await c.ref.set({ [c.stateKey]: contactPatch }, { merge: true });
        if (isUnsub) {
          // Opt-outs are global, not per-campaign: stamp the OTHER campaign's
          // namespace too so no future list migration can resume contact.
          const otherKey = c.stateKey === 'sodexoOutreach' ? 'crmReengagement' : 'sodexoOutreach';
          await c.ref.set(
            {
              [otherKey]: {
                optedOut: true,
                optedOutAt: admin.firestore.FieldValue.serverTimestamp(),
                optOutReason: `mirrored from ${c.stateKey} opt-out`,
              },
            },
            { merge: true },
          );
          if (COMPANY_WIDE_RE.test(body)) {
            const sweep = await suppressCompanyWide(tenantId, snap, c, body);
            digest.push(
              `  ↳ company-wide ask — suppressed ${sweep.label || 'their company'} (${sweep.swept} other contact${sweep.swept === 1 ? '' : 's'} retired; future imports auto-blocked)`,
            );
          }
        }
        // Affirmative replies become hot leads automatically (Greg 2026-08-11:
        // "anyone who responds in such an affirmative way needs to be saved and
        // managed as a hot lead"). interested/question = engaged; the contact
        // and its child account get the same 🔥 the flame toggle sets.
        if (!isUnsub && (ai.classification === 'interested' || ai.classification === 'question')) {
          const hotStamp = {
            hot: true,
            hotUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            hotUpdatedBy: 'reply_desk_auto',
            hotReason: 'affirmative_reply',
          };
          await c.ref.set(hotStamp, { merge: true });
          if (c.accountId) {
            // Existence check mirrors setHotStatus — a merge-set on a wrong id
            // would conjure a phantom accounts doc.
            const acctRef = db.doc(`tenants/${tenantId}/accounts/${c.accountId}`);
            const acct = await acctRef.get();
            if (acct.exists) await acctRef.set(hotStamp, { merge: true });
          }
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    } catch (e) {
      result.errors += 1;
      logger.warn('sodexoReplies: contact scan failed', { email: c.email, e: String(e) });
    }
  }

  // Bounce sweep (Greg 2026-08-12, 11% bounce rate discovered): flag dead
  // addresses so eligibility skips them — touch 2/3 must never fire at an
  // address that already bounced. Rescue (Apollo re-enrichment) is separate.
  try {
    const bounceRe = [
      /wasn'?t delivered to ([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi,
      /message to ([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}) (?:couldn'?t be delivered|has been blocked)/gi,
    ];
    const bounceList = await gmail.users.messages.list({
      userId: 'me',
      q: '(from:mailer-daemon OR from:postmaster OR subject:"Delivery Status Notification") newer_than:2d',
      maxResults: 100,
    });
    const failedEmails = new Set<string>();
    for (const m of bounceList.data.messages ?? []) {
      const full = await gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'full' });
      const xFailed = full.data.payload?.headers?.find((h) => h.name?.toLowerCase() === 'x-failed-recipients')?.value;
      if (xFailed) xFailed.split(/[,;\s]+/).filter((e) => e.includes('@')).forEach((e) => failedEmails.add(e.toLowerCase()));
      const parts: string[] = [full.data.snippet ?? ''];
      const walk = (p: any): void => {
        if (p?.body?.data) parts.push(Buffer.from(p.body.data, 'base64').toString('utf8'));
        (p?.parts ?? []).forEach(walk);
      };
      walk(full.data.payload);
      const body = parts.join('\n');
      for (const re of bounceRe) {
        re.lastIndex = 0;
        let match;
        while ((match = re.exec(body))) failedEmails.add(match[1].toLowerCase());
      }
    }
    let newlyBounced = 0;
    for (const email of failedEmails) {
      if (email.endsWith('@c1staffing.com')) continue;
      const hit = await db.collection(`tenants/${tenantId}/crm_contacts`).where('email', '==', email).limit(1).get();
      if (hit.empty || hit.docs[0].get('emailBounced') === true) continue;
      await hit.docs[0].ref.set(
        {
          emailBounced: true,
          emailBouncedAt: admin.firestore.FieldValue.serverTimestamp(),
          bouncedEmail: email,
        },
        { merge: true },
      );
      newlyBounced += 1;
    }
    if (newlyBounced > 0) digest.push(`• ${newlyBounced} address${newlyBounced === 1 ? '' : 'es'} bounced — flagged; Apollo rescue will retry them with fresh emails`);
  } catch (e) {
    logger.warn('sodexoReplies: bounce sweep failed', { e: String(e) });
  }

  // Departure sweep (Greg 2026-08-13, "update our database and email the
  // right contact"): auto-replies saying "X is no longer with the company —
  // contact Y" carry a warm referral we were dropping (the scan above skips
  // AUTO_REPLY_RE subjects). Retire the departed contact from BOTH campaigns
  // and create the named replacement on the same company, verified (the
  // address came from the employer's own auto-responder) so it fronts the
  // re-engagement queue and gets a fresh touch-1 in the next batch.
  // Idempotent: departedAt on the old contact + email dedupe on the new one.
  try {
    const DEPART_RE = /no longer (?:with|at|employed|works?|working|a part of)|has left the|have left the|is no longer employed|retired from/i;
    const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
    const NAME_RE =
      /(?:contact|forwarded to|reach(?: out)? to|please (?:e-?mail|contact)|refer(?:red)? to|direct(?:ed)? to)\s*:?\s+([A-Z][\w'.-]+(?: [A-Z][\w'.-]+){0,2})/;
    const stripHtml = (s: string) =>
      s.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const departList = await gmail.users.messages.list({
      userId: 'me',
      q: 'subject:("automatic reply" OR "automatic response" OR "auto-reply" OR "out of office") newer_than:2d',
      maxResults: 100,
    });
    let departures = 0;
    let replacements = 0;
    for (const m of departList.data.messages ?? []) {
      const full = await gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'full' });
      const fromRaw = full.data.payload?.headers?.find((h) => h.name?.toLowerCase() === 'from')?.value ?? '';
      const fromAddr = (fromRaw.match(EMAIL_RE)?.[0] ?? '').toLowerCase();
      const parts: string[] = [full.data.snippet ?? ''];
      const walk = (p: any): void => {
        if (p?.body?.data) parts.push(Buffer.from(p.body.data, 'base64').toString('utf8'));
        (p?.parts ?? []).forEach(walk);
      };
      walk(full.data.payload);
      const body = stripHtml(parts.join('\n')).slice(0, 4000);
      if (!fromAddr || !DEPART_RE.test(body)) continue;

      let oldSnap = (
        await db.collection(`tenants/${tenantId}/crm_contacts`).where('email', '==', fromAddr).limit(1).get()
      ).docs[0];
      if (!oldSnap) {
        oldSnap = (
          await db.collection(`tenants/${tenantId}/crm_contacts`).where('altEmails', 'array-contains', fromAddr).limit(1).get()
        ).docs[0];
      }
      if (!oldSnap || oldSnap.get('departedAt')) continue; // unknown sender or already handled

      const oldName = `${oldSnap.get('firstName') ?? ''} ${oldSnap.get('lastName') ?? ''}`.trim() || fromAddr;
      const cands = [...new Set((body.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))].filter(
        (e) => e !== fromAddr && !e.endsWith('@c1staffing.com') && !/no-?reply|unsubscribe|privacy|mailer|postmaster/.test(e),
      );
      const replEmail = cands[0] ?? '';
      let replName = body.match(NAME_RE)?.[1]?.replace(/\s+(?:at|@).*$/, '').trim() ?? '';
      if (/^(thank|thanks|please|hello|hi|regards|sincerely|best|kind)\b/i.test(replName)) replName = '';
      const titleMatch = replName
        ? body.match(new RegExp(replName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(([^)]{3,60})\\)'))
        : null;

      departures += 1;
      await oldSnap.ref.update({
        departedAt: admin.firestore.FieldValue.serverTimestamp(),
        departedNote: `Auto-reply: no longer with company${replEmail ? `; referred to ${replName || replEmail}` : ''}`,
        'crmReengagement.optedOut': true,
        'crmReengagement.optedOutReason': 'departed_auto_reply',
        'sodexoOutreach.optedOut': true,
        'sodexoOutreach.optedOutReason': 'departed_auto_reply',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      let created = false;
      if (replEmail) {
        const dupe = await db.collection(`tenants/${tenantId}/crm_contacts`).where('email', '==', replEmail).limit(1).get();
        if (dupe.empty) {
          const nameParts = replName.split(/\s+/).filter(Boolean);
          await db.collection(`tenants/${tenantId}/crm_contacts`).add({
            firstName: nameParts[0] ?? '',
            lastName: nameParts.slice(1).join(' '),
            email: replEmail,
            ...(titleMatch?.[1] ? { title: titleMatch[1].trim() } : {}),
            companyId: oldSnap.get('companyId') ?? null,
            companyName: oldSnap.get('companyName') ?? null,
            ...(oldSnap.get('accountId') ? { accountId: oldSnap.get('accountId') } : {}),
            leadSource: 'Departure auto-reply',
            sourceNote: `Named as replacement in ${oldName}'s departure auto-reply`,
            verifiedEmail: true,
            verifiedSource: 'auto_reply_referral',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: 'departure_sweep_cron',
          });
          created = true;
          replacements += 1;
        }
      }
      digest.push(
        `• ${oldName} has left ${oldSnap.get('companyName') ?? 'their company'} — retired from campaigns` +
          (replEmail ? `; ${created ? 'created' : 'already had'} replacement ${replName || replEmail} (queued for fresh outreach)` : '; no replacement named'),
      );
    }
    if (departures > 0) {
      logger.info('sodexoReplies: departure sweep', { departures, replacements });
    }
  } catch (e) {
    logger.warn('sodexoReplies: departure sweep failed', { e: String(e) });
  }

  // Digest — self-send so Greg hears about new replies where he already lives.
  if (digest.length > 0) {
    try {
      const bodyText =
        `Sodexo campaign: ${result.newReplies} repl${result.newReplies === 1 ? 'y' : 'ies'} to review, ` +
        `${result.autoReplied} auto-handled:\n\n` +
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
    const sentId = await sendThreadedReply(client.gmail, client.fromEmail, {
      to: trim(r.email),
      subject: trim(r.subject),
      body,
      inReplyTo: trim(r.rfcMessageId),
      threadId: trim(r.threadId) || undefined,
    });
    await ref.set(
      {
        status: 'sent',
        sentBody: body,
        sentMessageId: sentId,
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        resolvedBy: request.auth?.uid ?? null,
      },
      { merge: true },
    );
    return { ok: true, status: 'sent' };
  },
);
