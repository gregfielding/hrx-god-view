/**
 * Worker-facing notices for certification scan / review outcomes. Same
 * channels and gating as the headshot re-upload nudge: in-app notification
 * always; SMS only for a re-upload ask, only with opt-in, deduped 24h.
 * Copy is neutral — the worker is told what to do, never blamed.
 */
import { logger } from 'firebase-functions/v2';
import { createNotification } from '../utils/createNotification';
import { createOutboundRequest } from '../messaging/smsOutboundQueue';
import { getOrCreateThreadForUser } from '../messaging/twoWayMessaging';
import { extractSmsOptIn, resolvePrimaryTenant, resolveWorkerLanguage } from '../avatar/setAvatarVerificationDecision';
import type { CertificationScanReasonCode } from '../shared/certifications/certificationAiVerification';

export type CertNotifyKind = 'verified' | 'reupload';

type Lang = 'en' | 'es';

const REASON_LEAD: Record<Lang, Partial<Record<CertificationScanReasonCode, (name: string) => string>>> = {
  en: {
    unreadable: (n) => `We couldn't read the photo of your ${n}.`,
    not_a_certificate: (n) => `The file you uploaded for ${n} doesn't show the certificate itself.`,
    wrong_credential: (n) => `The document you uploaded doesn't match ${n}.`,
    expired: (n) => `Your ${n} on file appears to be expired.`,
    name_mismatch: (n) => `We couldn't match the name on your ${n} to your profile.`,
  },
  es: {
    unreadable: (n) => `No pudimos leer la foto de tu ${n}.`,
    not_a_certificate: (n) => `El archivo que subiste para ${n} no muestra el certificado en sí.`,
    wrong_credential: (n) => `El documento que subiste no corresponde a ${n}.`,
    expired: (n) => `Tu ${n} registrado parece estar vencido.`,
    name_mismatch: (n) => `No pudimos relacionar el nombre en tu ${n} con tu perfil.`,
  },
};

function copyFor(kind: CertNotifyKind, lang: Lang, name: string, reason: CertificationScanReasonCode | null) {
  if (kind === 'verified') {
    return lang === 'es'
      ? { inApp: `Tu ${name} fue verificado. Ya cuenta para los turnos que lo requieren.`, sms: '' }
      : { inApp: `Your ${name} was verified. It now counts toward shifts that require it.`, sms: '' };
  }
  const lead = (reason && REASON_LEAD[lang][reason]?.(name)) || (lang === 'es' ? `Necesitamos una nueva foto de tu ${name}.` : `We need a new photo of your ${name}.`);
  const ask =
    lang === 'es'
      ? 'Sube una foto clara del certificado completo, sin recortes ni reflejos, desde tu perfil.'
      : 'Please upload a clear photo of the whole certificate, no glare or cropping, from your profile.';
  return {
    inApp: `${lead} ${ask}`,
    sms: `C1 Staffing: ${lead} ${ask}`,
  };
}

export async function notifyWorkerCertification(params: {
  userId: string;
  userData: Record<string, unknown>;
  kind: CertNotifyKind;
  credentialName: string;
  reasonCode: CertificationScanReasonCode | null;
  certificationRecordId: string;
  requestedByUid: string;
  explicitTenantId?: string | null;
  /** SMS only for re-upload asks; callers can still turn it off. */
  sms?: boolean;
}): Promise<{ inAppCreated: boolean; smsQueued: boolean; smsSkipReason?: string }> {
  const { userId, userData, kind, credentialName, reasonCode, certificationRecordId, requestedByUid } = params;
  const lang = resolveWorkerLanguage(userData);
  const copy = copyFor(kind, lang, credentialName, reasonCode);
  let inAppCreated = false;
  try {
    await createNotification({
      recipientType: 'user',
      recipientId: userId,
      type: kind === 'verified' ? 'certification_verified' : 'certification_reupload_request',
      message: copy.inApp,
      actions: ['open_certifications'],
      relatedId: certificationRecordId,
    });
    inAppCreated = true;
  } catch (err) {
    logger.warn('certification_scan.in_app_notification_failed', { userId, error: (err as { message?: string })?.message ?? String(err) });
  }
  const wantSms = params.sms ?? kind === 'reupload';
  if (!wantSms || !copy.sms) return { inAppCreated, smsQueued: false, smsSkipReason: 'sms_not_requested' };

  const tenantId = params.explicitTenantId || resolvePrimaryTenant(userData);
  if (!tenantId) return { inAppCreated, smsQueued: false, smsSkipReason: 'no_tenant_for_sms' };
  const phoneE164 = String((userData as { phoneE164?: unknown }).phoneE164 || '').trim();
  if (!phoneE164) return { inAppCreated, smsQueued: false, smsSkipReason: 'no_phone_on_record' };
  if (!extractSmsOptIn(userData)) return { inAppCreated, smsQueued: false, smsSkipReason: 'worker_has_not_opted_in_to_sms' };

  const twilioNumber = (process.env.TWILIO_MESSAGING_PHONE_NUMBER || '').trim();
  let threadId: string | undefined;
  if (twilioNumber) {
    try {
      threadId = await getOrCreateThreadForUser({ tenantId, userId, phoneE164, twilioNumber, primaryRecruiterId: null });
    } catch (err) {
      logger.warn('certification_scan.thread_resolve_failed_continuing', { tenantId, userId, error: (err as { message?: string })?.message });
    }
  }
  try {
    await createOutboundRequest({
      tenantId,
      threadId,
      recipientUserId: userId,
      toPhoneE164: phoneE164,
      fromPhoneE164: twilioNumber || undefined,
      body: copy.sms,
      templateId: 'certification_reupload_request',
      messageTypeId: 'certification_reupload_request',
      source: 'automation',
      requestedByUid,
      dedupeKey: `certification_reupload:${tenantId}:${userId}:${certificationRecordId}`,
      dedupeWindowHours: 24,
    });
    return { inAppCreated, smsQueued: true };
  } catch (err) {
    logger.warn('certification_scan.sms_enqueue_failed', { tenantId, userId, error: (err as { message?: string })?.message ?? String(err) });
    return { inAppCreated, smsQueued: false, smsSkipReason: 'sms_enqueue_error' };
  }
}
