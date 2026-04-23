/**
 * Firestore trigger: whenever `users/{userId}.avatar` changes, run Cloud Vision face
 * detection and write the decision to `users/{userId}.avatarVerification`.
 *
 * Why listen on the user doc (instead of a Cloud Storage object-finalize trigger):
 *   - Avatar URLs can come from anywhere — Firebase Storage (apply wizard today), Google
 *     OAuth login photos (for social signup), or an admin-pasted external URL. The user
 *     doc is the single place where the authoritative "current avatar" is recorded.
 *   - Matches the existing DocumentAI / I-9 pattern in this codebase (Firestore trigger
 *     reads a storagePath from the doc and writes enrichment back to it).
 *
 * Loop prevention:
 *   We write back into the same document. Without care, that write re-triggers the function
 *   indefinitely. We short-circuit when:
 *     a) The `avatar` field is unchanged between before/after.
 *     b) The only diff is under `avatarVerification` (our own write echoing).
 *   Additionally, we refuse to re-verify when `avatarVerification.sourceAvatarUrl` already
 *   matches the current avatar and has reached a terminal status — belt-and-suspenders in
 *   case an unrelated field change happens to coincide with our writeback.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { runAvatarVerification } from './runAvatarVerification';
import { AvatarVerification } from './avatarVerificationTypes';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Any of these statuses mean the record is already final for the current `sourceAvatarUrl`
 * — no reason to spend another Vision call. `'error'` is NOT terminal: a transient failure
 * (network blip, Vision quota) should retry on the next spurious write.
 */
const TERMINAL_STATUSES = new Set<AvatarVerification['status']>(['approved', 'rejected']);

export const onUserAvatarChangedVerify = onDocumentWritten(
  {
    document: 'users/{userId}',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
    // Avatar uploads are low-volume; cap tight to prevent runaway loops if the echo
    // detection ever misses something.
    maxInstances: 10,
  },
  async (event) => {
    const userId = event.params.userId as string;
    const beforeSnap = event.data?.before;
    const afterSnap = event.data?.after;

    if (!afterSnap?.exists) {
      // User doc deleted — nothing to verify.
      return;
    }

    const beforeData = (beforeSnap?.exists ? beforeSnap.data() : undefined) as
      | Record<string, unknown>
      | undefined;
    const afterData = afterSnap.data() as Record<string, unknown>;

    const beforeAvatar = stringOrEmpty(beforeData?.avatar);
    const afterAvatar = stringOrEmpty(afterData.avatar);

    // (a) Avatar unchanged → ignore. This also covers the avatarVerification-echo case.
    if (beforeAvatar === afterAvatar) {
      return;
    }

    // Avatar cleared to empty/null — clear any stale verification record and stop.
    if (!afterAvatar) {
      if (afterData.avatarVerification) {
        await db.doc(`users/${userId}`).set(
          {
            avatarVerification: admin.firestore.FieldValue.delete(),
          },
          { merge: true },
        );
        logger.info('avatar_verification.cleared', { userId });
      }
      return;
    }

    // (c) Extra guard: if we've already written a terminal decision for THIS avatar URL,
    // don't rerun. Protects against any write that happens to flip the avatar field back
    // to the same value (shouldn't happen, but cheap to check).
    const existing = afterData.avatarVerification as AvatarVerification | undefined;
    if (
      existing &&
      TERMINAL_STATUSES.has(existing.status) &&
      existing.sourceAvatarUrl === afterAvatar
    ) {
      return;
    }

    // Stamp 'pending' immediately so any UI reading the user doc sees we're working on it.
    const pendingPayload: Partial<AvatarVerification> = {
      status: 'pending',
      sourceAvatarUrl: afterAvatar,
      qualitySignals: null,
      rejectionReason: null,
      verifiedBy: 'system',
      verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    // Drop any previous auto-decision carry-forward since this is a fresh upload.
    await db.doc(`users/${userId}`).set(
      {
        avatarVerification: {
          ...pendingPayload,
          previousAutoDecision: admin.firestore.FieldValue.delete(),
          overrideNote: admin.firestore.FieldValue.delete(),
          errorCode: admin.firestore.FieldValue.delete(),
          errorMessage: admin.firestore.FieldValue.delete(),
        },
      },
      { merge: true },
    );

    logger.info('avatar_verification.started', {
      userId,
      urlHost: safeHost(afterAvatar),
    });

    const decision = await runAvatarVerification({ url: afterAvatar, userId });

    const finalRecord: Record<string, unknown> = {
      status: decision.status,
      sourceAvatarUrl: afterAvatar,
      qualitySignals: decision.qualitySignals,
      rejectionReason: decision.rejectionReason,
      verifiedBy: 'system',
      verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (decision.errorCode) finalRecord.errorCode = decision.errorCode;
    if (decision.errorMessage) finalRecord.errorMessage = decision.errorMessage;

    await db.doc(`users/${userId}`).set(
      {
        avatarVerification: finalRecord,
      },
      { merge: true },
    );

    logger.info('avatar_verification.completed', {
      userId,
      status: decision.status,
      rejectionReason: decision.rejectionReason,
      faceCount: decision.qualitySignals?.faceCount,
      faceAreaRatio: decision.qualitySignals?.faceAreaRatio,
    });
  },
);

function stringOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Log a URL host only (never the full URL with token) to keep logs privacy-safe. */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(unparseable)';
  }
}
