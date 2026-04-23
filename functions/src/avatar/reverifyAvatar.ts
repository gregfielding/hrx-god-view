/**
 * Callable: force a re-verification of a user's current avatar.
 *
 * Uses for Phase 1:
 *   - Backfilling: run against existing users so their avatarVerification record is populated
 *     before Phase 2 UI goes live.
 *   - Debugging: re-run Vision on a specific worker's photo when a recruiter disagrees with
 *     the decision, without needing to wait for a new upload.
 *
 * The trigger's echo-prevention deliberately blocks re-verification when the avatar URL
 * hasn't changed — this callable bypasses that by writing the new record directly.
 *
 * Auth: requires a signed-in user whose token carries an HRX admin / recruiter role for
 * the same tenant as the target user. We check this conservatively by requiring the caller's
 * own tenantIds to include the target user's tenantId AND their security level to be >= 4
 * (Manager / Admin — the same tier that can see compliance records elsewhere in the app).
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { runAvatarVerification } from './runAvatarVerification';
import { AvatarVerification } from './avatarVerificationTypes';
import { assertCallerCanManageAvatarTarget } from './avatarAdminPerms';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

interface ReverifyAvatarRequest {
  userId: string;
  /** Optional — lets callers force verification of a newly-set URL even before the user doc is written. */
  overrideAvatarUrl?: string;
}

interface ReverifyAvatarResponse {
  status: AvatarVerification['status'];
  rejectionReason: AvatarVerification['rejectionReason'];
  qualitySignals: AvatarVerification['qualitySignals'];
  sourceAvatarUrl: string;
}

export const reverifyAvatar = onCall<ReverifyAvatarRequest, Promise<ReverifyAvatarResponse>>(
  { cors: true, region: 'us-central1', memory: '512MiB', timeoutSeconds: 60 },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Sign-in required.');
    }

    const targetUserId = String(request.data?.userId || '').trim();
    if (!targetUserId) {
      throw new HttpsError('invalid-argument', 'userId is required.');
    }

    // Self-verify is allowed with no extra permissions (useful if the client wants to
    // retrigger after the user retakes their own photo).
    const isSelf = callerUid === targetUserId;

    const targetSnap = await db.doc(`users/${targetUserId}`).get();
    if (!targetSnap.exists) {
      throw new HttpsError('not-found', 'User not found.');
    }
    const targetData = targetSnap.data() as Record<string, unknown>;

    if (!isSelf) {
      await assertCallerCanManageAvatarTarget(callerUid, targetData);
    }

    const url =
      String(request.data?.overrideAvatarUrl || '').trim() ||
      String((targetData as { avatar?: unknown }).avatar || '').trim();
    if (!url) {
      throw new HttpsError('failed-precondition', 'User has no avatar to verify.');
    }

    logger.info('avatar_verification.reverify_requested', {
      callerUid,
      targetUserId,
      isSelf,
    });

    const decision = await runAvatarVerification({ url, userId: targetUserId });

    const record: Record<string, unknown> = {
      status: decision.status,
      sourceAvatarUrl: url,
      qualitySignals: decision.qualitySignals,
      rejectionReason: decision.rejectionReason,
      verifiedBy: isSelf ? 'system' : callerUid,
      verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      // Explicitly clear override fields — a reverify is a fresh system pass.
      previousAutoDecision: admin.firestore.FieldValue.delete(),
      overrideNote: admin.firestore.FieldValue.delete(),
    };
    if (decision.errorCode) record.errorCode = decision.errorCode;
    if (decision.errorMessage) record.errorMessage = decision.errorMessage;
    else {
      record.errorCode = admin.firestore.FieldValue.delete();
      record.errorMessage = admin.firestore.FieldValue.delete();
    }

    await db.doc(`users/${targetUserId}`).set({ avatarVerification: record }, { merge: true });

    return {
      status: decision.status,
      rejectionReason: decision.rejectionReason,
      qualitySignals: decision.qualitySignals,
      sourceAvatarUrl: url,
    };
  },
);

