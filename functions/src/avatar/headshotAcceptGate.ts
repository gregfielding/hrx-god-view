/**
 * Universal Accept-shift gate: every worker, every job, must have an auto-verified headshot
 * (`users/{uid}.avatarVerification.status === 'approved'`) before an assignment can flip to
 * `confirmed`. Called from:
 *   - `placementsApi.respondToAssignment` when decision === 'accept'
 *   - `placementsApi.confirmAssignmentForWorker` (recruiter-acting-on-behalf-of-worker path)
 *
 * When the gate fails, we throw a typed `HttpsError('failed-precondition', ...)` carrying a
 * stable `code` string in the details payload so the worker app can swap in the right UX
 * (retake-camera CTA, "still processing" spinner, or "recruiter will review" copy).
 *
 * Phase 5 recruiter manual-approve is the pressure-release valve for accommodation edge
 * cases — a recruiter can flip any worker's status to 'approved' via the admin UI, which
 * immediately unblocks this gate. That's why we treat `status === 'approved'` as the single
 * source of truth rather than re-running Vision here.
 */
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import type {
  AvatarRejectionReason,
  AvatarVerification,
  AvatarVerificationStatus,
} from './avatarVerificationTypes';

/** Stable machine-readable codes surfaced in HttpsError `details.code`. */
export type HeadshotGateErrorCode =
  /** User has never uploaded a photo (no avatar, no verification record at all). */
  | 'HEADSHOT_MISSING'
  /** Verification is still running (fresh upload, trigger hasn't finished). */
  | 'HEADSHOT_PENDING'
  /** Most recent verification pass rejected the photo. */
  | 'HEADSHOT_REJECTED'
  /** Vision/network error on the verification pass — worker should retry upload. */
  | 'HEADSHOT_ERROR';

/** Payload we pack into `HttpsError` details when the gate fails. */
export interface HeadshotGateBlockedDetails {
  code: HeadshotGateErrorCode;
  /** Current verification status, or 'missing' when there is no record yet. */
  status: AvatarVerificationStatus | 'missing';
  /** Rejection reason if status === 'rejected' (lets the worker app pick localized copy). */
  rejectionReason: AvatarRejectionReason | null;
}

/**
 * Shape of what we read off the user doc. Narrow so this module doesn't bind to the full
 * `users/{uid}` schema.
 */
interface UserDocHeadshotFields {
  avatar?: string | null;
  avatarVerification?: Partial<AvatarVerification> | null;
}

/**
 * Throws `HttpsError('failed-precondition', ...)` when the worker doesn't have an approved
 * headshot. Otherwise returns silently.
 *
 * Accepts an already-loaded user doc snapshot to avoid a duplicate Firestore read when the
 * caller already fetched the user doc for other reasons. Pass `undefined` to have this
 * function do the read itself.
 *
 * @param workerUid     uid of the worker whose assignment is being accepted
 * @param userDocData   optional pre-fetched `users/{uid}` data; undefined → this fn reads it
 */
export async function assertWorkerHeadshotApproved(
  workerUid: string,
  userDocData?: UserDocHeadshotFields | null,
): Promise<void> {
  const data =
    userDocData !== undefined
      ? userDocData
      : await loadUserDoc(workerUid);

  const verification = data?.avatarVerification ?? null;
  const status = (verification?.status ?? null) as AvatarVerificationStatus | null;

  if (status === 'approved') return;

  const details = buildBlockedDetails(data, verification, status);
  logger.info('Accept-shift blocked: headshot not approved', {
    workerUid,
    code: details.code,
    status: details.status,
    rejectionReason: details.rejectionReason,
  });

  // Stable, human-readable English fallback — the client maps `details.code` to localized
  // copy (see `public/i18n/locales/{en,es}.json > avatarVerification.*`). Keep the server
  // message short; it's only seen when the client can't / doesn't translate.
  throw new HttpsError(
    'failed-precondition',
    englishFallbackMessage(details.code),
    details,
  );
}

async function loadUserDoc(workerUid: string): Promise<UserDocHeadshotFields | null> {
  const db = admin.firestore();
  const snap = await db.doc(`users/${workerUid}`).get();
  if (!snap.exists) return null;
  return (snap.data() as UserDocHeadshotFields) ?? null;
}

function buildBlockedDetails(
  data: UserDocHeadshotFields | null | undefined,
  verification: Partial<AvatarVerification> | null | undefined,
  status: AvatarVerificationStatus | null,
): HeadshotGateBlockedDetails {
  // No avatar OR no verification record at all → treat as missing, not rejected.
  const hasAvatar = typeof data?.avatar === 'string' && data.avatar.length > 0;
  if (!verification || status == null) {
    return {
      code: hasAvatar ? 'HEADSHOT_PENDING' : 'HEADSHOT_MISSING',
      status: 'missing',
      rejectionReason: null,
    };
  }

  if (status === 'pending') {
    return { code: 'HEADSHOT_PENDING', status: 'pending', rejectionReason: null };
  }

  if (status === 'rejected') {
    return {
      code: 'HEADSHOT_REJECTED',
      status: 'rejected',
      rejectionReason: (verification.rejectionReason ?? null) as AvatarRejectionReason | null,
    };
  }

  // status === 'error' (or any unexpected value we want to treat as a retryable hiccup).
  return {
    code: 'HEADSHOT_ERROR',
    status: 'error',
    rejectionReason: null,
  };
}

function englishFallbackMessage(code: HeadshotGateErrorCode): string {
  switch (code) {
    case 'HEADSHOT_MISSING':
      return 'A verified headshot is required before you can accept a shift. Please upload a photo of your face.';
    case 'HEADSHOT_PENDING':
      return "We're still checking your photo. Please try again in a moment.";
    case 'HEADSHOT_REJECTED':
      return 'Your most recent photo was not approved. Please retake it before accepting this shift.';
    case 'HEADSHOT_ERROR':
    default:
      return "We couldn't verify your photo. Please try uploading it again, then accept the shift.";
  }
}
