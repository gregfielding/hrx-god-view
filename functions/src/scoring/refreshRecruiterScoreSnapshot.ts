/**
 * Single write path for `users/{uid}.recruiterScoreSnapshot`.
 */
import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import {
  buildRecruiterScoreSnapshotForUserDoc,
  type RecruiterScoreSnapshotGeneratedBy,
} from './buildRecruiterScoreSnapshot';

export async function refreshRecruiterScoreSnapshotForUser(
  db: Firestore,
  uid: string,
  generatedBy: RecruiterScoreSnapshotGeneratedBy,
): Promise<{ updated: boolean; signature: string | null }> {
  const nextSnap = await buildRecruiterScoreSnapshotForUserDoc(db, uid, generatedBy);
  const userRef = db.collection('users').doc(uid);
  const cur = await userRef.get();
  const existing = (cur.data()?.recruiterScoreSnapshot as { inputSignature?: string } | undefined)?.inputSignature;

  if (existing === nextSnap.inputSignature && nextSnap.inputSignature != null) {
    return { updated: false, signature: nextSnap.inputSignature };
  }

  try {
    await userRef.set(
      {
        recruiterScoreSnapshot: {
          ...nextSnap,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        } as Record<string, unknown>,
      },
      { merge: true },
    );
  } catch (e) {
    logger.error('refreshRecruiterScoreSnapshotForUser.write_failed', {
      uid,
      message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }

  return { updated: true, signature: nextSnap.inputSignature };
}
