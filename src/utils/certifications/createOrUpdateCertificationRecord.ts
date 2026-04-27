/**
 * ONLY ENTRY POINT for certification writes to canonical `certification_records`.
 * Do not write directly to `users/{uid}/certification_records` outside this module pair
 * (`createOrUpdateCertificationRecord` + related delete/dual-write helpers).
 */

import { collection, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

import { db } from '../../firebase';
import { CERTIFICATION_CATALOG_SCHEMA_VERSION } from '../../shared/certifications/certificationCatalogManifest';
import type { CertificationRecordV1 } from '../../shared/certifications/certificationRecord';
import type { CertificationSourcePhase1 } from '../../shared/certifications/certificationEnums';
import { normalizeDateToISODateString } from '../../shared/certifications/normalizeDateToISODateString';
import { computeCertificationWriteDefaults } from './computeCertificationWriteDefaults';
import type { CertificationEvidenceFileRefV1 } from '../../shared/certifications/certificationRecord';

export type CreateOrUpdateCertificationRecordInput = {
  uid: string;
  /** Omit for create — random id allocated. */
  certificationRecordId?: string | null;
  catalogEntryId: string;
  issuerName?: string | null;
  expirationDate?: string | null;
  evidenceFiles: CertificationEvidenceFileRefV1[];
  source: CertificationSourcePhase1;
  /** From catalog (`allowsSelfAttestation`) — required for worker attestation defaults. */
  catalogAllowsSelfAttestation: boolean;
};

/**
 * Create or update `users/{uid}/certification_records/{certificationRecordId}`.
 */
export async function createOrUpdateCertificationRecord(
  input: CreateOrUpdateCertificationRecordInput,
): Promise<{ certificationRecordId: string }> {
  const {
    uid,
    catalogEntryId,
    issuerName,
    expirationDate,
    evidenceFiles,
    source,
    catalogAllowsSelfAttestation,
  } = input;

  const expirationNormalized = normalizeDateToISODateString(expirationDate);
  const hasEvidenceFile = evidenceFiles.some(
    (e) => !!(e.storagePath || e.storageUrl || e.fileName),
  );

  const { reviewStatus, recordStatus } = computeCertificationWriteDefaults({
    source,
    hasEvidenceFile,
    catalogAllowsSelfAttestation,
  });

  const payload: CertificationRecordV1 = {
    schemaVersion: CERTIFICATION_CATALOG_SCHEMA_VERSION,
    catalogEntryId,
    issuer: issuerName ?? null,
    expirationDate: expirationNormalized,
    evidenceFileRefs: evidenceFiles.length > 0 ? evidenceFiles : undefined,
    review: {
      status: reviewStatus,
      rejectionReason: null,
    },
    recordStatus,
    source,
    updatedAt: serverTimestamp(),
  };

  const colRef = collection(db, 'users', uid, 'certification_records');
  let recordId = input.certificationRecordId ?? null;
  if (!recordId) {
    recordId = doc(colRef).id;
  }

  const dRef = doc(db, 'users', uid, 'certification_records', recordId);

  if (input.certificationRecordId) {
    await updateDoc(dRef, {
      ...payload,
      updatedAt: serverTimestamp(),
    } as Record<string, unknown>);
  } else {
    await setDoc(dRef, {
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as Record<string, unknown>);
  }

  return { certificationRecordId: recordId };
}
