import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

function getMaxSecurityLevel(userData: any): number {
  const levels: number[] = [];
  const topLevel = Number.parseInt(String(userData?.securityLevel ?? '0'), 10);
  if (Number.isFinite(topLevel)) levels.push(topLevel);

  const tenantIds = userData?.tenantIds;
  if (tenantIds && typeof tenantIds === 'object') {
    Object.values(tenantIds).forEach((entry: any) => {
      const level = Number.parseInt(String(entry?.securityLevel ?? '0'), 10);
      if (Number.isFinite(level)) levels.push(level);
    });
  }

  return levels.length > 0 ? Math.max(...levels) : 0;
}

export const deleteUserCompletely = onCall(async (request) => {
  const actorUid = request.auth?.uid;
  const targetUid = String(request.data?.uid || '').trim();

  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }
  if (!targetUid) {
    throw new HttpsError('invalid-argument', 'Missing uid.');
  }

  const db = admin.firestore();
  const actorRef = db.collection('users').doc(actorUid);
  const targetRef = db.collection('users').doc(targetUid);

  const [actorSnap, targetSnap] = await Promise.all([actorRef.get(), targetRef.get()]);
  if (!targetSnap.exists) {
    throw new HttpsError('not-found', 'User not found.');
  }

  const actorData = actorSnap.exists ? actorSnap.data() : {};
  const actorMaxLevel = getMaxSecurityLevel(actorData);
  const isSelfDelete = actorUid === targetUid;
  const canDeleteOthers = actorMaxLevel >= 6;

  if (!isSelfDelete && !canDeleteOthers) {
    throw new HttpsError('permission-denied', 'You do not have permission to delete this user.');
  }

  try {
    await db.recursiveDelete(targetRef);
  } catch (err) {
    throw new HttpsError('internal', `Failed to delete Firestore user document: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    await admin.auth().deleteUser(targetUid);
  } catch (err) {
    throw new HttpsError('internal', `Failed to delete Firebase Auth user: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { success: true };
});
