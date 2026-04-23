import { doc, getDoc } from 'firebase/firestore';

import { db } from '../../firebase';
import { getCanonicalCertificationRecordsWithIds } from './getCanonicalCertificationRecords';
import { getWorkerCertificationsUnified } from './getWorkerCertificationsUnified';

/**
 * One-shot dev/support helper: legacy count, canonical count, unified summary. **No persistence.**
 * Call from browser console or internal tools only.
 */
export async function debugCheckUserCerts(uid: string): Promise<void> {
  const userSnap = await getDoc(doc(db, 'users', uid));
  const legacy = Array.isArray(userSnap.data()?.certifications) ? userSnap.data()!.certifications : [];
  const legacyCount = legacy.length;

  const canonRows = await getCanonicalCertificationRecordsWithIds(uid);
  const unified = await getWorkerCertificationsUnified(uid);

  // eslint-disable-next-line no-console -- intentional dev-only structured log
  console.warn('[certifications:debugCheckUserCerts]', {
    uid,
    legacyCount,
    canonicalCount: canonRows.length,
    unifiedItemCount: unified.items.length,
    unifiedCanonicalCountField: unified.canonicalCount,
    legacyOnlyUnmappedCount: unified.legacyOnlyCount,
    topLevelWarnings: unified.warnings,
    itemsPreview: unified.items.slice(0, 20).map((i) => ({
      displayName: i.displayName,
      provenance: i.provenance,
      recordStatus: i.recordStatus,
      reviewStatus: i.reviewStatus,
      warningCount: (i.mergeWarnings ?? []).length,
    })),
  });
}
