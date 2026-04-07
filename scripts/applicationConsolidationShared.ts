/**
 * Shared Firestore helpers for consolidation dry-run / execute scripts.
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

import type { CandidateDocIdentity } from '../src/utils/applicationConsolidationPolicy';

export function initAdmin(): void {
  let credential: admin.credential.Credential | undefined;
  const possibleKeyPaths = [
    path.join(__dirname, '..', 'serviceAccountKey.json'),
    path.join(__dirname, '..', 'firebase-adminsdk.json'),
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
  ].filter(Boolean) as string[];

  for (const keyPath of possibleKeyPaths) {
    if (keyPath && fs.existsSync(keyPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      credential = admin.credential.cert(serviceAccount);
      console.error(`Using service account: ${keyPath}`);
      break;
    }
  }
  if (!credential) {
    credential = admin.credential.applicationDefault();
    console.error('Using application default credentials');
  }

  const projectId =
    process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.FIREBASE_PROJECT_ID || undefined;

  try {
    admin.initializeApp({ credential, ...(projectId ? { projectId } : {}) });
  } catch {
    // already initialized
  }
}

export function firestoreTimeToMs(v: unknown): number | null {
  if (v == null) return null;
  const t = v as { toMillis?: () => number; _seconds?: number };
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t._seconds === 'number') return t._seconds * 1000;
  return null;
}

export function toIdentity(
  docId: string,
  data: admin.firestore.DocumentData,
  storage: 'tenant' | 'nested'
): CandidateDocIdentity {
  const cand = (data?.candidate || {}) as Record<string, unknown>;
  return {
    docId,
    storage,
    userId: (data?.userId ?? data?.candidateId ?? null) as string | null,
    emailRaw: (cand.email as string) || (data?.email as string) || null,
    phoneRaw: (cand.phone as string) || (data?.phone as string) || null,
    candidateFirstName: (cand.firstName as string) || null,
    candidateLastName: (cand.lastName as string) || null,
    createdAtMs: firestoreTimeToMs(data?.createdAt),
  };
}

export function candidateSummary(
  docId: string,
  data: admin.firestore.DocumentData,
  storage: 'tenant' | 'nested'
) {
  const cand = (data?.candidate || {}) as Record<string, unknown>;
  const createdAtMs = firestoreTimeToMs(data?.createdAt);
  return {
    docId,
    storage,
    userId: data?.userId ?? data?.candidateId ?? null,
    email: (cand.email as string) || null,
    phone: (cand.phone as string) || null,
    displayName:
      [cand.firstName, cand.lastName].filter(Boolean).join(' ').trim() || null,
    status: data?.status != null ? String(data.status) : null,
    createdAtMs,
    createdAtIso: createdAtMs != null ? new Date(createdAtMs).toISOString() : null,
  };
}

export async function loadApplicationsForJobOrder(
  db: admin.firestore.Firestore,
  tenantId: string,
  jobOrderId: string
): Promise<{
  tenantDocs: admin.firestore.QueryDocumentSnapshot[];
  nestedDocs: admin.firestore.QueryDocumentSnapshot[];
}> {
  const nestedRef = db
    .collection('tenants')
    .doc(tenantId)
    .collection('job_orders')
    .doc(jobOrderId)
    .collection('applications');
  const nestedSnap = await nestedRef.get();

  const tenantSnap = await db
    .collection('tenants')
    .doc(tenantId)
    .collection('applications')
    .where('jobOrderId', '==', jobOrderId)
    .get();

  return { tenantDocs: tenantSnap.docs, nestedDocs: nestedSnap.docs };
}

export function tenantApplicationRef(
  db: admin.firestore.Firestore,
  tenantId: string,
  docId: string
): admin.firestore.DocumentReference {
  return db.collection('tenants').doc(tenantId).collection('applications').doc(docId);
}

export function nestedApplicationRef(
  db: admin.firestore.Firestore,
  tenantId: string,
  jobOrderId: string,
  docId: string
): admin.firestore.DocumentReference {
  return db
    .collection('tenants')
    .doc(tenantId)
    .collection('job_orders')
    .doc(jobOrderId)
    .collection('applications')
    .doc(docId);
}
