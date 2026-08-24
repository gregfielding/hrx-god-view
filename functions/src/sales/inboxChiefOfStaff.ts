/**
 * Inbox chief-of-staff (Greg 2026-08-12 "go"): tier 1 of running his Gmail.
 *
 *  1. TRIAGE (inboxTriageCron, every 2h 7a-6p): classify new inbox mail.
 *     Junk pitches / newsletters / notifications from UNKNOWN senders get
 *     labeled + archived out of the inbox (never deleted — everything is
 *     reversible from the HRX/* labels). Real business mail needing an
 *     answer gets 'HRX/Needs Reply' + a reply DRAFT in Greg's voice sitting
 *     on the thread. Personal/financial/legal → 'HRX/Review', label only.
 *     Mail from anyone already in the CRM or staff is NEVER auto-archived.
 *
 *  2. MORNING BRIEF (inboxMorningBriefCron, 6:30a Mon-Fri): one self-sent
 *     email — needs-reply queue, dropped balls (Greg's sent threads
 *     unanswered ≥4 days, campaign sends excluded), hot leads in the last
 *     24h, campaign pulse, junk suppressed.
 *
 * Requires the gmail.modify scope (added to SALES_OAUTH_SCOPES 2026-08-12);
 * until Greg re-grants, triage exits gracefully and logs the scope error.
 * Shares the salesOutreachMailbox grant via gmailClientFor().
 */

import { getClaudeChat } from '../utils/claudeChat';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import type { gmail_v1 } from 'googleapis';

import { gmailClientFor, ensureInternalStaff } from './sodexoReplies';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const PRIMARY_TENANT = 'BCiP2bQ9CgVOCTfV6MhD';
const CFG_PATH = (t: string) => `tenants/${t}/integrations/inboxChiefOfStaff`;
const trim = (v: unknown): string => String(v ?? '').trim();

const LABELS = {
  junk: 'HRX/Junk Pitches',
  newsletter: 'HRX/Newsletters',
  notification: 'HRX/Notifications',
  needsReply: 'HRX/Needs Reply',
  fyi: 'HRX/FYI',
  review: 'HRX/Review',
} as const;

function header(msg: gmail_v1.Schema$Message, name: string): string {
  return trim(msg.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value);
}

function plainText(msg: gmail_v1.Schema$Message): string {
  const parts: string[] = [msg.snippet ?? ''];
  const walk = (p?: gmail_v1.Schema$MessagePart): void => {
    if (!p) return;
    if (p.mimeType === 'text/plain' && p.body?.data) {
      parts.push(Buffer.from(p.body.data, 'base64').toString('utf8'));
    }
    (p.parts ?? []).forEach(walk);
  };
  walk(msg.payload as gmail_v1.Schema$MessagePart | undefined);
  return parts.join('\n').slice(0, 6000);
}

function senderEmail(msg: gmail_v1.Schema$Message): string {
  const from = header(msg, 'From');
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

async function ensureLabels(gmail: gmail_v1.Gmail): Promise<Map<string, string>> {
  const existing = await gmail.users.labels.list({ userId: 'me' });
  const byName = new Map<string, string>();
  for (const l of existing.data.labels ?? []) {
    if (l.name && l.id) byName.set(l.name, l.id);
  }
  const out = new Map<string, string>();
  for (const name of Object.values(LABELS)) {
    let id = byName.get(name);
    if (!id) {
      const created = await gmail.users.labels.create({
        userId: 'me',
        requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
      });
      id = created.data.id ?? undefined;
    }
    if (id) out.set(name, id);
  }
  return out;
}

/** Everyone Greg knows: CRM contact emails (+alts) and internal staff. */
async function knownSenders(tenantId: string): Promise<Set<string>> {
  const known = new Set<string>();
  const contacts = await db.collection(`tenants/${tenantId}/crm_contacts`).select('email', 'altEmails').get();
  contacts.forEach((d) => {
    const e = trim(d.get('email')).toLowerCase();
    if (e) known.add(e);
    for (const alt of (d.get('altEmails') as string[] | undefined) ?? []) {
      const a = trim(alt).toLowerCase();
      if (a) known.add(a);
    }
  });
  return known;
}

interface Classified {
  category: 'junk_pitch' | 'newsletter' | 'notification' | 'business_needs_reply' | 'business_fyi' | 'personal_or_sensitive';
  summary: string;
  draftReply: string;
}

async function classifyInboxMessage(input: { from: string; subject: string; body: string }): Promise<Classified> {
  // Claude-backed since 2026-08-21 (same chat.completions shape — utils/claudeChat).
  const openai = getClaudeChat();
  const prompt = [
    `Triage one email from Greg Fielding's inbox (CEO of C1 Staffing, a national hourly staffing agency). Classify and, when a reply is needed, draft it.`,
    ``,
    `Categories:`,
    `- junk_pitch: cold sales/vendor pitch TO Greg (software, services, lending, SEO, lead-gen...). Not from a client or prospect of C1.`,
    `- newsletter: bulk content/marketing digest.`,
    `- notification: automated system/transactional mail (receipts, alerts, calendar, SaaS noise).`,
    `- business_needs_reply: a real human writing about staffing, clients, workers, partners, vendors C1 actually uses — and a response from Greg is expected.`,
    `- business_fyi: real business content, no response needed.`,
    `- personal_or_sensitive: personal, financial, legal, HR-sensitive, government — never auto-handled.`,
    `When unsure between junk and business, choose business_fyi (safe default — it stays in the inbox).`,
    ``,
    `draftReply (ONLY for business_needs_reply, else empty string) — Greg's voice: calm, brief, unhurried; ≤70 words; no over-promising, no capability lists; 1-2 short qualifying questions when natural; close "Thank you!" then sign "Greg\\nGreg Fielding · C1 Staffing · 925-448-0579". Never state prices or commit to terms — if the email asks for pricing/contracts, acknowledge and say Greg will follow up with specifics.`,
    ``,
    `From: ${input.from}`,
    `Subject: ${input.subject}`,
    `Body:\n"""${input.body}"""`,
    ``,
    `Respond ONLY with JSON: {"category":"...","summary":"<one sentence>","draftReply":"<text or empty>"}`,
  ].join('\n');
  const completion = await openai.chat.completions.create({
    model: 'gpt-5',
    messages: [
      { role: 'system', content: 'You output only valid JSON. You never invent facts or commitments.' },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
  });
  const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}') as Partial<Classified>;
  const cats = ['junk_pitch', 'newsletter', 'notification', 'business_needs_reply', 'business_fyi', 'personal_or_sensitive'];
  return {
    category: cats.includes(String(parsed.category)) ? (parsed.category as Classified['category']) : 'business_fyi',
    summary: trim(parsed.summary).slice(0, 240),
    draftReply: trim(parsed.draftReply).slice(0, 2500),
  };
}

function buildDraftMime(input: { from: string; to: string; subject: string; body: string; inReplyTo: string }): string {
  const subj = input.subject.startsWith('Re:') ? input.subject : `Re: ${input.subject}`;
  const lines = [
    `From: Greg Fielding <${input.from}>`,
    `To: ${input.to}`,
    `Subject: ${subj}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`, `References: ${input.inReplyTo}`] : []),
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    input.body,
  ];
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

export interface TriageResult {
  scanned: number; archivedJunk: number; archivedNewsletters: number; archivedNotifications: number;
  needsReply: number; fyi: number; review: number; skippedKnownOrProcessed: number; errors: number;
}

export async function triageInboxCore(tenantId: string): Promise<TriageResult> {
  const result: TriageResult = {
    scanned: 0, archivedJunk: 0, archivedNewsletters: 0, archivedNotifications: 0,
    needsReply: 0, fyi: 0, review: 0, skippedKnownOrProcessed: 0, errors: 0,
  };
  const client = await gmailClientFor(tenantId);
  if (!client) {
    logger.warn('inboxTriage: mailbox not connected');
    return result;
  }
  const { gmail, fromEmail } = client;

  let labelIds: Map<string, string>;
  try {
    labelIds = await ensureLabels(gmail);
  } catch (e) {
    // Almost certainly the gmail.modify scope hasn't been granted yet.
    logger.warn('inboxTriage: cannot manage labels — re-grant with gmail.modify needed', { e: String(e) });
    return result;
  }
  const ourLabelIds = new Set(labelIds.values());
  const known = await knownSenders(tenantId);

  const list = await gmail.users.messages.list({
    userId: 'me',
    q: 'in:inbox newer_than:3d -from:mailer-daemon -from:postmaster',
    maxResults: 60,
  });

  for (const m of list.data.messages ?? []) {
    try {
      result.scanned += 1;
      const full = await gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'full' });
      if ((full.data.labelIds ?? []).some((id) => ourLabelIds.has(id))) {
        result.skippedKnownOrProcessed += 1;
        continue; // already triaged
      }
      const from = senderEmail(full.data);
      const subject = header(full.data, 'Subject');
      const isKnown = known.has(from) || from.endsWith('@c1staffing.com');
      const hasUnsub = !!header(full.data, 'List-Unsubscribe');
      const isNoReply = /no-?reply|notifications?@|alerts?@|donotreply/i.test(from);

      const apply = async (labelName: string, archive: boolean): Promise<void> => {
        await gmail.users.messages.modify({
          userId: 'me',
          id: m.id!,
          requestBody: {
            addLabelIds: [labelIds.get(labelName)!],
            ...(archive ? { removeLabelIds: ['INBOX'] } : {}),
          },
        });
      };

      // Cheap deterministic buckets first — known senders never auto-archive.
      if (!isKnown && hasUnsub && isNoReply) {
        await apply(LABELS.newsletter, true);
        result.archivedNewsletters += 1;
        continue;
      }

      const ai = await classifyInboxMessage({ from: header(full.data, 'From'), subject, body: plainText(full.data) });

      if (ai.category === 'junk_pitch' && !isKnown) {
        await apply(LABELS.junk, true);
        result.archivedJunk += 1;
      } else if (ai.category === 'newsletter' && !isKnown) {
        await apply(LABELS.newsletter, true);
        result.archivedNewsletters += 1;
      } else if (ai.category === 'notification' && !isKnown) {
        await apply(LABELS.notification, true);
        result.archivedNotifications += 1;
      } else if (ai.category === 'business_needs_reply') {
        await apply(LABELS.needsReply, false);
        if (ai.draftReply) {
          try {
            await gmail.users.drafts.create({
              userId: 'me',
              requestBody: {
                message: {
                  threadId: full.data.threadId ?? undefined,
                  raw: buildDraftMime({
                    from: fromEmail,
                    to: header(full.data, 'From'),
                    subject,
                    body: ai.draftReply,
                    inReplyTo: header(full.data, 'Message-ID'),
                  }),
                },
              },
            });
          } catch (e) {
            logger.warn('inboxTriage: draft create failed', { e: String(e) });
          }
        }
        result.needsReply += 1;
      } else if (ai.category === 'personal_or_sensitive') {
        await apply(LABELS.review, false);
        result.review += 1;
      } else {
        await apply(LABELS.fyi, false);
        result.fyi += 1;
      }
    } catch (e) {
      result.errors += 1;
      logger.warn('inboxTriage: message failed', { id: m.id, e: String(e) });
    }
  }

  await db.doc(CFG_PATH(tenantId)).set(
    {
      lastTriageAt: admin.firestore.FieldValue.serverTimestamp(),
      lastTriageResult: result as unknown as Record<string, number>,
      counters: {
        archived: admin.firestore.FieldValue.increment(
          result.archivedJunk + result.archivedNewsletters + result.archivedNotifications,
        ),
        needsReply: admin.firestore.FieldValue.increment(result.needsReply),
      },
    },
    { merge: true },
  );
  logger.info('inboxTriage: done', result as unknown as Record<string, number>);
  return result;
}

const CAMPAIGN_MARKERS = [
  'Reply "unsubscribe"',
  'reply “unsubscribe”',
  '1309 Coffeen Ave',
  'Hourly staffing backup',
  'Fall ramp-up coverage',
];

interface DroppedBall { to: string; subject: string; daysOld: number }

async function findDroppedBalls(gmail: gmail_v1.Gmail): Promise<DroppedBall[]> {
  const sent = await gmail.users.messages.list({
    userId: 'me',
    q: 'in:sent newer_than:14d -from:mailer-daemon',
    maxResults: 80,
  });
  const byThread = new Map<string, gmail_v1.Schema$Message>();
  for (const m of sent.data.messages ?? []) {
    const full = await gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'full' });
    const t = full.data.threadId ?? m.id!;
    const prev = byThread.get(t);
    if (!prev || Number(full.data.internalDate) > Number(prev.internalDate)) byThread.set(t, full.data);
  }
  const out: DroppedBall[] = [];
  const now = Date.now();
  for (const [threadId, lastSent] of byThread) {
    const ageMs = now - Number(lastSent.internalDate ?? now);
    if (ageMs < 4 * 24 * 3600e3) continue;
    const body = plainText(lastSent);
    const subject = header(lastSent, 'Subject');
    if (CAMPAIGN_MARKERS.some((mk) => body.includes(mk) || subject.includes(mk))) continue;
    // Any reply on the thread after Greg's last message?
    const thread = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'metadata' });
    const msgs = thread.data.messages ?? [];
    const lastMsg = msgs[msgs.length - 1];
    const lastFrom = trim(lastMsg?.payload?.headers?.find((h) => h.name?.toLowerCase() === 'from')?.value);
    if (!/g\.fielding@c1staffing\.com/i.test(lastFrom)) continue; // they answered
    const to = header(lastSent, 'To');
    if (!to || /g\.fielding@c1staffing\.com/i.test(to)) continue; // self-sends (digests)
    out.push({ to: to.slice(0, 60), subject: subject.slice(0, 70), daysOld: Math.floor(ageMs / 86400e3) });
    if (out.length >= 10) break;
  }
  return out.sort((a, b) => b.daysOld - a.daysOld);
}

/**
 * Pending worker account-deletion requests (`account_deletion_requests`,
 * filed from the worker app's About & Legal page). Nothing else notifies
 * staff when one lands (Greg, 2026-08-24) — the brief is the alert.
 * Returns null when the queue is empty so the brief stays tight.
 */
export async function buildDeletionRequestsSection(): Promise<string | null> {
  const snap = await db
    .collection('account_deletion_requests')
    .where('status', '==', 'pending')
    .limit(20)
    .get();
  if (snap.empty) return null;
  const nowMs = Date.now();
  const lines = await Promise.all(
    snap.docs.map(async (d) => {
      const x = d.data() as Record<string, unknown>;
      const requestedAt = (x.requestedAt as admin.firestore.Timestamp | undefined)?.toMillis?.();
      const daysOld = requestedAt ? Math.floor((nowMs - requestedAt) / 86400e3) : null;
      let name = trim(x.email as string) || d.id;
      let hasPayroll = false;
      try {
        const u = await db.collection('users').doc(d.id).get();
        if (u.exists) {
          const full = `${trim(u.get('firstName'))} ${trim(u.get('lastName'))}`.trim();
          if (full) name = `${full} (${trim(x.email as string) || 'no email'})`;
          const taxIdentity = u.get('taxIdentity') as Record<string, unknown> | undefined;
          hasPayroll = Boolean(taxIdentity?.source === 'everee' || u.get('last4SSN') || u.get('evereeWorkerId'));
        } else {
          name = `${name} — account already deleted`;
        }
      } catch { /* keep the email/uid line */ }
      const age = daysOld === null ? '' : daysOld === 0 ? ' — today' : ` — ${daysOld} day${daysOld === 1 ? '' : 's'} ago`;
      return `• ${name}${age}${hasPayroll ? ' — HAS PAYROLL (retain, do not hard-delete)' : ''}`;
    }),
  );
  return (
    `ACCOUNT DELETION REQUESTS (${snap.size} pending):\n${lines.join('\n')}\n` +
    `Review: https://hrxone.com/users/deletion-requests`
  );
}

export async function morningBriefCore(tenantId: string): Promise<{ sent: boolean }> {
  const client = await gmailClientFor(tenantId);
  if (!client) return { sent: false };
  const { gmail, fromEmail } = client;
  const sections: string[] = [];

  // 1. Needs your reply (still in inbox with our label)
  try {
    const nr = await gmail.users.messages.list({ userId: 'me', q: 'in:inbox label:hrx-needs-reply', maxResults: 10 });
    const lines: string[] = [];
    for (const m of nr.data.messages ?? []) {
      const full = await gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'metadata', metadataHeaders: ['From', 'Subject'] });
      lines.push(`• ${header(full.data, 'From').slice(0, 50)} — ${header(full.data, 'Subject').slice(0, 70)} (draft ready in thread)`);
    }
    if (lines.length) sections.push(`NEEDS YOUR REPLY (${lines.length}):\n${lines.join('\n')}`);
  } catch { /* label may not exist pre-grant */ }

  // 2. Dropped balls
  try {
    const balls = await findDroppedBalls(gmail);
    if (balls.length) {
      sections.push(
        `WAITING ON THEM — no answer to your last message (${balls.length}):\n` +
        balls.map((b) => `• ${b.to} — "${b.subject}" — ${b.daysOld} days`).join('\n'),
      );
    }
  } catch (e) {
    logger.warn('morningBrief: dropped-ball scan failed', { e: String(e) });
  }

  // 3. Hot leads last 24h
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 3600e3);
  const hot = await db.collection(`tenants/${tenantId}/crm_contacts`).where('hotUpdatedAt', '>=', since).get();
  const hotLines = hot.docs
    .filter((d) => d.get('hot') === true)
    .slice(0, 8)
    .map((d) => `• ${trim(d.get('fullName'))} — ${trim(d.get('jobTitle'))} @ ${trim(d.get('companyName'))}`);
  if (hotLines.length) sections.push(`NEW HOT LEADS (24h):\n${hotLines.join('\n')}`);

  // 3.5 Worker account-deletion requests (App Store compliance queue)
  try {
    const del = await buildDeletionRequestsSection();
    if (del) sections.push(del);
  } catch (e) {
    logger.warn('morningBrief: deletion-requests scan failed', { e: String(e) });
  }

  // 4. Campaign pulse
  const bounced24 = await db.collection(`tenants/${tenantId}/crm_contacts`).where('emailBouncedAt', '>=', since).get();
  const pendingReplies = await db
    .collection(`tenants/${tenantId}/sodexo_outreach_replies`)
    .where('status', '==', 'pending')
    .get();
  const cfg = await db.doc(CFG_PATH(tenantId)).get();
  const archivedTotal = Number(cfg.get('counters')?.archived ?? 0);
  sections.push(
    `PULSE: ${pendingReplies.size} repl${pendingReplies.size === 1 ? 'y' : 'ies'} awaiting your click · ` +
    `${bounced24.size} new bounce${bounced24.size === 1 ? '' : 's'} (auto-handled) · ` +
    `${archivedTotal} junk emails suppressed to date`,
  );

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' });
  const body = `Good morning — here's the desk as of ${today}.\n\n${sections.join('\n\n')}\n\n— your inbox chief of staff`;
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: Buffer.from(
        [
          `From: Greg Fielding <${fromEmail}>`,
          `To: ${fromEmail}`,
          `Subject: Morning brief — ${today}`,
          'Content-Type: text/plain; charset="UTF-8"',
          '',
          body,
        ].join('\r\n'),
      ).toString('base64url'),
    },
  });
  return { sent: true };
}

export const inboxTriageCron = onSchedule(
  { schedule: '0 7-18/2 * * 1-6', timeZone: 'America/Los_Angeles', memory: '512MiB', timeoutSeconds: 540 },
  async () => {
    const cfg = await db.doc(CFG_PATH(PRIMARY_TENANT)).get();
    if (cfg.exists && cfg.get('enabled') === false) return;
    await triageInboxCore(PRIMARY_TENANT);
  },
);

export const inboxMorningBriefCron = onSchedule(
  { schedule: '30 6 * * 1-5', timeZone: 'America/Los_Angeles', memory: '512MiB', timeoutSeconds: 540 },
  async () => {
    const cfg = await db.doc(CFG_PATH(PRIMARY_TENANT)).get();
    if (cfg.exists && cfg.get('enabled') === false) return;
    await morningBriefCore(PRIMARY_TENANT);
  },
);

export const inboxTriageNow = onCall({ cors: true, memory: '512MiB', timeoutSeconds: 540 }, async (request) => {
  const tenantId = trim(request.data?.tenantId) || PRIMARY_TENANT;
  await ensureInternalStaff(request.auth?.uid, tenantId);
  return await triageInboxCore(tenantId);
});

export const inboxMorningBriefNow = onCall({ cors: true, memory: '512MiB', timeoutSeconds: 540 }, async (request) => {
  const tenantId = trim(request.data?.tenantId) || PRIMARY_TENANT;
  await ensureInternalStaff(request.auth?.uid, tenantId);
  return await morningBriefCore(tenantId);
});
