/**
 * Single write path for `users/{uid}.recruiterScoreSnapshot` and `users/{uid}.recruiterMasterScore`.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { sanitizeForFirestoreWrite } from '../firestore/sanitizeForFirestoreWrite';
import {
  buildRecruiterScoreSnapshotForUserDoc,
  type RecruiterScoreSnapshotGeneratedBy,
} from './buildRecruiterScoreSnapshot';
import { buildRecruiterMasterScoreForUserDoc } from './buildRecruiterMasterScore';

export async function refreshRecruiterScoreSnapshotForUser(
  db: Firestore,
  uid: string,
  generatedBy: RecruiterScoreSnapshotGeneratedBy,
): Promise<{ updated: boolean; signature: string | null }> {
  const nextSnap = await buildRecruiterScoreSnapshotForUserDoc(db, uid, generatedBy);
  const nextMaster = await buildRecruiterMasterScoreForUserDoc(db, uid, generatedBy);
  const userRef = db.collection('users').doc(uid);
  const cur = await userRef.get();
  const data = cur.data() || {};
  const existingSnap = (data.recruiterScoreSnapshot as { inputSignature?: string } | undefined)?.inputSignature;
  const existingMaster = (data.recruiterMasterScore as { inputSignature?: string } | undefined)?.inputSignature;

  const unchanged =
    existingSnap === nextSnap.inputSignature &&
    existingMaster === nextMaster.inputSignature &&
    nextSnap.inputSignature != null &&
    nextMaster.inputSignature != null;

  if (unchanged) {
    return { updated: false, signature: nextSnap.inputSignature };
  }

  try {
    const recruiterScoreSnapshot = sanitizeForFirestoreWrite({
      ...nextSnap,
      updatedAt: FieldValue.serverTimestamp(),
    }) as Record<string, unknown>;
    const recruiterMasterScore = sanitizeForFirestoreWrite({
      ...nextMaster,
      updatedAt: FieldValue.serverTimestamp(),
    }) as Record<string, unknown>;
    await userRef.set({ recruiterScoreSnapshot, recruiterMasterScore }, { merge: true });
  } catch (e: unknown) {
    const code =
      e && typeof e === 'object' && 'code' in e ? String((e as { code?: unknown }).code) : undefined;
    logger.error('refreshRecruiterScoreSnapshotForUser.write_failed', {
      uid,
      code,
      message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }

  return { updated: true, signature: nextSnap.inputSignature };
}
