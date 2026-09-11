/**
 * Worker-self Accept-shift headshot gate.
 *
 * **Scope:** only the worker-self-accept path (`placementsApi.respondToAssignment`
 * with decision='accept') routes through this gate. The recruiter-acting-on-behalf
 * path (`placementsApi.confirmAssignmentForWorker`) intentionally does not — the
 * recruiter clicking "Confirm" is itself the human override.
 *
 * **Policy (re-armed 2026-09-06, Greg: "make the headshot gate real"):**
 *
 *   | worker doc state                                             | result |
 *   |--------------------------------------------------------------|--------|
 *   | no photo anywhere (avatar / workerProfile.photoUrl / photoUrl)| BLOCK `HEADSHOT_MISSING` |
 *   | Vision or recruiter rejected the CURRENT photo for a          | BLOCK `HEADSHOT_REJECTED` |
 *   |   blocking reason (no_face, multiple_faces, inappropriate,   |        |
 *   |   manual_override)                                           |        |
 *   | rejected for a quality reason (face_too_small, too_blurry,   | allow (nudge lives on Home + profile) |
 *   |   too_dark)                                                  |        |
 *   | approved                                                     | allow  |
 *   | pending / error / no record / record for an older photo      | allow  |
 *
 * History, so nobody re-learns it:
 *   - Phase 4 (spring 2026) required `status === 'approved'`. Vision false
 *     positives left legit workers stuck on pending/error and blocked their
 *     shifts → relaxed 2026-04-24 (`c6ea0fb4`) to "any avatar passes".
 *   - Even the relaxed gate was pulled from the Accept path 2026-06-07 because
 *     the SMS one-click link surfaced a bare error with no way to add a photo,
 *     so workers gave up. The web accept page now renders an inline uploader
 *     (`HeadshotGateCard`) and the app shows the headshot bottom sheet, which
 *     is what makes re-arming safe.
 *   - The rule above never blocks on OUR pipeline (pending/error/unverified
 *     always pass); it blocks on the worker's photo being absent or plainly
 *     not a headshot. Data at re-arm time: 5,246 C1 photos, 92% approved,
 *     8% rejected (185 face_too_small, 126 no_face, 16 multiple_faces,
 *     11 too_dark, 1 too_blurry), 924 never verified (backfilled same day).
 *
 * When the gate fails we throw a typed `HttpsError('failed-precondition', ...)`
 * carrying a stable `code` in `details` so both clients can swap in the right UX
 * (retake-camera CTA, "still processing" copy, or "recruiter will review").
 * Phase 5 recruiter manual-approve (`avatarVerification.status = 'approved'`)
 * remains the pressure-release valve.
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
  /** Verification is still running (fresh upload, trigger hasn't finished). Not thrown under the current policy; kept for client compatibility. */
  | 'HEADSHOT_PENDING'
  /** Most recent verification pass rejected the photo for a blocking reason. */
  | 'HEADSHOT_REJECTED'
  /** Vision/network error on the verification pass. Not thrown under the current policy; kept for client compatibility. */
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
 * Rejection reasons that mean "this is not a usable headshot of one person" and
 * therefore block self-accept. Quality reasons (face_too_small, too_blurry,
 * too_dark) do not block — the photo still identifies the worker on site.
 */
export const HEADSHOT_BLOCKING_REJECTION_REASONS: ReadonlySet<AvatarRejectionReason> = new Set<AvatarRejectionReason>([
  'no_face',
  'multiple_faces',
  'inappropriate',
  'manual_override',
]);

/**
 * Shape of what we read off the user doc. Narrow so this module doesn't bind to the full
 * `users/{uid}` schema. Every field a worker photo can live under is listed — see
 * docs/claude/project_worker_profile_photo.md.
 */
export interface UserDocHeadshotFields {
  avatar?: string | null;
  photoUrl?: string | null;
  workerProfile?: { photoUrl?: string | null } | null;
  /** Literal dotted key that setDoc({merge:true}) once stamped on older docs. */
  'workerProfile.photoUrl'?: string | null;
  avatarVerification?: Partial<AvatarVerification> | null;
}

export type HeadshotGateAllowReason =
  | 'approved'
  | 'pending'
  | 'error'
  | 'unverified'
  | 'stale_record'
  | 'quality_rejection'
  | 'grace_period';

export type HeadshotGateDecision =
  | { allow: true; reason: HeadshotGateAllowReason }
  | { allow: false; details: HeadshotGateBlockedDetails };

/**
 * Grace period (Greg 2026-09-06): workers who have ALREADY WORKED for us
 * (any prior confirmed / active / ended assignment) keep self-accepting
 * without a photo until this date, so re-arming the gate doesn't stall the
 * 54 of 121 active-crew members who had no photo the day it went live. The
 * Home nudge and the accept-page uploader still ask them for one. Brand-new
 * workers and not-a-headshot rejections get no grace. After this date the
 * clause is dead code — delete it.
 */
export const HEADSHOT_GATE_GRACE_ENDS_AT_MS = Date.UTC(2026, 8, 21); // 2026-09-21T00:00:00Z

export interface HeadshotGateContext {
  /** Worker has at least one prior confirmed/active/ended assignment. */
  hasWorkedBefore?: boolean;
  /** Injectable clock for tests. */
  nowMs?: number;
}

export function isHeadshotGateGraceActive(nowMs: number = Date.now()): boolean {
  return nowMs < HEADSHOT_GATE_GRACE_ENDS_AT_MS;
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** First non-empty photo URL in write-precedence order (`avatar` is what the verifier keys on). */
export function readWorkerPhotoUrl(data: UserDocHeadshotFields | null | undefined): string {
  if (!data) return '';
  const candidates = [
    data.avatar,
    data.workerProfile?.photoUrl,
    data.photoUrl,
    data['workerProfile.photoUrl'],
  ];
  for (const c of candidates) if (nonEmpty(c)) return c.trim();
  return '';
}

/** Pure policy — no I/O. Exported for tests and for surfaces that want to pre-check. */
export function evaluateHeadshotGate(
  data: UserDocHeadshotFields | null | undefined,
  ctx: HeadshotGateContext = {},
): HeadshotGateDecision {
  const photo = readWorkerPhotoUrl(data);
  if (!photo) {
    if (ctx.hasWorkedBefore === true && isHeadshotGateGraceActive(ctx.nowMs)) {
      return { allow: true, reason: 'grace_period' };
    }
    return {
      allow: false,
      details: { code: 'HEADSHOT_MISSING', status: 'missing', rejectionReason: null },
    };
  }

  const verification = data?.avatarVerification ?? null;
  const status = (verification?.status ?? null) as AvatarVerificationStatus | null;
  if (!verification || !status) return { allow: true, reason: 'unverified' };

  // The verifier records which URL it judged. If the worker has since changed
  // their photo (or the record predates a different field), the verdict is for
  // an older image and must not block the current one.
  const judged = nonEmpty(verification.sourceAvatarUrl) ? verification.sourceAvatarUrl.trim() : '';
  const currentAvatar = nonEmpty(data?.avatar) ? data!.avatar!.trim() : photo;
  if (judged && judged !== currentAvatar && judged !== photo) {
    return { allow: true, reason: 'stale_record' };
  }

  if (status === 'approved') return { allow: true, reason: 'approved' };
  if (status === 'pending') return { allow: true, reason: 'pending' };
  if (status === 'error') return { allow: true, reason: 'error' };

  // status === 'rejected'
  const rejectionReason = (verification.rejectionReason ?? null) as AvatarRejectionReason | null;
  if (rejectionReason && !HEADSHOT_BLOCKING_REJECTION_REASONS.has(rejectionReason)) {
    return { allow: true, reason: 'quality_rejection' };
  }
  return {
    allow: false,
    details: { code: 'HEADSHOT_REJECTED', status: 'rejected', rejectionReason },
  };
}

/**
 * Throws `HttpsError('failed-precondition', ...)` when the worker's headshot state blocks
 * self-accept. Otherwise returns silently.
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
  opts: { tenantId?: string } = {},
): Promise<void> {
  const data = userDocData !== undefined ? userDocData : await loadUserDoc(workerUid);
  let decision = evaluateHeadshotGate(data);

  // Grace lookup only when it can change the answer: the photo is missing,
  // the grace window is open, and we know which tenant's assignments to
  // check. One indexed query, limit 1.
  if (
    decision.allow === false &&
    decision.details.code === 'HEADSHOT_MISSING' &&
    isHeadshotGateGraceActive() &&
    opts.tenantId
  ) {
    const hasWorkedBefore = await workerHasWorkedBefore(opts.tenantId, workerUid);
    decision = evaluateHeadshotGate(data, { hasWorkedBefore });
  }

  if (decision.allow === true) {
    if (decision.reason !== 'approved') {
      logger.info('Accept-shift headshot gate: allowed without approval', {
        workerUid,
        reason: decision.reason,
      });
    }
    return;
  }

  const { details } = decision;
  logger.info('Accept-shift blocked: headshot not acceptable', {
    workerUid,
    code: details.code,
    status: details.status,
    rejectionReason: details.rejectionReason,
  });

  // Stable, human-readable English fallback — the client maps `details.code` to localized
  // copy (see `public/i18n/locales/{en,es}.json > avatarVerification.*`). Keep the server
  // message short; it's only seen when the client can't / doesn't translate.
  throw new HttpsError('failed-precondition', englishFallbackMessage(details.code), details);
}

/** True when the worker has any prior assignment that reached confirmed / active / ended. */
export async function workerHasWorkedBefore(tenantId: string, workerUid: string): Promise<boolean> {
  try {
    const db = admin.firestore();
    const snap = await db
      .collection(`tenants/${tenantId}/assignments`)
      .where('userId', '==', workerUid)
      .where('status', 'in', ['confirmed', 'active', 'ended', 'completed'])
      .limit(1)
      .get();
    return !snap.empty;
  } catch (err) {
    // A failed lookup must not turn into a false block during the grace window.
    logger.warn('headshot gate: prior-assignment lookup failed — treating as worked before', {
      workerUid,
      tenantId,
      error: (err as Error)?.message || String(err),
    });
    return true;
  }
}

async function loadUserDoc(workerUid: string): Promise<UserDocHeadshotFields | null> {
  const db = admin.firestore();
  const snap = await db.doc(`users/${workerUid}`).get();
  if (!snap.exists) return null;
  return (snap.data() as UserDocHeadshotFields) ?? null;
}

function englishFallbackMessage(code: HeadshotGateErrorCode): string {
  switch (code) {
    case 'HEADSHOT_MISSING':
      return 'A profile photo is required before you can accept a shift. Please add a photo of your face.';
    case 'HEADSHOT_PENDING':
      return "We're still checking your photo. Please try again in a moment.";
    case 'HEADSHOT_REJECTED':
      return 'Your profile photo was not approved. Please retake it before accepting this shift.';
    case 'HEADSHOT_ERROR':
    default:
      return "We couldn't verify your photo. Please try uploading it again, then accept the shift.";
  }
}
