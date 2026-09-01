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
import { resolveWorkerOnboardingLink } from '../integrations/everee/resolveWorkerOnboardingLink';
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

/** Brand name for SMS: legal entity minus the "LLC" tail ("C1 Events LLC" →
 *  "C1 Events"). W-2 messages lead with the C1 Staffing brand; the legal
 *  entity is named in the email so paystubs/W-2s match what workers were told
 *  (Greg-approved classification copy, 2026-08-30). */
function brandFromEntityName(entityName: string): string {
  return entityName.replace(/,?\s*LLC\.?$/i, '').trim() || entityName;
}

interface HiredCopyVars {
  firstName: string;
  hiringEntityName: string;
  isContractor: boolean;
  /** Payroll/onboarding link resolved inline when possible; null → "watch for
   *  the next message" fallback (the payroll invite automation still sends it). */
  onboardingLink: string | null;
}

function renderSms(lang: WorkerTypeLanguage, vars: HiredCopyVars): string {
  const brand = vars.isContractor ? brandFromEntityName(vars.hiringEntityName) : 'C1 Staffing';
  const fn = vars.firstName;
  if (vars.isContractor) {
    if (lang === 'es') {
      const next = vars.onboardingLink
        ? `Siguiente paso: completa tu W-9 y la configuración de pago aquí (~2 min): ${vars.onboardingLink}`
        : 'Siguiente paso: en nuestro próximo mensaje recibirás el enlace para tu W-9 y la configuración de pago.';
      return `¡Felicidades ${fn}! ${brand} te ofrece trabajo como contratista independiente (1099). Tú eliges tus turnos y no se retienen impuestos de tu pago — tú te encargas de los tuyos. ${next}`;
    }
    const next = vars.onboardingLink
      ? `Next step: complete your W-9 and payment setup here (takes ~2 min): ${vars.onboardingLink}`
      : 'Next step: watch for our next message — it has your W-9 and payment setup link.';
    return `Congrats ${fn}! ${brand} is offering you work as an independent contractor (1099). You pick your gigs, and no taxes are withheld from your pay — you handle your own. ${next}`;
  }
  if (lang === 'es') {
    const next = vars.onboardingLink
      ? `Siguiente paso: completa tu W-4, I-9 y la configuración de pago aquí: ${vars.onboardingLink}`
      : 'Siguiente paso: en nuestro próximo mensaje recibirás el enlace para tu W-4, I-9 y la configuración de pago.';
    return `¡Felicidades ${fn}! ${brand} te contrata como empleado W-2 on-call. Se retienen impuestos de cada cheque. ${next}`;
  }
  const next = vars.onboardingLink
    ? `Next step: complete your W-4, I-9, and payment setup here: ${vars.onboardingLink}`
    : 'Next step: watch for our next message — it has your W-4, I-9, and payment setup link.';
  return `Congrats ${fn}! ${brand} is hiring you as an on-call W-2 employee. Taxes are withheld from every paycheck. ${next}`;
}

function renderEmailSubject(
  lang: WorkerTypeLanguage,
  vars: { hiringEntityName: string; isContractor: boolean },
): string {
  const brand = vars.isContractor ? brandFromEntityName(vars.hiringEntityName) : 'C1 Staffing';
  if (vars.isContractor) {
    return lang === 'es'
      ? `Estás aprobado(a) para trabajar eventos con ${brand} (contratista independiente)`
      : `You're approved to work events with ${brand} (independent contractor)`;
  }
  return lang === 'es'
    ? `Bienvenido(a) a ${brand} — estás contratado(a) como empleado(a) W-2 on-call`
    : `Welcome to ${brand} — you're hired as an on-call W-2 employee`;
}

function renderEmailBody(lang: WorkerTypeLanguage, vars: HiredCopyVars): string {
  const brand = vars.isContractor ? brandFromEntityName(vars.hiringEntityName) : 'C1 Staffing';
  const linkLineEn = vars.onboardingLink
    ? `Next step (about 2 minutes): ${vars.onboardingLink}`
    : `Next step: watch for our next message — it has your setup link.`;
  const linkLineEs = vars.onboardingLink
    ? `Siguiente paso (unos 2 minutos): ${vars.onboardingLink}`
    : `Siguiente paso: en nuestro próximo mensaje recibirás tu enlace de configuración.`;
  if (vars.isContractor) {
    if (lang === 'es') {
      return [
        `¡Felicidades, ${vars.firstName} — estás aprobado(a) para tomar turnos con ${brand}!`,
        ``,
        `Datos rápidos sobre cómo funciona:`,
        ``,
        `• Trabajarás como contratista independiente (1099) de ${vars.hiringEntityName} — no como empleado. Ese es el nombre que verás en tus pagos y en tu formulario de impuestos.`,
        `• No se retienen impuestos de tu pago. Tú eres responsable de tus propios impuestos — muchos contratistas apartan el 15–20% de cada pago.`,
        `• Si ganas $600 o más este año, recibirás un Formulario 1099 en enero.`,
        `• Tú eliges qué turnos tomar. Ningún turno es obligatorio.`,
        ``,
        `${linkLineEs} Completa tu W-9 y la configuración de pago para que podamos pagarte.`,
        ``,
        `¿Preguntas? Responde a este mensaje o envíanos un texto — con gusto te explicamos.`,
      ].join('\n');
    }
    return [
      `Congrats, ${vars.firstName} — you're approved to pick up shifts with ${brand}!`,
      ``,
      `Quick facts about how this works:`,
      ``,
      `• You'll work as a 1099 independent contractor of ${vars.hiringEntityName} — not an employee. That's the name you'll see on your payments and your tax form.`,
      `• No taxes are withheld from your pay. You're responsible for your own taxes — many contractors set aside 15–20% of each payment.`,
      `• If you earn $600 or more this year, you'll receive a Form 1099 in January.`,
      `• You choose which shifts to take. No shift is ever required.`,
      ``,
      `${linkLineEn} Complete your W-9 and payment setup so we can pay you.`,
      ``,
      `Questions about any of this? Reply here or text us — we're happy to explain.`,
    ].join('\n');
  }
  if (lang === 'es') {
    return [
      `¡Bienvenido(a), ${vars.firstName} — estás contratado(a)!`,
      ``,
      `Datos rápidos sobre cómo funciona:`,
      ``,
      `• Eres empleado(a) W-2 on-call. Tu empleador registrado es ${vars.hiringEntityName} (parte de C1 Staffing) — ese es el nombre que verás en tus talones de pago y en tu W-2.`,
      `• Los impuestos se retienen automáticamente de cada cheque, y recibirás un talón de pago por cada uno.`,
      `• On-call significa que tomas turnos cuando se ofrecen — ningún turno está garantizado y puedes declinar.`,
      `• Recibirás un Formulario W-2 en enero.`,
      ``,
      `${linkLineEs} Completa tu W-4, I-9 y la configuración de pago.`,
      ``,
      `¿Preguntas? Responde aquí o envíanos un texto cuando quieras.`,
    ].join('\n');
  }
  return [
    `Welcome aboard, ${vars.firstName} — you're hired!`,
    ``,
    `Quick facts about how this works:`,
    ``,
    `• You're an on-call W-2 employee. Your employer of record is ${vars.hiringEntityName} (part of C1 Staffing) — that's the name you'll see on paystubs and your W-2.`,
    `• Taxes are withheld automatically from every paycheck, and you'll get a paystub for each one.`,
    `• On-call means you pick up shifts when they're offered — no shift is guaranteed, and you can decline.`,
    `• You'll receive a Form W-2 in January.`,
    ``,
    `${linkLineEn} Complete your W-4, I-9, and payment setup.`,
    ``,
    `Questions? Reply here or text us anytime.`,
  ].join('\n');
}

function renderPushTitle(
  lang: WorkerTypeLanguage,
  vars: { hiringEntityName: string; isContractor: boolean },
): string {
  const brand = vars.isContractor ? brandFromEntityName(vars.hiringEntityName) : 'C1 Staffing';
  if (lang === 'es') return `¡Bienvenido(a) a ${brand}!`;
  return `Welcome to ${brand}!`;
}

function renderPushBody(lang: WorkerTypeLanguage, vars: { isContractor: boolean }): string {
  if (vars.isContractor) {
    return lang === 'es'
      ? 'Estás aprobado(a) como contratista independiente (1099) — no se retienen impuestos de tu pago. Revisa tus mensajes para configurar tu pago.'
      : "You're approved as an independent contractor (1099) — no taxes are withheld from your pay. Check your messages to set up payment.";
  }
  return lang === 'es'
    ? 'Estás contratado(a) como empleado(a) W-2 on-call — los impuestos se retienen de cada cheque. Revisa tus mensajes para los próximos pasos.'
    : "You're hired as an on-call W-2 employee — taxes are withheld from every paycheck. Check your messages for next steps.";
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
  const isContractor = String(entityKey || '').trim().toLowerCase() === 'events';

  // Best-effort inline payroll/onboarding link so the hire message carries
  // the W-9 / W-4+I-9 setup step directly (Greg-approved copy 2026-08-30).
  // Never blocks the hire message — the payroll-invite automation still
  // follows up with the link either way.
  let onboardingLink: string | null = null;
  try {
    const resolved = await resolveWorkerOnboardingLink({
      tenantId,
      entityId,
      pipelineId,
      context: 'workerHiredDispatch',
    });
    onboardingLink = resolved.link || null;
  } catch {
    onboardingLink = null;
  }

  const copyVars: HiredCopyVars = {
    firstName,
    hiringEntityName: entityName,
    isContractor,
    onboardingLink,
  };
  const smsBody = renderSms(preferredLanguage, copyVars);
  const emailSubject = renderEmailSubject(preferredLanguage, {
    hiringEntityName: entityName,
    isContractor,
  });
  const emailPlain = renderEmailBody(preferredLanguage, copyVars);
  const emailHtml = plainEmailToHtml(emailPlain);
  const pushTitle = renderPushTitle(preferredLanguage, {
    hiringEntityName: entityName,
    isContractor,
  });
  const pushBody = renderPushBody(preferredLanguage, { isContractor });

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
