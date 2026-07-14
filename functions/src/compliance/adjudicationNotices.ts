/**
 * Automated candidate notices (Migration Plan P3, 2026-07-14).
 *
 * sendAdjudicationNotice — compliance-gated callable that generates the
 * adverse-action letter from the case (versioned templates, CA/PA
 * variants, EN + ES when the candidate prefers Spanish), attaches what
 * FCRA requires (pre-adverse: the consumer report + the CFPB "Summary of
 * Your Rights" EN+ES), emails the candidate, sends the content-free SMS
 * nudge, records the notice on the case (template version + state variant
 * + provider message id), computes the response deadline, files a copy of
 * the letter into the Drive case folder, and appends the audit event.
 *
 * adjudicationDeadlineCron — every 6 hours: awaiting_candidate cases get a
 * reminder to the compliance reviewers 2 days before the deadline and an
 * automatic window_expired transition (with notification) once it passes.
 *
 * Hard gates: the CRA contact block must be configured
 * (tenants/{tid}/integrations/accusource.craContactBlock) — a letter
 * without the agency block is an FCRA defect, so the send refuses.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import { getStorageBucketName } from '../utils/storageBucket';
import { getEmailProvider } from '../messaging/emailService';
import type { EmailAttachment } from '../messaging/EmailProvider';
import { createOutboundRequest } from '../messaging/smsOutboundQueue';
import { sendNotificationAndPush } from '../messaging/unifiedWorkerNotifications';
import { normalizeUserPhoneToE164 } from '../utils/phoneE164Normalize';
import { accusourceLog } from '../integrations/accusource/accusourceLogger';
import { fetchAccusourceReportPdfBuffer } from '../integrations/accusource/getAccusourceBackgroundCheckPdf';
import { writeWorkerActivityLog } from './workerActivityLog';
import { uploadToCaseFolder } from './driveCaseFolders';
import {
  loadCase,
  appendCaseEvent,
  computeBusinessDayDeadlineMs,
  type AdjudicationCaseStatus,
  type NoticeKind,
} from './adjudicationCases';
import {
  buildAdjudicationNoticeEmail,
  buildNoticeNudgeSms,
  stateVariantForWorksiteState,
  NOTICE_TEMPLATE_VERSION,
} from './adjudicationNoticeTemplates';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const RESPONSE_WINDOW_BUSINESS_DAYS = 5;
const REMINDER_LEAD_MS = 48 * 60 * 60 * 1000;

/** Official CFPB "A Summary of Your Rights Under the FCRA" — vendored into
 *  Storage on first use so every send attaches identical bytes. */
const CFPB_SOURCES = [
  {
    lang: 'en',
    url: 'https://files.consumerfinance.gov/f/documents/bcfp_consumer-rights-summary_2018-09.pdf',
    storagePath: 'compliance/cfpb/summary-of-rights-en.pdf',
    name: 'Summary of Your Rights Under the FCRA (English).pdf',
  },
  {
    lang: 'es',
    url: 'https://files.consumerfinance.gov/f/documents/bcfp_consumer-rights-summary_2018-09_es.pdf',
    storagePath: 'compliance/cfpb/summary-of-rights-es.pdf',
    name: 'Resumen de Sus Derechos Bajo la FCRA (Español).pdf',
  },
] as const;

function trim(v: unknown): string {
  return String(v ?? '').trim();
}

function attachment(storagePath: string, name: string, size: number): EmailAttachment {
  return { id: storagePath, name, contentType: 'application/pdf', size, storagePath, downloadUrl: '' };
}

async function ensureCfpbSummaries(): Promise<EmailAttachment[]> {
  const bucket = getStorage().bucket(getStorageBucketName());
  const out: EmailAttachment[] = [];
  for (const src of CFPB_SOURCES) {
    const file = bucket.file(src.storagePath);
    const [exists] = await file.exists();
    let size = 0;
    if (!exists) {
      const res = await fetch(src.url);
      if (!res.ok) {
        throw new HttpsError(
          'unavailable',
          `Could not fetch the CFPB Summary of Rights (${src.lang}) — try again or attach manually.`,
        );
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await file.save(buf, { contentType: 'application/pdf' });
      size = buf.length;
    } else {
      const [meta] = await file.getMetadata();
      size = Number(meta.size ?? 0);
    }
    out.push(attachment(src.storagePath, src.name, size));
  }
  return out;
}

function deadlineText(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

// ─────────────────────────────────────────────────────────────────────
// sendAdjudicationNotice
// ─────────────────────────────────────────────────────────────────────

export const sendAdjudicationNotice = onCall(
  { cors: true, timeoutSeconds: 120, memory: '512MiB' },
  async (request) => {
    const ctx = await loadCase(request, true);
    const kind = trim((request.data as Record<string, unknown>)?.kind) as NoticeKind;
    if (!['pre_adverse', 'final_adverse', 'dispute_ack'].includes(kind)) {
      throw new HttpsError('invalid-argument', 'kind must be pre_adverse | final_adverse | dispute_ack.');
    }
    const status = trim(ctx.data.status) as AdjudicationCaseStatus;
    const decision = (ctx.data.decision as string | null) ?? null;
    if (kind === 'final_adverse' && decision !== 'deny') {
      throw new HttpsError(
        'failed-precondition',
        'Final adverse notice requires the case to be closed with a deny decision first (policy §5.2 step 6).',
      );
    }
    if (kind === 'dispute_ack' && status !== 'disputed') {
      throw new HttpsError('failed-precondition', 'Dispute acknowledgment requires an open dispute.');
    }
    if (kind === 'pre_adverse' && status === 'closed') {
      throw new HttpsError('failed-precondition', 'Case is closed.');
    }

    // ── Assemble the letter inputs
    const cfg = (await db.doc(`tenants/${ctx.tenantId}/integrations/accusource`).get()).data() ?? {};
    const craBlock = trim(cfg.craContactBlock);
    if (!craBlock) {
      throw new HttpsError(
        'failed-precondition',
        'CRA contact block is not configured. Set craContactBlock (AccuSource legal name, address, phone) on the AccuSource integration settings first — P0 checklist item 4.',
      );
    }
    const compliancePhone = trim(cfg.compliancePhone) || undefined;

    const candidateId = trim(ctx.data.candidateId);
    const userSnap = await db.collection('users').doc(candidateId).get();
    const u = (userSnap.data() ?? {}) as Record<string, unknown>;
    const email = trim(u.email).toLowerCase();
    if (!email || !email.includes('@')) {
      throw new HttpsError('failed-precondition', 'Candidate has no email address on file — send the notice by mail and record it manually.');
    }
    const candidateName =
      `${trim(u.firstName)} ${trim(u.lastName)}`.trim() || trim(ctx.data.candidateName) || 'Candidate';
    const prefersEs = trim(u.preferredLanguage || (u as Record<string, unknown>).language)
      .toLowerCase()
      .startsWith('es');

    let position = trim(ctx.data.packageName) || 'this assignment';
    const jobOrderId = trim(ctx.data.jobOrderId);
    if (jobOrderId) {
      const jo = (await db.doc(`tenants/${ctx.tenantId}/job_orders/${jobOrderId}`).get()).data();
      if (jo && trim(jo.jobTitle)) position = trim(jo.jobTitle);
    }
    const clientOrWorksite = trim(ctx.data.accountName) || 'the client';
    const stateVariant = stateVariantForWorksiteState(ctx.data.worksiteState as string | null);

    const sentAtMs = Date.now();
    const deadlineMs =
      kind === 'pre_adverse' ? computeBusinessDayDeadlineMs(sentAtMs, RESPONSE_WINDOW_BUSINESS_DAYS) : null;

    const { subject, htmlBody, textBody } = buildAdjudicationNoticeEmail({
      kind,
      stateVariant,
      includeSpanish: prefersEs,
      fields: {
        candidateName,
        position,
        clientOrWorksite,
        responseDeadlineText: deadlineMs ? deadlineText(deadlineMs) : undefined,
        convictionList: trim(ctx.data.convictionsSummary) || undefined,
        craBlock,
        compliancePhone,
      },
    });

    // ── Attachments (pre-adverse: report + CFPB summaries — FCRA-required)
    const attachments: EmailAttachment[] = [];
    if (kind === 'pre_adverse') {
      attachments.push(...(await ensureCfpbSummaries()));
      const bgcId = trim(ctx.data.backgroundCheckId);
      const bgc = (await db.collection('backgroundChecks').doc(bgcId).get()).data() ?? {};
      if (bgc.finalReportReady === true) {
        const pdf = await fetchAccusourceReportPdfBuffer(bgc as Record<string, unknown>, 'final');
        const storagePath = `compliance/adjudication/${ctx.caseId}/consumer-report.pdf`;
        await getStorage().bucket(getStorageBucketName()).file(storagePath).save(pdf, {
          contentType: 'application/pdf',
        });
        attachments.push(attachment(storagePath, 'Your Consumer Report.pdf', pdf.length));
      } else {
        throw new HttpsError(
          'failed-precondition',
          'The final report PDF is not available yet — FCRA requires enclosing the report with the pre-adverse notice. Wait for the report or send manually with a printed copy.',
        );
      }
    }

    // ── Send
    const sendResult = await getEmailProvider().sendEmail({
      tenantId: ctx.tenantId,
      to: { email, name: candidateName },
      subject,
      htmlBody,
      textBody,
      messageTypeId: `adjudication_${kind}`,
      userId: candidateId,
      attachments,
    });
    if (!sendResult.success) {
      throw new HttpsError(
        'unavailable',
        `Email send failed (${sendResult.errorMessage || sendResult.errorCode || 'unknown'}) — nothing was recorded; retry or send manually.`,
      );
    }

    // ── Record on the case (mirror of recordAdjudicationNotice, plus email metadata)
    const notice = {
      kind,
      channel: 'email',
      stateVariant,
      sentAt: admin.firestore.Timestamp.fromMillis(sentAtMs),
      recordedBy: ctx.uid,
      templateVersion: NOTICE_TEMPLATE_VERSION,
      emailTo: email,
      providerMessageId: sendResult.providerMessageId ?? null,
      attachments: attachments.map((a) => a.name),
    };
    const patch: Record<string, unknown> = {
      notices: admin.firestore.FieldValue.arrayUnion(notice),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (kind === 'pre_adverse' && deadlineMs) {
      patch.responseDeadlineAt = admin.firestore.Timestamp.fromMillis(deadlineMs);
      patch.status = 'awaiting_candidate' satisfies AdjudicationCaseStatus;
      patch.reminderSentAt = null;
      patch.expiredNotifiedAt = null;
    }
    await ctx.ref.update(patch);
    await appendCaseEvent(ctx.ref, ctx.uid, `notice_${kind}_emailed`, {
      emailTo: email,
      stateVariant,
      templateVersion: NOTICE_TEMPLATE_VERSION,
      providerMessageId: sendResult.providerMessageId ?? null,
      attachments: attachments.map((a) => a.name),
      ...(deadlineMs ? { responseDeadlineMs: deadlineMs } : {}),
    });
    await writeWorkerActivityLog({
      userId: candidateId,
      action: `adjudication_notice_${kind}`,
      description: `Adverse-action notice emailed (${kind.replace('_', '-')})`,
      severity: 'medium',
      metadata: { caseId: ctx.caseId, emailTo: email, templateVersion: NOTICE_TEMPLATE_VERSION },
    }).catch(() => undefined);

    // ── Content-free SMS nudge (the ONLY permitted SMS about a screening)
    let smsQueued = false;
    const phoneE164 = normalizeUserPhoneToE164(u);
    if (phoneE164 && u.smsOptIn !== false) {
      try {
        await createOutboundRequest({
          tenantId: ctx.tenantId,
          toPhoneE164: phoneE164,
          recipientUserId: candidateId,
          body: buildNoticeNudgeSms(email, deadlineMs ? deadlineText(deadlineMs) : null, prefersEs),
          messageTypeId: 'adjudication_notice_nudge',
          source: 'automation',
          requestedByUid: ctx.uid,
          dedupeKey: `adj-notice:${ctx.caseId}:${kind}`,
          dedupeWindowHours: 24,
        });
        smsQueued = true;
      } catch (err) {
        logger.warn('[adjudicationNotices] SMS nudge failed (email already sent)', {
          caseId: ctx.caseId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── File the letter into the Drive case folder (best-effort)
    const driveFolderId = trim(ctx.data.driveFolderId);
    if (driveFolderId) {
      const stamp = new Date(sentAtMs).toISOString().slice(0, 10);
      await uploadToCaseFolder({
        folderId: driveFolderId,
        name: `${kind.replace('_', '-')}-${stamp}.html`,
        content: htmlBody,
        mimeType: 'text/html',
      });
    }

    accusourceLog('info', 'adjudication', 'Notice emailed', {
      tenantId: ctx.tenantId,
      caseId: ctx.caseId,
      kind,
      stateVariant,
      smsQueued,
      by: ctx.uid,
    });
    return {
      ok: true,
      kind,
      emailTo: email,
      smsQueued,
      responseDeadlineMs: deadlineMs,
      templateVersion: NOTICE_TEMPLATE_VERSION,
    };
  },
);

// ─────────────────────────────────────────────────────────────────────
// adjudicationDeadlineCron — reminders + window expiry (policy §5.2)
// ─────────────────────────────────────────────────────────────────────

async function notifyComplianceReviewers(
  tenantId: string,
  title: string,
  body: string,
  caseId: string,
  candidateId: string,
): Promise<void> {
  const cfg = (await db.doc(`tenants/${tenantId}/integrations/accusource`).get()).data() ?? {};
  const uids: string[] = Array.isArray(cfg.complianceReviewerUids)
    ? (cfg.complianceReviewerUids as unknown[]).map(String)
    : [];
  for (const uid of uids) {
    await sendNotificationAndPush({
      uid,
      tenantId,
      title,
      body,
      type: 'system',
      category: 'system',
      deepLink: `/users/${candidateId}`,
      source: 'automation',
      metadata: { caseId, kind: 'adjudication_deadline' },
    }).catch(() => undefined);
  }
}

export const adjudicationDeadlineCron = onSchedule(
  { schedule: 'every 6 hours', timeZone: 'America/Los_Angeles', memory: '512MiB' },
  async () => {
    const now = Date.now();
    const tenants = await db.collection('tenants').listDocuments();
    for (const tenantRef of tenants) {
      const open = await tenantRef
        .collection('adjudication_cases')
        .where('status', '==', 'awaiting_candidate')
        .get()
        .catch(() => null);
      if (!open || open.empty) continue;

      for (const doc of open.docs) {
        const c = doc.data() as Record<string, unknown>;
        const deadline = c.responseDeadlineAt as admin.firestore.Timestamp | null;
        if (!deadline) continue;
        const candidateId = trim(c.candidateId);
        const name = trim(c.candidateName) || candidateId;
        const deadlineMs = deadline.toMillis();

        if (deadlineMs < now && !c.expiredNotifiedAt) {
          await doc.ref.update({
            status: 'window_expired',
            expiredNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          await appendCaseEvent(doc.ref, 'system', 'status_window_expired', { auto: true });
          await notifyComplianceReviewers(
            tenantRef.id,
            'Response window expired',
            `${name}'s adverse-action response window has expired — the case is ready to decide (policy §5.2 step 5).`,
            doc.id,
            candidateId,
          );
        } else if (deadlineMs - now <= REMINDER_LEAD_MS && deadlineMs > now && !c.reminderSentAt) {
          await doc.ref.update({
            reminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          await appendCaseEvent(doc.ref, 'system', 'deadline_reminder_sent', {
            deadlineMs,
          });
          await notifyComplianceReviewers(
            tenantRef.id,
            'Response window closing',
            `${name}'s adverse-action response window closes ${deadlineText(deadlineMs)}.`,
            doc.id,
            candidateId,
          );
        }
      }
    }
  },
);
