/**
 * Sodexo contact intro (Greg 2026-09-11): when a contact is attached to a
 * new Sodexo job order (the Fieldglass hiring-manager attach, or a
 * recruiter adding one on the Deal Contacts card), email them FROM and AS
 * Deborah (deborahMailbox.ts) so replies land in her inbox — during the
 * contact's morning/daytime, never overnight — and send a second email in
 * the same thread 48 hours later when nobody replied.
 *
 * Two entry points:
 *  - runSodexoContactIntro — called from onJobOrderStatusTransitionSnapshot
 *    (existing job_orders write trigger). Queues the intro for
 *    INTRO_SETTLE_MS from now, pushed into the send window (8 AM–6 PM
 *    contact-local, by worksite state). Never throws into the host trigger.
 *  - sodexoContactIntroCron — every 15 minutes: delivers queued intros and
 *    runs due follow-ups.
 *
 * Gates:
 *  - Sodexo JO + a contact newly present in deal.associations.contacts
 *    (cheap in-memory checks — every other JO write stops here).
 *  - tenants/{t}/integrations/sodexoContactIntro.enabled === true
 *    (kill switch; missing doc = off; the cron also stops) and the JO was
 *    created at/after `enabledSince` (no retroactive blast).
 *  - SODEXO_INTRO_TEMPLATE set (follow-ups also need SODEXO_FOLLOW_UP_TEMPLATE).
 *  - Contact not internal, not bounced / opted out / suppressed — re-checked
 *    before every send, including the follow-up.
 *  - Once per email address, ever: tenants/{t}/sodexo_contact_intros/{email}
 *    claimed in a transaction. Delete a row to let that contact be
 *    re-evaluated.
 *  - Intro: skipped if Deborah already corresponds with them.
 *    Follow-up: skipped on any human reply, a bounce (contact flagged
 *    emailBounced), or Deborah having written them herself; out-of-office
 *    auto-replies don't count.
 *  - Anything more than MAX_LATE_MS overdue is dropped, not sent stale.
 *  - `dryRun: true` renders + records both emails without sending (dry_run
 *    rows don't block a later live send; the cron does nothing).
 *
 * Ledger status: queued → sending → sent → followup_sending →
 * followup_sent | replied | bounced | complete (followUpSkipReason);
 * terminal elsewhere: skipped | failed | followup_failed | dry_run.
 * `nextActionAt` is set only while something is scheduled.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import type { gmail_v1 } from 'googleapis';
import { isSuppressed, loadSuppressions, type Suppressions } from './outreachSuppressions';
import {
  DEBORAH_EMAIL,
  deborahGmail,
  deborahHasCorrespondedWith,
  deborahMailSince,
  sendAsDeborah,
} from './deborahMailbox';
import {
  DEFAULT_CONTACT_TZ,
  FOLLOW_UP_DELAY_MS,
  INTRO_SETTLE_MS,
  MAX_LATE_MS,
  type JoContactRef,
  classifyReplyState,
  contactBlockReason,
  contactTimeZone,
  emptyPlaceholders,
  followUpDueAt,
  followUpSubject,
  introLedgerId,
  introTemplateVars,
  isCandidateInMind,
  isInternalEmail,
  isSodexoJobOrder,
  isWithinSendWindow,
  newlyAddedContacts,
  nextSendTime,
  normalizeEmail,
  renderTemplate,
  toMillis,
} from './sodexoContactIntroRules';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

type Doc = Record<string, unknown>;

/**
 * Greg's scripts. Nothing sends while the intro is null; no follow-ups go
 * while the follow-up is null. Merge fields:
 * {{firstName}} {{fullName}} {{jobTitle}} {{siteName}} {{city}} {{state}}
 * {{startDate}} {{poNumber}} {{jobOrderNumber}} {{headcount}}.
 * Plain text ending at the sign-off ("Thank you!") — NO signature: her real
 * Gmail signature (logo included) is appended at send time by
 * sendAsDeborah. Leave the follow-up subject out to send it as
 * "Re: <intro subject>" in the same thread.
 */
export const SODEXO_INTRO_TEMPLATE: { subject: string; body: string } | null = {
  subject: 'Your {{jobTitle}} order – {{poNumber}}',
  body:
    'Hi {{firstName}},\n\n' +
    "We're already recruiting for your {{jobTitle}} order ({{poNumber}}).\n\n" +
    'Should I submit candidates straight into Fieldglass, or send you resumes first?\n\n' +
    'Working hard for you!',
};
export const SODEXO_FOLLOW_UP_TEMPLATE: { subject?: string; body: string } | null = {
  body:
    'Hi {{firstName}},\n\n' +
    'Is {{poNumber}} still open? I can get candidates into Fieldglass as soon as you give the word.\n\n' +
    'Working hard for you!',
};

const MAX_DUE_PER_TICK = 50;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const configRef = (tenantId: string) => db.doc(`tenants/${tenantId}/integrations/sodexoContactIntro`);
const ledgerCol = (tenantId: string) => db.collection(`tenants/${tenantId}/sodexo_contact_intros`);
const contactRef = (tenantId: string, contactId: string) => db.doc(`tenants/${tenantId}/crm_contacts/${contactId}`);

function renderFollowUp(introSubject: string, vars: Record<string, string>): { subject: string; body: string } | null {
  if (!SODEXO_FOLLOW_UP_TEMPLATE) return null;
  const override = SODEXO_FOLLOW_UP_TEMPLATE.subject ? renderTemplate(SODEXO_FOLLOW_UP_TEMPLATE.subject, vars) : undefined;
  return { subject: followUpSubject(introSubject, override), body: renderTemplate(SODEXO_FOLLOW_UP_TEMPLATE.body, vars) };
}

function blockReason(contact: Doc | null, email: string, companyNames: string[], suppressions: Suppressions): string | null {
  return contactBlockReason(contact) ?? (isSuppressed(suppressions, email, companyNames) ? 'suppressed' : null);
}

async function readContact(tenantId: string, contactId: string): Promise<Doc | null> {
  if (!contactId) return null;
  const snap = await contactRef(tenantId, contactId).get();
  return snap.exists ? (snap.data() as Doc) : null;
}

/**
 * Re-read at send time: an email-first Fieldglass order gets
 * fieldglass.candidateInMind stamped by the backfill AFTER its contact was
 * attached, and a JO can be deleted while an intro waits.
 */
async function jobOrderBlockReason(tenantId: string, jobOrderId: string): Promise<string | null> {
  if (!jobOrderId) return null;
  const snap = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get();
  if (!snap.exists) return 'job_order_deleted';
  return isCandidateInMind(snap.data() as Doc) ? 'candidate_in_mind' : null;
}

/** Best-effort patch of the CRM contact (never creates a doc). */
async function patchContact(tenantId: string, contactId: string, patch: Doc): Promise<void> {
  if (!contactId) return;
  try {
    await contactRef(tenantId, contactId).update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
  } catch (err) {
    logger.warn('[sodexoContactIntro] contact stamp failed', { tenantId, contactId, err: err instanceof Error ? err.message : String(err) });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Trigger path: new contact on a Sodexo JO
// ─────────────────────────────────────────────────────────────────────

export async function runSodexoContactIntro(params: {
  tenantId: string;
  jobOrderId: string;
  before: Doc | null;
  after: Doc | null;
}): Promise<void> {
  const { tenantId, jobOrderId, before, after } = params;
  if (!after || !isSodexoJobOrder(after)) return;
  const added = newlyAddedContacts(before, after);
  if (added.length === 0) return;

  const logCtx = { tenantId, jobOrderId, jobOrderNumber: after.jobOrderNumber ?? null };
  const cfg = (await configRef(tenantId).get()).data() ?? {};
  if (cfg.enabled !== true) {
    logger.info('[sodexoContactIntro] disabled — not sending', { ...logCtx, added: added.length });
    return;
  }
  if (!SODEXO_INTRO_TEMPLATE) {
    logger.warn('[sodexoContactIntro] enabled but no template set — not sending', logCtx);
    return;
  }
  const enabledSince = toMillis(cfg.enabledSince);
  const createdAt = toMillis(after.createdAt);
  if (!enabledSince || !createdAt || createdAt < enabledSince) {
    logger.info('[sodexoContactIntro] JO predates enablement — not sending', { ...logCtx, enabledSince, createdAt });
    return;
  }

  const dryRun = cfg.dryRun === true;
  const gmail = await deborahGmail(tenantId);
  if (!gmail && !dryRun) {
    logger.warn("[sodexoContactIntro] Deborah's mailbox not connected — not sending", logCtx);
    return;
  }
  const suppressions = await loadSuppressions(db, tenantId);

  for (const ref of added) {
    try {
      await introOne({ tenantId, jobOrderId, jo: after, ref, dryRun, suppressions });
    } catch (err) {
      logger.error('[sodexoContactIntro] contact failed', {
        ...logCtx,
        contactId: ref.id || null,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function introOne(p: {
  tenantId: string;
  jobOrderId: string;
  jo: Doc;
  ref: JoContactRef;
  dryRun: boolean;
  suppressions: Suppressions;
}): Promise<void> {
  const { tenantId, jobOrderId, jo, ref, dryRun, suppressions } = p;
  const contact = await readContact(tenantId, ref.id);

  const email = normalizeEmail(contact?.email) || ref.email;
  if (!email || isInternalEmail(email)) return; // nothing to send to / our own staff — no ledger row

  const firstName = str(contact?.firstName) || ref.firstName;
  const fullName = str(contact?.fullName) || ref.fullName;
  const vars = introTemplateVars(jo, { firstName, fullName });
  const subject = renderTemplate(SODEXO_INTRO_TEMPLATE!.subject, vars);
  const body = renderTemplate(SODEXO_INTRO_TEMPLATE!.body, vars);
  const timeZone = contactTimeZone(jo);
  const companyNames = [str(jo.companyName), str(contact?.companyName)];

  // Every intro waits at least INTRO_SETTLE_MS and goes out via the cron,
  // which re-reads the JO first (candidateInMind can land after the contact).
  const now = Date.now();
  const sendAt = nextSendTime(now + INTRO_SETTLE_MS, timeZone);
  // A field the scripts use that's blank on this JO ("order ()") would read
  // as broken automation — skip rather than send it.
  const emptyFields = emptyPlaceholders(
    [SODEXO_INTRO_TEMPLATE!.subject, SODEXO_INTRO_TEMPLATE!.body, SODEXO_FOLLOW_UP_TEMPLATE?.subject ?? '', SODEXO_FOLLOW_UP_TEMPLATE?.body ?? ''].join('\n'),
    vars,
  );
  const skipReason =
    (isCandidateInMind(jo) ? 'candidate_in_mind' : null) ??
    blockReason(contact, email, companyNames, suppressions) ??
    (emptyFields.length ? `missing_fields:${emptyFields.join(',')}` : null);
  const status = skipReason ? 'skipped' : dryRun ? 'dry_run' : 'queued';

  const record: Doc = {
    email,
    contactId: ref.id || null,
    contactName: fullName || firstName || null,
    companyNames,
    jobOrderId,
    jobOrderNumber: jo.jobOrderNumber ?? null,
    poNumber: jo.poNumber ?? null,
    siteName: vars.siteName || null,
    timeZone,
    from: DEBORAH_EMAIL,
    subject,
    body,
    vars,
    status,
    skipReason: skipReason ?? null,
    nextActionAt: status === 'queued' ? Timestamp.fromMillis(sendAt) : null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (status === 'dry_run') {
    record.wouldSendAt = Timestamp.fromMillis(sendAt);
    record.wouldFollowUpAt = Timestamp.fromMillis(followUpDueAt(sendAt, timeZone));
    record.followUpPreview = renderFollowUp(subject, vars);
  }

  // Claim the address. Anything but a dry_run row means this contact was
  // already decided (queued, sent, skipped, failed, or mid-send elsewhere).
  const lref = ledgerCol(tenantId).doc(introLedgerId(email));
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(lref);
    if (snap.exists && snap.data()?.status !== 'dry_run') return false;
    tx.set(lref, record);
    return true;
  });
  logger.info('[sodexoContactIntro] recorded', {
    tenantId,
    jobOrderId,
    email,
    status: claimed ? status : 'already_handled',
    skipReason,
    sendAt: claimed && status === 'queued' ? new Date(sendAt).toISOString() : null,
  });
}

/** Row is claimed as `sending`. Prior-correspondence check, send, schedule the follow-up. */
async function deliverIntro(
  tenantId: string,
  lref: FirebaseFirestore.DocumentReference,
  rec: Doc,
  gmail: gmail_v1.Gmail,
): Promise<void> {
  const email = str(rec.email);
  if (await deborahHasCorrespondedWith(gmail, email)) {
    await lref.update({ status: 'skipped', skipReason: 'prior_correspondence', nextActionAt: null, updatedAt: FieldValue.serverTimestamp() });
    logger.info('[sodexoContactIntro] Deborah already corresponds with contact — skipped', { tenantId, email });
    return;
  }
  try {
    const sent = await sendAsDeborah(gmail, { to: email, subject: str(rec.subject), body: str(rec.body) });
    const followUpAt = followUpDueAt(Date.now(), str(rec.timeZone) || DEFAULT_CONTACT_TZ);
    await lref.update({
      status: 'sent',
      gmailMessageId: sent.messageId,
      gmailThreadId: sent.threadId,
      rfcMessageId: sent.rfcMessageId,
      signatureSource: sent.signatureSource,
      sentAt: FieldValue.serverTimestamp(),
      nextActionAt: Timestamp.fromMillis(followUpAt),
      followUpDueAt: Timestamp.fromMillis(followUpAt),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await patchContact(tenantId, str(rec.contactId), {
      sodexoContactIntro: {
        sentAt: FieldValue.serverTimestamp(),
        from: DEBORAH_EMAIL,
        jobOrderId: rec.jobOrderId ?? null,
        gmailMessageId: sent.messageId,
        gmailThreadId: sent.threadId,
      },
    });
    logger.info('[sodexoContactIntro] intro sent', { tenantId, email, gmailMessageId: sent.messageId, followUpAt: new Date(followUpAt).toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await lref.update({ status: 'failed', error: message, nextActionAt: null, updatedAt: FieldValue.serverTimestamp() });
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Cron: queued intros + 48h follow-ups
// ─────────────────────────────────────────────────────────────────────

export const sodexoContactIntroCron = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'America/Los_Angeles',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300,
    maxInstances: 1,
  },
  async () => {
    const tenants = await db.collection('tenants').listDocuments();
    for (const tenant of tenants) {
      try {
        await runDueIntroActions(tenant.id);
      } catch (err) {
        logger.error('[sodexoContactIntro] cron tenant failed', { tenantId: tenant.id, err: err instanceof Error ? err.message : String(err) });
      }
    }
  },
);

export async function runDueIntroActions(tenantId: string): Promise<void> {
  const cfg = (await configRef(tenantId).get()).data();
  if (cfg?.enabled !== true || cfg.dryRun === true) return;
  const due = await ledgerCol(tenantId)
    .where('nextActionAt', '<=', Timestamp.fromMillis(Date.now()))
    .limit(MAX_DUE_PER_TICK)
    .get();
  if (due.empty) return;
  const gmail = await deborahGmail(tenantId);
  if (!gmail) {
    logger.warn("[sodexoContactIntro] Deborah's mailbox not connected — due actions waiting", { tenantId, due: due.size });
    return;
  }
  const suppressions = await loadSuppressions(db, tenantId);
  for (const d of due.docs) {
    try {
      const status = d.get('status');
      if (status === 'queued') await processQueuedIntro(tenantId, d.ref, gmail, suppressions);
      else if (status === 'sent') await processFollowUp(tenantId, d.ref, gmail, suppressions);
      else await d.ref.update({ nextActionAt: null, updatedAt: FieldValue.serverTimestamp() }); // stray schedule on a finished row
    } catch (err) {
      logger.error('[sodexoContactIntro] due action failed', { tenantId, ledgerId: d.id, err: err instanceof Error ? err.message : String(err) });
    }
  }
}

/** Atomically move a due row from `from` to `to`; returns its data, or null if someone else got it. */
async function claimDue(ref: FirebaseFirestore.DocumentReference, from: string, to: string): Promise<Doc | null> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    const dueMs = toMillis(data?.nextActionAt);
    if (!data || data.status !== from || !dueMs || dueMs > Date.now()) return null;
    tx.update(ref, { status: to, updatedAt: FieldValue.serverTimestamp() });
    return data as Doc;
  });
}

async function processQueuedIntro(
  tenantId: string,
  ref: FirebaseFirestore.DocumentReference,
  gmail: gmail_v1.Gmail,
  suppressions: Suppressions,
): Promise<void> {
  const rec = await claimDue(ref, 'queued', 'sending');
  if (!rec) return;
  const now = Date.now();
  const timeZone = str(rec.timeZone) || DEFAULT_CONTACT_TZ;
  const done = (patch: Doc) => ref.update({ ...patch, nextActionAt: null, updatedAt: FieldValue.serverTimestamp() });

  if (now - (toMillis(rec.nextActionAt) ?? now) > MAX_LATE_MS) {
    await done({ status: 'skipped', skipReason: 'expired' });
    return;
  }
  if (!isWithinSendWindow(now, timeZone)) {
    await ref.update({ status: 'queued', nextActionAt: Timestamp.fromMillis(nextSendTime(now, timeZone)), updatedAt: FieldValue.serverTimestamp() });
    return;
  }
  const contact = await readContact(tenantId, str(rec.contactId));
  const block =
    (await jobOrderBlockReason(tenantId, str(rec.jobOrderId))) ??
    blockReason(contact, str(rec.email), (rec.companyNames as string[]) ?? [], suppressions);
  if (block) {
    await done({ status: 'skipped', skipReason: block });
    return;
  }
  await deliverIntro(tenantId, ref, rec, gmail);
}

async function processFollowUp(
  tenantId: string,
  ref: FirebaseFirestore.DocumentReference,
  gmail: gmail_v1.Gmail,
  suppressions: Suppressions,
): Promise<void> {
  const now = Date.now();
  const done = (patch: Doc) => ref.update({ ...patch, nextActionAt: null, updatedAt: FieldValue.serverTimestamp() });

  if (!SODEXO_FOLLOW_UP_TEMPLATE) {
    // Wait for the script to ship — but never send one stale.
    const dueMs = toMillis((await ref.get()).get('nextActionAt'));
    if (dueMs && now - dueMs > MAX_LATE_MS) await done({ status: 'complete', followUpSkipReason: 'no_template' });
    return;
  }
  const rec = await claimDue(ref, 'sent', 'followup_sending');
  if (!rec) return;
  const email = str(rec.email);
  const timeZone = str(rec.timeZone) || DEFAULT_CONTACT_TZ;
  const dueMs = toMillis(rec.nextActionAt) ?? now;

  if (now - dueMs > MAX_LATE_MS) {
    await done({ status: 'complete', followUpSkipReason: 'expired' });
    return;
  }
  if (!isWithinSendWindow(now, timeZone)) {
    await ref.update({ status: 'sent', nextActionAt: Timestamp.fromMillis(nextSendTime(now, timeZone)), updatedAt: FieldValue.serverTimestamp() });
    return;
  }
  const contact = await readContact(tenantId, str(rec.contactId));
  const block =
    (await jobOrderBlockReason(tenantId, str(rec.jobOrderId))) ??
    blockReason(contact, email, (rec.companyNames as string[]) ?? [], suppressions);
  if (block) {
    await done({ status: 'complete', followUpSkipReason: block });
    return;
  }

  const sinceMs = toMillis(rec.sentAt) ?? dueMs - FOLLOW_UP_DELAY_MS;
  const threadId = str(rec.gmailThreadId) || null;
  const mail = await deborahMailSince(gmail, { email, threadId, sinceMs });
  const state = classifyReplyState(mail, { selfEmail: DEBORAH_EMAIL, ourMessageIds: [str(rec.gmailMessageId)], sinceMs });
  if (state === 'replied') {
    await done({ status: 'replied', repliedDetectedAt: FieldValue.serverTimestamp() });
    logger.info('[sodexoContactIntro] contact replied — no follow-up', { tenantId, email });
    return;
  }
  if (state === 'bounced') {
    await done({ status: 'bounced' });
    await patchContact(tenantId, str(rec.contactId), { emailBounced: true, emailBouncedAt: FieldValue.serverTimestamp(), bouncedEmail: email });
    logger.info('[sodexoContactIntro] intro bounced — contact flagged, no follow-up', { tenantId, email });
    return;
  }
  if (state === 'deborah_engaged') {
    await done({ status: 'complete', followUpSkipReason: 'deborah_followed_up' });
    return;
  }

  const followUp = renderFollowUp(str(rec.subject), (rec.vars as Record<string, string>) ?? {})!;
  const rfcMessageId = str(rec.rfcMessageId) || null;
  try {
    const sent = await sendAsDeborah(gmail, {
      to: email,
      subject: followUp.subject,
      body: followUp.body,
      threadId,
      inReplyTo: rfcMessageId,
      references: rfcMessageId,
    });
    await done({
      status: 'followup_sent',
      followUpSubject: followUp.subject,
      followUpBody: followUp.body,
      followUpMessageId: sent.messageId,
      followUpSignatureSource: sent.signatureSource,
      followUpSentAt: FieldValue.serverTimestamp(),
    });
    await patchContact(tenantId, str(rec.contactId), { 'sodexoContactIntro.followUpSentAt': FieldValue.serverTimestamp() });
    logger.info('[sodexoContactIntro] follow-up sent', { tenantId, email, gmailMessageId: sent.messageId });
  } catch (err) {
    await done({ status: 'followup_failed', error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
