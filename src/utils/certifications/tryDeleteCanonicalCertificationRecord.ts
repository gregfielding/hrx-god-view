import { deleteDoc, doc } from 'firebase/firestore';

import { db } from '../../firebase';
import { isCertRecordsDualWriteEnabled } from './isCertRecordsDualWriteEnabled';
import { warnCertifications } from './certificationsLogging';

/** Best-effort delete canonical doc when legacy row is removed; does not throw. */
export async function tryDeleteCanonicalCertificationRecord(
  uid: string,
  certificationRecordId: string | undefined | null,
): Promise<void> {
  if (!isCertRecordsDualWriteEnabled() || !certificationRecordId) return;
  try {
    await deleteDoc(doc(db, 'users', uid, 'certification_records', certificationRecordId));
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    warnCertifications('dual_write_failed', {
      userId: uid,
      detail: `delete canonical cert ${certificationRecordId}: ${detail}`,
    });
  }
}
