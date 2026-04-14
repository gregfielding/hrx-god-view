/**
 * Worker SMS when staff approves or rejects an I-9 supporting document upload.
 */
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { sendWorkerMessageInternal } from '../twilio';
import { buildWorkerProfileUrl } from '../utils/workerUrls';
import { i9ListGroupForDocumentType, isI9DocumentSetComplete, type I9DocRowLike } from '../utils/i9SupportingDocumentCompletion';
import { i9SupportingApprovedToI9CaseFlatPartial, type I9SupportingDocLike } from '../utils/i9SupportingToEverifyMerge';

const db = admin.firestore();

export type WorkerSmsLang = 'en' | 'es';

/** Align with `routingOrchestrator` / `users.preferredLanguage`. */
export function resolveWorkerSmsLang(userData: Record<string, unknown>): WorkerSmsLang {
  const raw = String(userData.preferredLanguage ?? '').trim().toLowerCase();
  if (raw === 'es' || raw === 'spa' || raw === 'spanish') return 'es';
  return 'en';
}

/** Short, SMS-friendly labels (not full List A/B/C titles). */
export function shortLabelForI9SupportingDocumentType(documentType: string, lang: WorkerSmsLang = 'en'): string {
  const v = String(documentType || '').trim();
  if (lang === 'es') {
    switch (v) {
      case 'list_a_us_passport':
        return 'pasaporte de EE. UU.';
      case 'list_a_pr_card':
        return 'tarjeta de residente permanente';
      case 'list_a_ead':
        return 'documento de autorización de empleo';
      case 'list_b_drivers_license':
        return 'licencia de conducir';
      case 'list_b_gov_id':
        return 'identificación oficial';
      case 'list_c_ssn_card':
        return 'tarjeta del Seguro Social';
      case 'list_c_birth_certificate':
        return 'acta de nacimiento';
      case 'other_supporting':
        return 'documento de respaldo';
      default:
        return v || 'documento';
    }
  }
  switch (v) {
    case 'list_a_us_passport':
      return 'U.S. passport';
    case 'list_a_pr_card':
      return 'permanent resident card';
    case 'list_a_ead':
      return 'employment authorization document';
    case 'list_b_drivers_license':
      return "driver's license";
    case 'list_b_gov_id':
      return 'government ID';
    case 'list_c_ssn_card':
      return 'Social Security card';
    case 'list_c_birth_certificate':
      return 'birth certificate';
    case 'other_supporting':
      return 'supporting document';
    default:
      return v || 'document';
  }
}

function greetingPrefix(firstName: string, lang: WorkerSmsLang): string {
  if (!firstName) return '';
  return lang === 'es' ? `Hola ${firstName}, ` : `Hi ${firstName}, `;
}

function buildI9SupportingReviewSmsBody(params: {
  lang: WorkerSmsLang;
  hi: string;
  docLabel: string;
  decision: 'approved' | 'rejected';
  listGroup: ReturnType<typeof i9ListGroupForDocumentType>;
  complete: boolean;
  profileUrl: string;
}): string {
  const { lang, hi, docLabel, decision, listGroup, complete, profileUrl } = params;

  if (decision === 'approved') {
    if (lang === 'es') {
      if (listGroup === 'a') {
        return `${hi}Se aprobó tu ${docLabel}. La revisión de tus documentos I-9 está completa.`;
      }
      if (listGroup === 'b' || listGroup === 'c') {
        if (complete) {
          return `${hi}Se aprobó tu ${docLabel}. La revisión de tus documentos I-9 está completa.`;
        }
        return `${hi}Se aprobó tu ${docLabel}.`;
      }
      return `${hi}Se aprobó tu ${docLabel}.`;
    }
    if (listGroup === 'a') {
      return `${hi}Your ${docLabel} was approved. Your I-9 document review is complete.`;
    }
    if (listGroup === 'b' || listGroup === 'c') {
      if (complete) {
        return `${hi}Your ${docLabel} was approved. Your I-9 document review is complete.`;
      }
      return `${hi}Your ${docLabel} was approved.`;
    }
    return `${hi}Your ${docLabel} was approved.`;
  }

  const link = profileUrl ? (lang === 'es' ? ` Vuelve a subir aquí: ${profileUrl}` : ` Re-upload here: ${profileUrl}`) : '';
  if (lang === 'es') {
    return `${hi}No se aprobó tu ${docLabel}. Sube una copia más clara.${link}`;
  }
  return `${hi}Your ${docLabel} was not approved. Please upload a clearer copy.${link}`;
}

function rowsFromSnapDocs(docs: admin.firestore.QueryDocumentSnapshot[]): I9DocRowLike[] {
  return docs.map((d) => {
    const x = d.data() as Record<string, unknown>;
    return {
      documentType: String(x.documentType || ''),
      status: String(x.status || ''),
    };
  });
}

export async function notifyWorkerAfterI9SupportingReview(params: {
  tenantId: string;
  targetUserId: string;
  documentType: string;
  decision: 'approved' | 'rejected';
}): Promise<void> {
  const { tenantId, targetUserId, documentType, decision } = params;

  const userRef = db.doc(`users/${targetUserId}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    logger.warn('i9_supporting_review.notify_skip_no_user', { targetUserId });
    return;
  }
  const ud = userSnap.data() || {};
  const phone = String(ud.phoneE164 || '').trim();
  if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) {
    logger.info('i9_supporting_review.notify_skip_no_phone', { targetUserId });
    return;
  }

  const firstRaw = String(ud.firstName || ud.preferredFirstName || '').trim();
  const firstName = firstRaw ? firstRaw.split(/\s+/)[0] : '';
  const lang = resolveWorkerSmsLang(ud);
  const hi = greetingPrefix(firstName, lang);

  const col = db.collection(`tenants/${tenantId}/worker_i9_supporting_documents`);
  const allSnap = await col.where('userId', '==', targetUserId).get();
  const rows = rowsFromSnapDocs(allSnap.docs);
  const complete = isI9DocumentSetComplete(rows);
  const listGroup = i9ListGroupForDocumentType(documentType);
  const docLabel = shortLabelForI9SupportingDocumentType(documentType, lang);
  const profileUrl = buildWorkerProfileUrl();

  const body = buildI9SupportingReviewSmsBody({
    lang,
    hi,
    docLabel,
    decision,
    listGroup,
    complete,
    profileUrl,
  });

  const result = await sendWorkerMessageInternal(phone, body, {
    systemContext: true,
    source: 'i9_supporting_document_review',
    tenantId,
    userId: targetUserId,
  });
  if (!result.success) {
    logger.warn('i9_supporting_review.sms_failed', {
      targetUserId,
      tenantId,
      status: result.status,
      error: result.error,
    });
  } else {
    logger.info('i9_supporting_review.sms_sent', { targetUserId, tenantId, decision, lang });
  }
}

export async function writeEverifyI9SupportingPrefillSnapshot(tenantId: string, targetUserId: string): Promise<void> {
  const col = db.collection(`tenants/${tenantId}/worker_i9_supporting_documents`);
  const allSnap = await col.where('userId', '==', targetUserId).get();
  const rows = allSnap.docs.map((d) => d.data() as I9SupportingDocLike);
  const flatPartial = i9SupportingApprovedToI9CaseFlatPartial(rows);
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.doc(`users/${targetUserId}`).set(
    {
      everifyI9SupportingPrefill: {
        updatedAt: now,
        tenantId,
        flatPartial,
      },
    },
    { merge: true },
  );
}
