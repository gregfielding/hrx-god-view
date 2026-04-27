/**
 * Shared types + thresholds for avatar (headshot) verification.
 *
 * The verification record lives at `users/{userId}.avatarVerification` (nested object on the
 * user doc). Phase 1 writes it automatically via a Firestore trigger running Cloud Vision
 * face detection on every avatar change. Later phases read it to:
 *   - Show live quality feedback in the apply wizard (Phase 2)
 *   - Gate the Accept-shift flow for jobs that require a verified headshot (Phase 4)
 *   - Drive a recruiter approve/reject UI with reason-code-aware re-upload nudges (Phase 5)
 *
 * Keep this file free of runtime deps (no firebase-admin, no Cloud Vision SDK) so it can
 * be imported from client code and from other functions without forcing cold-start cost.
 */
import type { Timestamp, FieldValue } from 'firebase-admin/firestore';

/** Lifecycle status for the most recent avatar verification pass. */
export type AvatarVerificationStatus =
  /** Verification has been requested but not yet completed. */
  | 'pending'
  /** Automated checks passed, or a recruiter manually approved. */
  | 'approved'
  /** Automated checks failed, or a recruiter manually rejected. See rejectionReason. */
  | 'rejected'
  /** Verification could not be completed (network / Vision error). Eligible for retry. */
  | 'error';

/**
 * Why the photo was rejected. Ordered roughly by severity / how actionable the message is
 * — the verifier picks the single worst issue so the user gets one clear next step.
 */
export type AvatarRejectionReason =
  | 'no_face' // Vision did not detect any face.
  | 'multiple_faces' // More than one face detected (group photo, baby + adult, etc.).
  | 'face_too_small' // Face bounding box covers too little of the frame.
  | 'too_blurry' // Vision flagged blurredLikelihood >= POSSIBLE.
  | 'too_dark' // Vision flagged underExposedLikelihood >= POSSIBLE.
  | 'inappropriate' // Reserved for recruiter override / future SafeSearch integration.
  | 'manual_override' // Recruiter flipped an auto-approval to rejected.
  | 'verification_error'; // Transient failure (kept in sync with status='error').

/** Who decided the current status. `'system'` = automated Vision pass; otherwise a userId. */
export type AvatarVerifierActor = 'system' | string;

/**
 * Raw signals from Cloud Vision, preserved so a recruiter can see *why* the system decided
 * what it did and override rationally. Shape is deliberately narrow — we do not persist
 * biometric templates or landmark vectors (see BIPA / Illinois biometric privacy act).
 */
export interface AvatarQualitySignals {
  /** Number of faces detected. Should be 1 for an approved headshot. */
  faceCount: number;
  /**
   * Fraction of the image area occupied by the LARGEST detected face's bounding box.
   * Range 0..1. A typical good headshot is 0.15–0.45 depending on crop.
   */
  faceAreaRatio: number | null;
  /** Vision's detectionConfidence for the largest face. 0..1. */
  detectionConfidence: number | null;
  /** Vision Likelihood enum as returned (e.g. 'VERY_UNLIKELY' | 'UNLIKELY' | ... | 'VERY_LIKELY'). */
  blurredLikelihood: VisionLikelihood | null;
  /** Vision Likelihood enum for underexposure. */
  underExposedLikelihood: VisionLikelihood | null;
  /** Vision Likelihood enum for headwear — informational, not currently rejection-worthy. */
  headwearLikelihood: VisionLikelihood | null;
  /** Image pixel dimensions as read by sharp (used to compute faceAreaRatio). */
  imageWidthPx: number | null;
  imageHeightPx: number | null;
}

export type VisionLikelihood =
  | 'UNKNOWN'
  | 'VERY_UNLIKELY'
  | 'UNLIKELY'
  | 'POSSIBLE'
  | 'LIKELY'
  | 'VERY_LIKELY';

/** Numeric index for comparison (VERY_UNLIKELY=1 ... VERY_LIKELY=5; UNKNOWN=0). */
export const VISION_LIKELIHOOD_INDEX: Record<VisionLikelihood, number> = {
  UNKNOWN: 0,
  VERY_UNLIKELY: 1,
  UNLIKELY: 2,
  POSSIBLE: 3,
  LIKELY: 4,
  VERY_LIKELY: 5,
};

/**
 * Decision thresholds. Kept as exported constants so Phase 2+ UI can surface exactly what
 * the verifier is checking, and so tests / tuning live in one place. All values can be moved
 * behind a tenant config later if clients want to relax / tighten per their standards.
 *
 * STRICTNESS DIAL: tuned to ~5/10 — the goal is to catch obvious problems (no face, a group
 * photo, a fully-dark or heavily-blurred shot) without blocking a reasonably-composed phone
 * selfie. Recruiters retain a manual approve/reject override for edge cases (religious head
 * coverings, accessibility accommodations, etc.).
 */
export const AVATAR_VERIFICATION_THRESHOLDS = {
  /**
   * Face's bounding box must cover at least this fraction of the image. 0.05 allows people
   * to stand a step back from the camera — a typical arm's-length selfie lands ~0.15–0.4.
   */
  MIN_FACE_AREA_RATIO: 0.05,
  /**
   * Vision detectionConfidence floor for the largest face. 0.5 lets through photos Vision
   * is only moderately confident about (profile angles, partial shadow) rather than demanding
   * a textbook-clean frontal shot.
   */
  MIN_DETECTION_CONFIDENCE: 0.5,
  /**
   * Blurred/underexposed likelihoods are rejected when the Vision enum value is at or above
   * this index. 4 = 'LIKELY' — so only 'LIKELY' and 'VERY_LIKELY' reject. 'POSSIBLE' is a
   * false-positive magnet on phone cameras (slight motion, compression artifacts).
   */
  REJECT_AT_LIKELIHOOD_INDEX: VISION_LIKELIHOOD_INDEX.LIKELY,
  /**
   * A NON-primary face is treated as a real second person (→ multiple_faces rejection) only
   * when it clears BOTH of the thresholds below. Tuned conservatively (0.06 area + 0.85
   * confidence) to filter out Vision false positives on background clutter — posters,
   * patterned shirts, reflections, framed photos — which are the #1 source of spurious
   * multi-face rejections on real-world uploads.
   */
  SECONDARY_FACE_AREA_RATIO_MIN: 0.06,
  SECONDARY_FACE_DETECTION_CONFIDENCE_MIN: 0.85,
} as const;

/**
 * The persisted verification record on `users/{userId}.avatarVerification`.
 *
 * Note: `verifiedAt` / `updatedAt` are stored as Firestore Timestamps on disk but may be
 * written as FieldValue.serverTimestamp(). Clients reading this always see Timestamp.
 */
export interface AvatarVerification {
  /** Current lifecycle status. */
  status: AvatarVerificationStatus;
  /** The avatar URL this record was computed against — lets us detect stale metadata. */
  sourceAvatarUrl: string;
  /** Raw signals from Vision (null fields when not available / errored). */
  qualitySignals: AvatarQualitySignals | null;
  /** Populated when status === 'rejected' (or 'error'). */
  rejectionReason: AvatarRejectionReason | null;
  /** 'system' for automated decisions; userId for recruiter overrides. */
  verifiedBy: AvatarVerifierActor;
  /** When the current status was set. */
  verifiedAt: Timestamp | FieldValue;
  /** Bookkeeping — same as verifiedAt on first write; updated on override. */
  updatedAt: Timestamp | FieldValue;
  /**
   * When a recruiter flipped system→manual, carry forward the prior auto decision so we can
   * render a "recruiter overrode auto-rejection" badge. Dropped once the worker reuploads.
   */
  previousAutoDecision?: {
    status: AvatarVerificationStatus;
    rejectionReason: AvatarRejectionReason | null;
  };
  /**
   * Free-form note the recruiter can leave when overriding ("blurry but it's the best he can do
   * given site lighting — flagged for Operations"). Capped to a few hundred chars by callers.
   */
  overrideNote?: string;
  /**
   * Short machine-readable error code when status === 'error' (network, Vision quota, etc.).
   * Human-readable message lives in `errorMessage`. Never surface `errorMessage` raw to workers.
   */
  errorCode?: string;
  errorMessage?: string;
}
