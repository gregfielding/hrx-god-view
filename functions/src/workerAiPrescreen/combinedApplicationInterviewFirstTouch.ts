/**
 * Single SMS that thanks the applicant and links to the application-scoped AI interview
 * (replaces separate application_received + delayed worker_ai_prescreen_invite for eligible flows).
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { sendLegacyApplicationStatusMessage } from '../messaging/legacyMessageHelpers';
import { resolveTemplateVariables, TemplateVariableContext } from '../utils/templateVariableResolver';
import { markLifecycleEventIfFirst } from '../messaging/lifecycleDedupe';
import { touchLastInterviewInvitedAt } from './interviewInviteCooldown';
import { scheduleInterviewChaseFields } from './interviewCadence';
import { evaluateAiPrescreenEligibility, userDocHasUsablePhone } from './evaluateAiPrescreenEligibility';
import { resolveAiPrescreenTenantPolicy } from './aiPrescreenJobSlice';
import { buildWorkerAiPrescreenInviteUrl } from '../utils/workerUrls';
import { resolveHiringInterviewPolicyForApplication } from './aiHiringPolicyResolution';
import { normalizeApplicationStatus } from '../utils/applicationStatusNormalize';

const db = admin.firestore();

async function tenantOutreachEnabled(tenantId: string): Promise<boolean> {
  try {
    const snap = await db.doc(`tenants/${tenantId}`).get();
    if (snap.data()?.workerAiPrescreenOutreachEnabled === false) return false;
  } catch {
    /* fail open */
  }
  return true;
}

function firstNameFromUser(ud: Record<string, unknown>): string {
  return (
    String(ud.firstName || (String(ud.displayName || '').trim().split(/\s+/)[0] || '') || 'there').trim() || 'there'
  );
}

function jobTitleFromApplicationForSms(app: Record<string, unknown>, lang: 'en' | 'es'): string {
  const t = String(app.jobTitle || app.roleTitle || app.positionTitle || '').trim();
  if (t) return t;
  return lang === 'es' ? 'este trabajo' : 'this job';
}

/** Mis-saved placeholder cleanup — same idea as applicationSmsTriggers */
function cleanupMisSavedPlaceholders(
  text: string,
  variables: Record<string, string>,
): string {
  let out = text;
  for (const key of ['firstName', 'jobTitle', 'locationCity', 'locationIn', 'interviewUrl'] as const) {
    const value = variables[key];
    if (value == null || value === '') continue;
    const s = String(value);
    out = out.replace(new RegExp(`\\{\\{\\s*${escapeRegExp(s)}\\s*\\}\\}`, 'gi'), s);
    out = out.replace(new RegExp(`\\{\\s*${escapeRegExp(s)}\\s*\\}`, 'g'), s);
  }
  return out;
}
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type CombinedFirstTouchResult =
  | 'sent'
  | 'failed'
  /** Policy/outreach — caller may send plain application_received + schedule reminder. */
  | 'not_applicable'
  /** Thanks dedupe already consumed — do not send plain SMS for this submission. */
  | 'deduped_thanks';

const MESSAGE_TYPE_ID = 'application_received_interview_next_step' as const;

/**
 * Whether we should send the combined SMS instead of plain application_received + scheduled prescreen reminder.
 */
export async function shouldSendCombinedApplicationInterviewFirstTouch(args: {
  tenantId: string;
  applicationId: string;
  applicationData: Record<string, unknown>;
  userData: Record<string, unknown>;
  /** When true, assignment-cancel revert to submitted — no combined (matches scheduleWorkerAiPrescreenReminder). */
  statusChangeReason?: unknown;
  revertedFromAssignmentCancel?: unknown;
}): Promise<boolean> {
  const { tenantId, applicationId, applicationData, userData, statusChangeReason, revertedFromAssignmentCancel } =
    args;

  if (String(statusChangeReason || '') === 'assignment_cancelled' || revertedFromAssignmentCancel === true) {
    return false;
  }

  if (normalizeApplicationStatus(String(applicationData.status ?? '')) !== 'submitted') {
    return false;
  }

  const userId = String(applicationData.userId || applicationData.candidateId || '').trim();
  if (!userId) return false;

  if (!(await tenantOutreachEnabled(tenantId))) return false;

  if (!userDocHasUsablePhone(userData)) return false;

  if (applicationData.workerAiPrescreenReminderSentAt) {
    return false;
  }

  if (applicationData.workerAiPrescreenFirstTouchCombinedAt) {
    return false;
  }

  try {
    const interviewPol = await resolveHiringInterviewPolicyForApplication(db, tenantId, applicationData);
    if (!interviewPol.workerAiPrescreenRequired) return false;
  } catch {
    return false;
  }

  return true;
}

function defaultCombinedBody(args: {
  firstName: string;
  jobTitle: string;
  locationIn: string;
  interviewUrl: string;
  preferredLanguage: 'en' | 'es';
  outcome: 'eligible_invite' | 'ineligible_nudge';
}): string {
  const { firstName, jobTitle, locationIn, interviewUrl, preferredLanguage, outcome } = args;
  if (preferredLanguage === 'es') {
    if (outcome === 'eligible_invite') {
      return `Hola ${firstName}, gracias por postularte a ${jobTitle}${locationIn}. Siguiente paso rápido: responde unas preguntas para que podamos considerarte para este trabajo y emparejarte bien. Empieza aquí:\n${interviewUrl}`;
    }
    return `Hola ${firstName}, gracias por postularte a ${jobTitle}${locationIn}. Siguiente paso: responde unas preguntas rápidas para prepararte y completar lo que falta. Empieza aquí:\n${interviewUrl}`;
  }
  if (outcome === 'eligible_invite') {
    return `Hi ${firstName}, thanks for applying to ${jobTitle}${locationIn}. Quick next step: answer a few questions so we can consider you for this job and match you with the right opportunities. Start here:\n${interviewUrl}`;
  }
  return `Hi ${firstName}, thanks for applying to ${jobTitle}${locationIn}. Quick next step: answer a few quick questions so we can get you job-ready and fill in what’s missing. Start here:\n${interviewUrl}`;
}

/**
 * Sends combined first-touch SMS and marks application + lifecycle dedupe so the delayed prescreen job does not duplicate.
 * Caller must not claim application_received_thanks dedupe until this returns `sent`.
 */
export async function sendCombinedApplicationInterviewFirstTouch(args: {
  tenantId: string;
  applicationId: string;
  applicationData: Record<string, unknown>;
  userId: string;
  userData: Record<string, unknown>;
  phoneE164: string;
  thanksDedupeKey: string;
  source: 'application_created' | 'application_status_changed';
}): Promise<CombinedFirstTouchResult> {
  const { tenantId, applicationId, applicationData, userId, userData, phoneE164, thanksDedupeKey, source } = args;

  const ok = await shouldSendCombinedApplicationInterviewFirstTouch({
    tenantId,
    applicationId,
    applicationData,
    userData,
    statusChangeReason: applicationData.statusChangeReason,
    revertedFromAssignmentCancel: applicationData.revertedFromAssignmentCancel,
  });
  if (!ok) {
    return 'not_applicable';
  }

  let prescreenPolicy = resolveAiPrescreenTenantPolicy({});
  try {
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    prescreenPolicy = resolveAiPrescreenTenantPolicy((tenantSnap.data() || {}) as Record<string, unknown>);
  } catch {
    /* defaults */
  }

  const eligibility = evaluateAiPrescreenEligibility(userData, {
    requireResumeOrSkill: prescreenPolicy.eligibility.requireResumeOrSkill,
    requirePhone: prescreenPolicy.eligibility.requirePhone,
    requireLocation: prescreenPolicy.eligibility.requireLocation,
    requireWorkAuthorization: prescreenPolicy.eligibility.requireWorkAuthorization,
  });

  const preferredLanguage = String(userData.preferredLanguage || 'en').toLowerCase() === 'es' ? 'es' : 'en';
  const firstName = firstNameFromUser(userData);
  const jobTitle = jobTitleFromApplicationForSms(applicationData, preferredLanguage);

  const outcome: 'eligible_invite' | 'ineligible_nudge' = eligibility.eligibleForInterview
    ? 'eligible_invite'
    : 'ineligible_nudge';
  const entry = outcome === 'eligible_invite' ? 'sms_application_first_touch' : 'sms_application_first_touch_gap';
  const interviewUrl = buildWorkerAiPrescreenInviteUrl({ applicationId, entry });

  const appContext: TemplateVariableContext = {
    userId,
    userData,
    applicationId,
    applicationData,
    jobOrderId: applicationData.jobOrderId as string | undefined,
    jobPostId: (applicationData.jobId || applicationData.postId) as string | undefined,
    tenantId,
    status: String(applicationData.status ?? 'submitted'),
  };
  const variables = await resolveTemplateVariables(appContext);
  const vars = { ...variables, interviewUrl } as Record<string, string>;

  let message = '';
  let templateFound = false;
  try {
    const { getTemplateWithLegacyFallback } = await import('../messaging/templateMigration');
    const { renderTemplate } = await import('../messaging/templateEngine');
    const templateResult = await getTemplateWithLegacyFallback(
      tenantId,
      MESSAGE_TYPE_ID,
      'sms',
      preferredLanguage,
      'application',
      'applicationCreated',
    );
    if (templateResult) {
      message = await renderTemplate(templateResult.template, vars as any, tenantId);
      message = cleanupMisSavedPlaceholders(message, vars);
      templateFound = true;
    }
  } catch (e) {
    logger.warn('combinedApplicationInterviewFirstTouch.template_failed', {
      applicationId,
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  if (!templateFound) {
    message = defaultCombinedBody({
      firstName,
      jobTitle,
      locationIn: variables.locationIn || '',
      interviewUrl,
      preferredLanguage,
      outcome,
    });
  }

  const emailSubject =
    preferredLanguage === 'es'
      ? `${firstName}, recibimos tu postulación — siguiente paso`
      : `${firstName}, we received your application — next step`;

  const claimedThanks = await markLifecycleEventIfFirst({
    tenantId,
    dedupeKey: thanksDedupeKey,
    eventType: 'application_received_thanks',
    context: { applicationId, userId, source: 'combined_first_touch_precheck', messageTypeId: MESSAGE_TYPE_ID },
  });
  if (!claimedThanks) {
    logger.info('combinedApplicationInterviewFirstTouch.thanks_dedupe_skip', { applicationId, thanksDedupeKey });
    return 'deduped_thanks';
  }

  const smsResult = await sendLegacyApplicationStatusMessage({
    tenantId,
    userId,
    phoneE164,
    message,
    emailSubject,
    source,
    sourceId: applicationId,
    applicationId,
    status: 'submitted',
    applicationData,
    jobOrderId: applicationData.jobOrderId as string | undefined,
    jobPostId: (applicationData.jobId || applicationData.postId) as string | undefined,
    messageTypeIdOverride: MESSAGE_TYPE_ID,
  });

  if (!smsResult.success) {
    logger.warn('combinedApplicationInterviewFirstTouch.send_failed', {
      applicationId,
      tenantId,
      userId,
      error: smsResult.error,
    });
    return 'failed';
  }

  const sentAt = admin.firestore.Timestamp.now();
  const appRef = db.doc(`tenants/${tenantId}/applications/${applicationId}`);

  await markLifecycleEventIfFirst({
    tenantId,
    dedupeKey: `worker_ai_prescreen_reminder__${tenantId}__${applicationId}`,
    eventType: 'worker_ai_prescreen_reminder_sent',
    context: { applicationId, userId, source: 'combined_first_touch', outcome },
  });

  await appRef.update({
    workerAiPrescreenFirstTouchCombinedAt: sentAt,
    workerAiPrescreenFirstTouchCombinedOutcome: outcome,
    workerAiPrescreenReminderSentAt: sentAt,
    workerAiPrescreenReminderPending: false,
    workerAiPrescreenReminderDueAt: admin.firestore.FieldValue.delete(),
    workerAiPrescreenReminderLastOutcome: 'combined_first_touch',
    workerAiPrescreenReminderLastError: admin.firestore.FieldValue.delete(),
    ...(outcome === 'eligible_invite' ? scheduleInterviewChaseFields(sentAt) : {}),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await touchLastInterviewInvitedAt(db, userId, sentAt, {
    stampCadenceStart: outcome === 'eligible_invite',
  });

  logger.info('combinedApplicationInterviewFirstTouch.sent', {
    tenantId,
    applicationId,
    userId,
    outcome,
    messageTypeId: MESSAGE_TYPE_ID,
  });

  return 'sent';
}
