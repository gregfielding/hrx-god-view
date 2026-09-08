/**
 * Reviewer decision on a worker certification record (the human half of the
 * AI cert scan, 2026-09-08). Mirrors `setAvatarVerificationDecision`:
 *   - 'approve'          → review approved, record active; optional corrections
 *                          to issuer / expiration (the reviewer read the card).
 *   - 'reject'           → review rejected with a reason code; in-app notice only.
 *   - 'request_reupload' → same as reject + SMS nudge asking for a clear photo.
 *
 * Caller must be Manager (4) or Admin (5) sharing a tenant with the worker.
 * Writes are Admin SDK so L4 reviewers work even though the client rules
 * reserve `certification_records` writes for L5+. The queue mirror row is
 * removed here (and again by the trigger, harmlessly).
 */
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { assertCallerCanManageWorkerTarget, toTenantIdSet } from '../avatar/avatarAdminPerms';
import catalogManifestJson from '../shared/data/certificationCatalogManifest.v1.json';
import type { CertificationCatalogManifestV1 } from '../shared/certifications/certificationCatalogManifest';
import type { CertificationRecordV1 } from '../shared/certifications/certificationRecord';
import type { CertificationScanReasonCode } from '../shared/certifications/certificationAiVerification';
import { deleteQueueDocs, primaryTenantOf, workerDisplayName } from './certificationReviewQueue';
import { notifyWorkerCertification } from './certificationWorkerNotify';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const manifest = catalogManifestJson as unknown as CertificationCatalogManifestV1;

type Decision = 'approve' | 'reject' | 'request_reupload';
const REJECT_REASONS: ReadonlySet<CertificationScanReasonCode> = new Set<CertificationScanReasonCode>([
  'unreadable', 'not_a_certificate', 'wrong_credential', 'name_mismatch', 'expired', 'expiration_missing', 'tampering_suspected', 'manual_override', 'other',
]);
const NOTE_MAX = 500;

interface Req {
  userId: string;
  certificationRecordId: string;
  decision: Decision;
  reasonCode?: CertificationScanReasonCode;
  note?: string;
  corrections?: { issuer?: string | null; expirationDate?: string | null };
  tenantId?: string;
}
interface Res {
  reviewStatus: 'approved' | 'rejected';
  recordStatus: 'active' | 'rejected';
  decidedBy: string;
  nudge?: { inAppCreated: boolean; smsQueued: boolean; smsSkipReason?: string };
}

export const setCertificationReviewDecision = onCall<Req, Promise<Res>>({ cors: true, region: 'us-central1' }, async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign-in required.');
  const userId = String(request.data?.userId || '').trim();
  const recordId = String(request.data?.certificationRecordId || '').trim();
  const decision = request.data?.decision;
  if (!userId || !recordId) throw new HttpsError('invalid-argument', 'userId and certificationRecordId are required.');
  if (decision !== 'approve' && decision !== 'reject' && decision !== 'request_reupload') {
    throw new HttpsError('invalid-argument', "decision must be 'approve' | 'reject' | 'request_reupload'.");
  }
  if (userId === callerUid) throw new HttpsError('failed-precondition', 'You cannot review your own certification.');
  const note = String(request.data?.note || '').trim().slice(0, NOTE_MAX);
  const reasonCode: CertificationScanReasonCode =
    decision === 'approve' ? 'looks_valid' : REJECT_REASONS.has(request.data?.reasonCode as CertificationScanReasonCode) ? (request.data!.reasonCode as CertificationScanReasonCode) : 'manual_override';

  const corrections = request.data?.corrections ?? {};
  const issuerFix = corrections.issuer === undefined ? undefined : String(corrections.issuer || '').trim().slice(0, 200) || null;
  let expirationFix: string | null | undefined;
  if (corrections.expirationDate !== undefined) {
    const raw = String(corrections.expirationDate || '').trim();
    if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new HttpsError('invalid-argument', 'corrections.expirationDate must be YYYY-MM-DD or empty.');
    expirationFix = raw || null;
  }

  const targetSnap = await db.doc(`users/${userId}`).get();
  if (!targetSnap.exists) throw new HttpsError('not-found', 'Worker not found.');
  const target = targetSnap.data() as Record<string, unknown>;
  await assertCallerCanManageWorkerTarget(callerUid, target);

  const recordRef = db.doc(`users/${userId}/certification_records/${recordId}`);
  const recordSnap = await recordRef.get();
  if (!recordSnap.exists) throw new HttpsError('not-found', 'Certification record not found.');
  const record = recordSnap.data() as CertificationRecordV1;

  const callerSnap = await db.doc(`users/${callerUid}`).get();
  const callerName = workerDisplayName((callerSnap.data() ?? {}) as Record<string, unknown>);
  const entry = manifest.entries.find((e) => e.catalogEntryId === record.catalogEntryId);
  const credentialName = entry?.displayName ?? record.catalogEntryId;

  const approve = decision === 'approve';
  const now = FieldValue.serverTimestamp();
  const aiVerdict = record.aiVerification?.verdict ?? null;
  const previousAutoVerdict =
    record.review?.previousAutoVerdict !== undefined ? record.review.previousAutoVerdict : (record.review?.decidedBy === 'system' || aiVerdict ? aiVerdict : null);

  const patch: Record<string, unknown> = {
    review: {
      status: approve ? 'approved' : 'rejected',
      rejectionReason: approve ? null : reasonCode,
      decidedBy: callerUid,
      decidedAt: now,
      note: note || null,
      previousAutoVerdict: previousAutoVerdict ?? null,
    },
    recordStatus: approve ? 'active' : 'rejected',
    updatedAt: now,
  };
  if (approve) {
    if (issuerFix !== undefined) patch.issuer = issuerFix;
    else if (!record.issuer && record.aiVerification?.extracted?.issuer) patch.issuer = record.aiVerification.extracted.issuer;
    if (expirationFix !== undefined) patch.expirationDate = expirationFix;
    else if (!record.expirationDate && record.aiVerification?.extracted?.expirationDate) patch.expirationDate = record.aiVerification.extracted.expirationDate;
  }

  const batch = db.batch();
  batch.update(recordRef, patch);
  batch.set(db.collection(`users/${userId}/activityLogs`).doc(), {
    action: 'Certification Review',
    actionType: 'certification_review',
    description: approve
      ? `${credentialName} approved by ${callerName}${note ? ` — ${note}` : ''}`
      : `${credentialName} ${decision === 'request_reupload' ? 'sent back for a new photo' : 'rejected'} by ${callerName} (${reasonCode})${note ? ` — ${note}` : ''}`,
    severity: 'low',
    source: 'server',
    metadata: {
      targetType: 'certificationRecord',
      certificationRecordId: recordId,
      catalogEntryId: record.catalogEntryId,
      decision,
      reasonCode,
      decidedById: callerUid,
      decidedByName: callerName,
      aiVerdict,
      aiReasonCode: record.aiVerification?.reasonCode ?? null,
      ...(issuerFix !== undefined ? { issuerCorrected: issuerFix } : {}),
      ...(expirationFix !== undefined ? { expirationCorrected: expirationFix } : {}),
    },
    timestamp: now,
    createdAt: now,
  });
  await batch.commit();

  const tenants = toTenantIdSet(target);
  const primary = primaryTenantOf(target, tenants);
  if (primary) tenants.add(primary);
  await deleteQueueDocs(db, userId, recordId, tenants);

  logger.info('certification_review.decision', { callerUid, userId, recordId, decision, reasonCode, aiVerdict, overrode: !!aiVerdict && ((approve && aiVerdict !== 'auto_approve') || (!approve && aiVerdict === 'auto_approve')) });

  let nudge: Res['nudge'];
  try {
    nudge = await notifyWorkerCertification({
      userId,
      userData: target,
      kind: approve ? 'verified' : 'reupload',
      credentialName,
      reasonCode: approve ? null : reasonCode,
      certificationRecordId: recordId,
      requestedByUid: callerUid,
      explicitTenantId: request.data?.tenantId || null,
      sms: decision === 'request_reupload',
    });
  } catch (err) {
    logger.warn('certification_review.notify_failed', { userId, recordId, error: (err as { message?: string })?.message });
  }
  return { reviewStatus: approve ? 'approved' : 'rejected', recordStatus: approve ? 'active' : 'rejected', decidedBy: callerUid, nudge };
});
