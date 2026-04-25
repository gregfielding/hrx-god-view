/**
 * REQUIRED: All certification reads for product logic must go through
 * {@link getCanonicalCertificationRecords} or {@link getCanonicalCertificationRecordsWithIds}.
 * Do not read `users.*.certifications` or ad-hoc Firestore for decisioning.
 */

import { collection, getDocs, orderBy, query } from 'firebase/firestore';

import { db } from '../../firebase';
import type { CertificationRecordV1 } from '../../shared/certifications/certificationRecord';

/** Firestore doc id under `certification_records` — same value as `certificationRecordId` on legacy rows after dual-write. */
export type CanonicalCertificationRecordDoc = {
  certificationRecordId: string;
  record: CertificationRecordV1;
};

/**
 * Read all canonical `certification_records` for a user, newest `updatedAt` first.
 * No merging with legacy.
 */
export async function getCanonicalCertificationRecords(uid: string): Promise<CertificationRecordV1[]> {
  const rows = await getCanonicalCertificationRecordsWithIds(uid);
  return rows.map((r) => r.record);
}

/**
 * Same as {@link getCanonicalCertificationRecords} but includes each document id (needed for unified adapter + id pairing).
 */
export async function getCanonicalCertificationRecordsWithIds(uid: string): Promise<CanonicalCertificationRecordDoc[]> {
  const q = query(collection(db, 'users', uid, 'certification_records'), orderBy('updatedAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    certificationRecordId: d.id,
    record: d.data() as CertificationRecordV1,
  }));
}
