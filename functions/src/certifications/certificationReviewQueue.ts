/**
 * Review queue mirror: `tenants/{tenantId}/certification_reviews/{userId}__{recordId}`.
 *
 * Why a mirror instead of a collection-group query on `certification_records`:
 * the records carry no tenantId, the queue page needs the worker name and
 * the scan summary in one read, and a tenant-scoped collection keeps the
 * rules simple (staff read; server-only writes). One doc per record while a
 * human decision is outstanding; deleted the moment the record leaves
 * `review.status == 'submitted'` (any writer).
 */
import * as admin from 'firebase-admin';
import type {
  CertificationAiExtractionV1,
  CertificationScanConfidence,
  CertificationScanReasonCode,
  CertificationScanVerdict,
} from '../shared/certifications/certificationAiVerification';

export const CERT_REVIEW_QUEUE_COLLECTION = 'certification_reviews';

export function queueDocId(userId: string, recordId: string): string {
  return `${userId}__${recordId}`;
}

export type CertificationReviewQueueDoc = {
  tenantId: string;
  userId: string;
  certificationRecordId: string;
  status: 'pending';
  workerName: string;
  workerPhoneE164: string | null;
  catalogEntryId: string;
  displayName: string;
  claimed: { issuer: string | null; expirationDate: string | null };
  evidence: { storageUrl: string | null; storagePath: string | null; fileName: string | null; mediaType: string | null };
  ai: {
    verdict: CertificationScanVerdict | null;
    reasonCode: CertificationScanReasonCode | null;
    confidence: CertificationScanConfidence | null;
    notes: string;
    extracted: CertificationAiExtractionV1 | null;
    model: string | null;
  };
  submittedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  updatedAt: admin.firestore.FieldValue;
};

export async function upsertQueueDoc(
  db: admin.firestore.Firestore,
  doc: Omit<CertificationReviewQueueDoc, 'status' | 'updatedAt'>,
): Promise<void> {
  const ref = db.doc(`tenants/${doc.tenantId}/${CERT_REVIEW_QUEUE_COLLECTION}/${queueDocId(doc.userId, doc.certificationRecordId)}`);
  await ref.set({ ...doc, status: 'pending', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
}

export async function deleteQueueDocs(
  db: admin.firestore.Firestore,
  userId: string,
  recordId: string,
  tenantIds: Iterable<string>,
): Promise<number> {
  let n = 0;
  for (const tenantId of tenantIds) {
    const ref = db.doc(`tenants/${tenantId}/${CERT_REVIEW_QUEUE_COLLECTION}/${queueDocId(userId, recordId)}`);
    const snap = await ref.get();
    if (snap.exists) {
      await ref.delete();
      n += 1;
    }
  }
  return n;
}

export function workerDisplayName(user: Record<string, unknown>): string {
  const first = String(user.firstName || '').trim();
  const last = String(user.lastName || '').trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  const dn = String(user.displayName || '').trim();
  if (dn) return dn;
  return String(user.email || '').trim() || 'Worker';
}

/** activeTenantId → tenantId → first of tenantIds. */
export function primaryTenantOf(user: Record<string, unknown>, all: Set<string>): string | null {
  const active = String(user.activeTenantId || '').trim();
  if (active) return active;
  const direct = String(user.tenantId || '').trim();
  if (direct) return direct;
  const first = all.values().next();
  return first.done ? null : first.value;
}
