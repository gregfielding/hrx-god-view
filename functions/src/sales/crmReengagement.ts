/**
 * CRM-wide re-engagement campaign (Greg 2026-08-11) — the Sodexo rails
 * pointed at the rest of the book.
 *
 * Pool: every crm_contact with an email EXCEPT (a) Sodexo-campus-scrape
 * contacts (their own campaign), (b) anyone already emailed by the Sodexo
 * campaign (email dedupe), (c) contacts whose company is on Greg's active-
 * customer denylist (Indeed Flex, Monument Consulting, Venuesmart, Proof of
 * the Pudding, RS3, Contigo Catering, G6 Catering — name variants covered),
 * (d) @c1staffing.com internals, (e) duplicate emails (first doc wins).
 * ~1,549 eligible at build time.
 *
 * Same COST DESIGN as sodexoOutreach: send-only, no cron/watch — each batch
 * is Greg's explicit Preview→Send click from the Re-engagement CRM tab.
 * Follow-up touches do a targeted per-contact Gmail reply check (human
 * replies only — OOO autoresponders don't count) and exit repliers. The
 * shared reply desk (sodexoReplies.ts) scans/classifies/answers replies for
 * BOTH campaigns.
 *
 * State per contact: crm_contact.crmReengagement { touch1SentAt..touch3SentAt,
 * repliedAt, optedOut, processedReplyMsgIds }. Batch log:
 * tenants/{t}/crm_reengagement_batches.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import { ensureInternalStaff, gmailClientFor } from './sodexoReplies';
import { isSuppressed, loadSuppressions } from './outreachSuppressions';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const SODEXO_LEAD_SOURCE = 'Sodexo Campus Scrape (sodexomyway.com)';
const DENY_COMPANIES: RegExp[] = [
  /indeed\s*flex/i,
  /monument\s*consulting/i,
  /venue\s*smart/i,
  /proof of the pudding/i,
  /\brs3\b/i,
  /contigo/i,
  /\bg6\b/i,
];
const TOUCH2_MIN_MS = 4 * 24 * 60 * 60 * 1000;
const TOUCH3_MIN_MS = 5 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 150;

const trim = (v: unknown): string => String(v ?? '').trim();

const FOOTER =
  '\n\n—\nGreg Fielding · C1 Staffing · 925-448-0579\n' +
  'linkedin.com/in/gregpfielding · c1staffing.com\n' +
  '1309 Coffeen Ave STE 1200, Sheridan, WY 82801\n' +
  'Reply "unsubscribe" and you will not hear from us again.';

function template(touch: number, firstName: string, company: string): { subject: string; body: string } {
  const first = firstName || 'there';
  const co = company || '';
  if (touch === 1) {
    return {
      subject: co ? `Hourly staffing backup for ${co}` : 'Hourly staffing backup',
      body:
        `Hi ${first},\n\n` +
        `Greg Fielding here — I run C1 Staffing. You've been in our network for a while and I wanted to reconnect as we head into the fall rush.\n\n` +
        `We field W-2 hourly crews nationwide — warehouse, food service, events, janitorial — with payroll, workers' comp, and onboarding all on us. No minimums or contracts: plenty of clients started with a single shift to cover a call-off.\n\n` +
        `What roles are hardest for ${co || 'your team'} to keep filled right now?${FOOTER}`,
    };
  }
  if (touch === 2) {
    return {
      subject: 'One shift, zero risk',
      body:
        `Hi ${first},\n\n` +
        `Following up on my note — the easiest way to size us up is a single shift. Send the role, time, and address, and we'll have a vetted, W-2 worker there. If they're not great, you don't use us again.\n\n` +
        `Where do call-offs hurt ${co || 'you'} most?${FOOTER}`,
    };
  }
  return {
    subject: 'Last note',
    body:
      `Hi ${first},\n\n` +
      `Last note from me. If staffing's covered, that's great news. If a gap opens mid-season — call-offs, an event surge, a hiring freeze — we can usually field people within a week.\n\n` +
      `Either way, I'll leave you be. Good luck this fall.${FOOTER}`,
  };
}

function buildMime(from: string, to: string, subject: string, body: string): string {
  const msg =
    `From: Greg Fielding <${from}>\r\n` +
    `To: ${to}\r\n` +
    `Subject: ${subject}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: text/plain; charset="UTF-8"\r\n\r\n` +
    body;
  return Buffer.from(msg).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface Candidate {
  ref: FirebaseFirestore.DocumentReference;
  email: string;
  firstName: string;
  companyName: string;
  touch1At: number | null;
  touch2At: number | null;
  verified: boolean;
}

/**
 * One pass over crm_contacts (+ crm_companies for name fallback) applying
 * Greg's denylist rule, returning per-touch eligible candidates.
 */
async function eligibleCandidates(tenantId: string, touch: number): Promise<Candidate[]> {
  // Do-not-contact suppression list (2026-08-14): domains + companies whose
  // people asked never to be contacted — covers contacts imported later,
  // which per-contact optedOut stamps can't.
  const suppressions = await loadSuppressions(db, tenantId);
  const cos = await db.collection(`tenants/${tenantId}/crm_companies`).select('name', 'companyName').get();
  const compNameById = new Map<string, string>();
  cos.forEach((d) => compNameById.set(d.id, trim(d.data().name) || trim(d.data().companyName)));

  const snap = await db.collection(`tenants/${tenantId}/crm_contacts`).get();
  const sodexoEmails = new Set<string>();
  snap.forEach((d) => {
    const v = d.data();
    if ((trim(v.leadSource) || trim(v.source)).startsWith('Sodexo Campus Scrape')) {
      const e = trim(v.email).toLowerCase();
      if (e) sodexoEmails.add(e);
    }
  });

  const now = Date.now();
  const seen = new Set<string>();
  const out: Candidate[] = [];
  snap.forEach((d) => {
    const v = d.data();
    const src = trim(v.leadSource) || trim(v.source);
    if (src.startsWith('Sodexo Campus Scrape')) return;
    const email = trim(v.email).toLowerCase();
    if (!email || email.endsWith('@c1staffing.com')) return;
    if (sodexoEmails.has(email) || seen.has(email)) return;
    seen.add(email);
    const companyName = trim(v.companyName) || compNameById.get(trim(v.companyId)) || '';
    if (companyName && DENY_COMPANIES.some((re) => re.test(companyName))) return;
    if (isSuppressed(suppressions, email, [companyName, trim(v.accountName), trim(v.campusName)])) return;
    const re = (v.crmReengagement ?? {}) as Record<string, unknown>;
    if (re.optedOut === true || re.repliedAt) return;
    if (v.emailBounced === true) return; // dead address (bounce sweep) — no more sends until rescued
    const ms = (x: unknown): number | null =>
      (x as admin.firestore.Timestamp | undefined)?.toMillis ? (x as admin.firestore.Timestamp).toMillis() : null;
    // Cross-channel suppression (Greg 2026-08-12): the LinkedIn desk skips
    // anyone emailed in the last 7 days — mirror it here so a contact DM'd
    // on LinkedIn this week doesn't also get a campaign email, and one who
    // REPLIED on LinkedIn never gets boilerplate (that conversation is live).
    const lo = (v.linkedinOutreach ?? {}) as Record<string, unknown>;
    if (lo.repliedAt) return;
    const liMsgAt = ms(lo.messagedAt);
    if (liMsgAt && now - liMsgAt < 7 * 24 * 3600e3) return;
    const t1 = ms(re.touch1SentAt);
    const t2 = ms(re.touch2SentAt);
    const t3 = ms(re.touch3SentAt);
    if (touch === 1 && t1) return;
    if (touch === 2 && (!t1 || t2 || now - t1 < TOUCH2_MIN_MS)) return;
    if (touch === 3 && (!t2 || t3 || now - t2 < TOUCH3_MIN_MS)) return;
    out.push({
      ref: d.ref,
      email,
      firstName: trim(v.firstName),
      companyName,
      touch1At: t1,
      touch2At: t2,
      verified: v.verifiedEmail === true,
    });
  });
  // Verified addresses first (2026-08-12 bounce response): the Apollo-checked
  // majority sends before the unverifiable tail, keeping daily bounce rates
  // low while the cron sweep retires the tail's failures one by one.
  out.sort((a, b) => Number(b.verified) - Number(a.verified));
  return out;
}

export const getCrmReengagementStatus = onCall({ cors: true, memory: '512MiB', timeoutSeconds: 120 }, async (request) => {
  const tenantId = trim(request.data?.tenantId);
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
  await ensureInternalStaff(request.auth?.uid, tenantId);
  const cfg = (await db.doc(`tenants/${tenantId}/integrations/salesOutreachMailbox`).get()).data() ?? {};
  const counts: Record<string, number> = {};
  for (const t of [1, 2, 3]) {
    counts[`touch${t}`] = (await eligibleCandidates(tenantId, t)).length;
  }
  const batches = await db
    .collection(`tenants/${tenantId}/crm_reengagement_batches`)
    .orderBy('sentAt', 'desc')
    .limit(10)
    .get()
    .catch(() => null);
  const autopilot = ((await AUTOPILOT_CFG(tenantId).get()).data() ?? {}) as Record<string, unknown>;
  return {
    connected: (cfg as Record<string, unknown>).connected === true,
    email: trim(((cfg as Record<string, unknown>).gmailTokens as Record<string, unknown>)?.email) || null,
    expectedEmail: trim((cfg as Record<string, unknown>).expectedEmail) || 'g.fielding@c1staffing.com',
    eligible: counts,
    autopilot: { enabled: autopilot.enabled === true, dailyLimit: Number(autopilot.dailyLimit) || 60 },
    recentBatches: (batches?.docs ?? []).map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })),
  };
});

export const crmReengagementSendBatch = onCall(
  { cors: true, memory: '1GiB', timeoutSeconds: 540 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    const touch = Number(request.data?.touch);
    const limit = Math.max(1, Math.min(MAX_LIMIT, Number(request.data?.limit) || DEFAULT_LIMIT));
    const dryRun = request.data?.dryRun !== false; // default TRUE — sending is the explicit path
    if (!tenantId || ![1, 2, 3].includes(touch)) {
      throw new HttpsError('invalid-argument', 'tenantId and touch (1|2|3) are required.');
    }
    await ensureInternalStaff(request.auth?.uid, tenantId);

    const candidates = (await eligibleCandidates(tenantId, touch)).slice(0, limit);
    if (dryRun) {
      const sample = template(touch, candidates[0]?.firstName ?? 'there', candidates[0]?.companyName ?? '');
      return {
        dryRun: true,
        count: candidates.length,
        sampleSubject: candidates.length ? sample.subject : null,
        preview: candidates.slice(0, 15).map((c) => ({
          email: c.email,
          firstName: c.firstName,
          campus: c.companyName, // panel renders this field as the org column
        })),
      };
    }

    const result = await executeSendBatch(tenantId, touch, candidates, request.auth?.uid ?? null, 'manual');
    return { dryRun: false, ...result };
  },
);

/**
 * The one send path — shared by the panel's Send click and the business-day
 * autopilot. Candidates are pre-sliced by the caller.
 */
async function executeSendBatch(
  tenantId: string,
  touch: number,
  candidates: Candidate[],
  sentBy: string | null,
  source: 'manual' | 'autopilot',
): Promise<{ sent: number; skippedReplied: number; errors: string[] }> {
  const client = await gmailClientFor(tenantId);
  if (!client) throw new HttpsError('failed-precondition', 'Mailbox not connected — connect it on the Sodexo tab first.');
  const { gmail, fromEmail } = client;

  const batchRef = db.collection(`tenants/${tenantId}/crm_reengagement_batches`).doc();
  let sent = 0;
  let skippedReplied = 0;
  const errors: string[] = [];
  for (const c of candidates) {
      // Follow-ups: targeted human-reply check (auto-reply subjects ignored)
      // — repliers exit the sequence and land in the shared reply desk.
      if (touch > 1 && c.touch1At) {
        try {
          const q = `from:${c.email} after:${Math.floor(c.touch1At / 1000)}`;
          const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: 3 });
          let humanReply = false;
          for (const m of res.data.messages ?? []) {
            if (!m.id) continue;
            const meta = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['Subject'] });
            const subject = meta.data.payload?.headers?.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? '';
            if (!/^(automatic reply|auto(matic)?[- ]?reply|out of office)/i.test(subject.trim())) {
              humanReply = true;
              break;
            }
          }
          if (humanReply) {
            await c.ref.set(
              { crmReengagement: { repliedAt: admin.firestore.FieldValue.serverTimestamp() } },
              { mergeFields: ['crmReengagement.repliedAt'] },
            );
            skippedReplied += 1;
            continue;
          }
        } catch (e) {
          logger.warn('crmReengagement: reply check failed — sending anyway', { email: c.email, e: String(e) });
        }
      }
      try {
        const t = template(touch, c.firstName, c.companyName);
        await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: buildMime(fromEmail, c.email, t.subject, t.body) },
        });
        await c.ref.set(
          { crmReengagement: { [`touch${touch}SentAt`]: admin.firestore.FieldValue.serverTimestamp() } },
          { mergeFields: [`crmReengagement.touch${touch}SentAt`] },
        );
        sent += 1;
      } catch (e) {
        errors.push(`${c.email}: ${e instanceof Error ? e.message : String(e)}`);
      }
      // Human pacing between sends.
      await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 500)));
    }
    await batchRef.set({
      touch,
      sent,
      skippedReplied,
      errors: errors.slice(0, 20),
      requested: candidates.length,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      sentBy,
      source,
    });
  logger.info('crmReengagement: batch complete', { touch, sent, skippedReplied, errors: errors.length, source });
  return { sent, skippedReplied, errors };
}

/** Single-tenant reality — the cron has no caller to read a tenant from. */
const PRIMARY_TENANT = 'BCiP2bQ9CgVOCTfV6MhD';
const AUTOPILOT_CFG = (tenantId: string) => db.doc(`tenants/${tenantId}/integrations/crmReengagementAutopilot`);

/**
 * Business-day autopilot (Greg 2026-08-11: "sends 60 per business day? All
 * of touch one, then touch 2, etc"): every Mon–Fri at 9am PT, send up to the
 * daily limit, filling from touch 1 FIRST — touches 2/3 only get budget once
 * earlier touches have no eligible candidates left (their own ≥4d/≥5d
 * spacing still applies). The panel's Autopilot toggle is the kill switch;
 * a missing/false config doc means OFF.
 */
export const crmReengagementDailyCron = onSchedule(
  {
    schedule: '0 9 * * 1-5',
    timeZone: 'America/Los_Angeles',
    region: 'us-central1',
    memory: '1GiB',
    timeoutSeconds: 540,
  },
  async () => {
    const cfg = (await AUTOPILOT_CFG(PRIMARY_TENANT).get()).data() ?? {};
    if ((cfg as Record<string, unknown>).enabled !== true) {
      logger.info('crmReengagement autopilot: disabled — skipping');
      return;
    }
    const dailyLimit = Math.max(1, Math.min(MAX_LIMIT, Number((cfg as Record<string, unknown>).dailyLimit) || 60));
    let remaining = dailyLimit;
    const summary: Record<string, number> = {};
    for (const touch of [1, 2, 3]) {
      if (remaining <= 0) break;
      const candidates = (await eligibleCandidates(PRIMARY_TENANT, touch)).slice(0, remaining);
      if (candidates.length === 0) continue;
      const res = await executeSendBatch(PRIMARY_TENANT, touch, candidates, null, 'autopilot');
      summary[`touch${touch}`] = res.sent;
      remaining -= res.sent;
    }
    logger.info('crmReengagement autopilot: day complete', { dailyLimit, ...summary });
  },
);

/** Panel toggle for the autopilot — staff-gated; also sets dailyLimit. */
export const setCrmReengagementAutopilot = onCall({ cors: true }, async (request) => {
  const tenantId = trim(request.data?.tenantId) || PRIMARY_TENANT;
  const enabled = request.data?.enabled === true;
  await ensureInternalStaff(request.auth?.uid, tenantId);
  await AUTOPILOT_CFG(tenantId).set(
    {
      enabled,
      dailyLimit: Math.max(1, Math.min(MAX_LIMIT, Number(request.data?.dailyLimit) || 60)),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: request.auth?.uid ?? null,
    },
    { merge: true },
  );
  return { ok: true, enabled };
});
