/**
 * "You're hired" celebratory message: automation rules (worker_hired) then default copy via sendMessage.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { dispatchSystemMessage } from './systemMessageDispatcher';
import { sendMessage } from './routingOrchestrator';
import { markLifecycleEventIfFirst } from './lifecycleDedupe';
import { SYSTEM_TRIGGER_KEYS } from './triggerRegistry';
import { workerTypeLabelForEntityKey, type WorkerTypeLanguage } from './workerTypeLabels';
import { userIsInActiveMigration, MIGRATION_SUPPRESSION_LOG_TAG } from './migrationSuppress';

const db = admin.firestore();
const DEDUPE_V = 'v1';

function normalizeLang(raw: unknown): WorkerTypeLanguage {
  return String(raw || '').toLowerCase() === 'es' ? 'es' : 'en';
}

function plainEmailToHtml(text: string): string {
  return text
    .split(/\n\n/)
    .map((p) => `<p>${p.split('\n').join('<br/>')}</p>`)
    .join('');
}

function renderSms(
  lang: WorkerTypeLanguage,
  vars: { firstName: string; workerTypeLabel: string; hiringEntityName: string },
): string {
  if (lang === 'es') {
    return `¡Felicidades, ${vars.firstName}! Has sido oficialmente contratado(a) como ${vars.workerTypeLabel} en ${vars.hiringEntityName}. En breve te enviaremos un enlace para configurar tu nómina y completar tu incorporación — y, si el puesto lo requiere, otro para verificación de antecedentes o examen antidoping. ¡Bienvenido(a) al equipo!`;
  }
  return `Congratulations, ${vars.firstName}! You're officially hired as an ${vars.workerTypeLabel} at ${vars.hiringEntityName}. We'll follow up shortly with a link to set up your payroll and onboarding — and, if your role requires it, a link for background checks or drug screens. Welcome to the team!`;
}

function renderEmailSubject(lang: WorkerTypeLanguage, vars: { hiringEntityName: string }): string {
  if (lang === 'es') return `Bienvenido(a) a ${vars.hiringEntityName} — ¡has sido contratado(a)!`;
  return `Welcome to ${vars.hiringEntityName} — you're officially hired!`;
}

function renderEmailBody(
  lang: WorkerTypeLanguage,
  vars: { firstName: string; workerTypeLabel: string; hiringEntityName: string },
): string {
  if (lang === 'es') {
    return [
      `Hola ${vars.firstName},`,
      ``,
      `¡Felicidades! Has sido oficialmente contratado(a) como ${vars.workerTypeLabel} en ${vars.hiringEntityName}. Nos alegra mucho tenerte en el equipo.`,
      ``,
      `Estos son los próximos pasos:`,
      ``,
      `• En un mensaje aparte recibirás un enlace para configurar tu nómina y completar tu incorporación (formularios fiscales, depósito directo y formulario I-9 si aplica).`,
      `• Si tu puesto lo requiere, también recibirás un enlace para completar una verificación de antecedentes o examen antidoping.`,
      ``,
      `Si tienes alguna pregunta, solo responde — tu reclutador estará en contacto.`,
      ``,
      `¡Bienvenido(a) a bordo!`,
      `El equipo de ${vars.hiringEntityName}`,
    ].join('\n');
  }
  return [
    `Hi ${vars.firstName},`,
    ``,
    `Congratulations! You've officially been hired as an ${vars.workerTypeLabel} at ${vars.hiringEntityName}. We're excited to have you on the team.`,
    ``,
    `Here's what happens next:`,
    ``,
    `• In a separate message, you'll receive a link to set up your payroll and complete onboarding paperwork (tax forms, direct deposit, and I-9 if applicable).`,
    `• If your role requires it, you'll also receive a link to complete a background check or drug screen.`,
    ``,
    `If you have any questions, just reply — your recruiter will be in touch.`,
    ``,
    `Welcome aboard,`,
    `The ${vars.hiringEntityName} team`,
  ].join('\n');
}

function renderPushTitle(lang: WorkerTypeLanguage, vars: { hiringEntityName: string }): string {
  if (lang === 'es') return `¡Bienvenido(a) a ${vars.hiringEntityName}!`;
  return `Welcome to ${vars.hiringEntityName}!`;
}

function renderPushBody(lang: WorkerTypeLanguage, vars: { workerTypeLabel: string }): string {
  if (lang === 'es') {
    return `Has sido oficialmente contratado(a) como ${vars.workerTypeLabel}. Revisa tus mensajes para los próximos pasos.`;
  }
  return `You're officially hired as a ${vars.workerTypeLabel}. Check your messages for next steps.`;
}

export async function dispatchWorkerHired(args: {
  tenantId: string;
  userId: string;
  pipelineId: string;
  entityId: string | null;
  entityName: string;
  entityKey: string;
  triggerSource: string;
}): Promise<void> {
  const { tenantId, userId, pipelineId, entityId, entityName, entityKey, triggerSource } = args;

  // Read the user doc up front — we need it for both (a) the bulk-migration
  // suppression gate (must run BEFORE the lifecycle dedupe is marked, so a
  // user who exits migration could in principle re-trigger the dispatch
  // later) and (b) firstName / language extraction below.
  let userData: Record<string, unknown> = {};
  try {
    const snap = await db.doc(`users/${userId}`).get();
    if (snap.exists) {
      userData = (snap.data() || {}) as Record<string, unknown>;
    }
  } catch (e) {
    logger.warn('worker_hired: failed to load user doc', {
      tenantId,
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Bulk-migration suppression gate (BI.0 / BI.1 architectural defense).
  // When the user doc carries `migrationSource` matching `^tempworks_`
  // or `^bi1_`, the migration tool owns its own messaging cadence — refuse
  // to fire the worker-hired dispatch regardless of caller. Belt-and-
  // suspenders with the in-process `suppressOutboundAutomation` flag on
  // `ensureWorkerOnboardingPipeline`: the in-process flag stops the call
  // path from being reached when the BI.0 emergency import script is the
  // caller; this gate catches every other caller (Firestore triggers,
  // future code paths) that may forget the flag.
  if (userIsInActiveMigration(userData)) {
    logger.info(`worker_hired: suppressed (${MIGRATION_SUPPRESSION_LOG_TAG})`, {
      tenantId,
      userId,
      entityKey,
      pipelineId,
      migrationSource: String(userData.migrationSource || ''),
      gate: 'dispatcher',
    });
    return;
  }

  const dedupeKey = `worker_hired__${DEDUPE_V}__${tenantId}__${userId}__${entityKey}`;
  const first = await markLifecycleEventIfFirst({
    tenantId,
    dedupeKey,
    eventType: 'worker_hired',
    context: { pipelineId, userId, entityKey, triggerSource },
  });
  if (!first) {
    logger.info('worker_hired: dedupe skip', { tenantId, userId, entityKey, pipelineId });
    return;
  }

  const firstName =
    String(userData.firstName || userData.displayName || 'there').trim() || 'there';
  const preferredLanguage: WorkerTypeLanguage = normalizeLang(
    userData.preferredLanguage ?? userData.languagePreference ?? userData.language,
  );

  const workerTypeLabel = workerTypeLabelForEntityKey(entityKey, preferredLanguage);
  const workerTypeLabelEn = workerTypeLabelForEntityKey(entityKey, 'en');
  const workerTypeLabelEs = workerTypeLabelForEntityKey(entityKey, 'es');

  const smsBody = renderSms(preferredLanguage, { firstName, workerTypeLabel, hiringEntityName: entityName });
  const emailSubject = renderEmailSubject(preferredLanguage, { hiringEntityName: entityName });
  const emailPlain = renderEmailBody(preferredLanguage, { firstName, workerTypeLabel, hiringEntityName: entityName });
  const emailHtml = plainEmailToHtml(emailPlain);
  const pushTitle = renderPushTitle(preferredLanguage, { hiringEntityName: entityName });
  const pushBody = renderPushBody(preferredLanguage, { workerTypeLabel });

  const variables: Record<string, unknown> = {
    firstName,
    hiringEntityName: entityName,
    hiringEntityId: entityId ?? '',
    entityKey,
    entityName,
    workerTypeLabel,
    workerTypeLabelEn,
    workerTypeLabelEs,
    preferredLanguage,
    onboardingPipelineId: pipelineId,
    onboardingTriggerSource: triggerSource,
    _message: emailHtml,
    message: smsBody,
    messageText: smsBody,
    _rawMessage: smsBody,
    _subject: emailSubject,
    emailSubject,
    emailBody: emailPlain,
    pushTitle,
    pushBody,
  };

  const dispatched = await dispatchSystemMessage({
    tenantId,
    userId,
    triggerKey: SYSTEM_TRIGGER_KEYS.workerHired,
    context: variables,
    metadata: {
      pipelineId,
      hiringEntityId: entityId ?? undefined,
      entityId: entityId ?? undefined,
      entityKey,
      onboardingTriggerSource: triggerSource,
      preferredLanguage,
    },
    source: 'worker_onboarding_pipeline',
    sourceId: pipelineId,
  });

  if (dispatched.handled && dispatched.sent) {
    return;
  }

  if (dispatched.handled && !dispatched.sent) {
    logger.info('worker_hired: rules ran but send failed, using default body', {
      tenantId,
      userId,
      entityKey,
      errors: dispatched.errors,
    });
  }

  try {
    await sendMessage({
      userId,
      tenantId,
      messageTypeId: 'worker_hired',
      variables,
      metadata: {
        source: 'worker_onboarding_pipeline',
        sourceId: pipelineId,
        hiringEntityId: entityId ?? undefined,
        entityId: entityId ?? undefined,
        entityKey,
        preferredLanguage,
      },
      source: 'worker_onboarding_pipeline',
      sourceId: pipelineId,
    });
  } catch (e) {
    logger.warn('worker_hired: fallback sendMessage failed', {
      tenantId,
      userId,
      entityKey,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
