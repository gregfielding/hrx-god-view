/**
 * Client-side mirror of the Functions-side AvatarVerification types. Kept in sync with
 * `functions/src/avatar/avatarVerificationTypes.ts` — treat them as one contract and update
 * both together.
 *
 * The verification object lives at `users/{userId}.avatarVerification`, written automatically
 * by the `onUserAvatarChangedVerify` Cloud Function whenever `users/{userId}.avatar` changes.
 * UI (Phase 2+) reads this record to show status / quality feedback / recruiter controls.
 */

export type AvatarVerificationStatus = 'pending' | 'approved' | 'rejected' | 'error';

export type AvatarRejectionReason =
  | 'no_face'
  | 'multiple_faces'
  | 'face_too_small'
  | 'too_blurry'
  | 'too_dark'
  | 'inappropriate'
  | 'manual_override'
  | 'verification_error';

export type VisionLikelihood =
  | 'UNKNOWN'
  | 'VERY_UNLIKELY'
  | 'UNLIKELY'
  | 'POSSIBLE'
  | 'LIKELY'
  | 'VERY_LIKELY';

export interface AvatarQualitySignals {
  faceCount: number;
  faceAreaRatio: number | null;
  detectionConfidence: number | null;
  blurredLikelihood: VisionLikelihood | null;
  underExposedLikelihood: VisionLikelihood | null;
  headwearLikelihood: VisionLikelihood | null;
  imageWidthPx: number | null;
  imageHeightPx: number | null;
}

export interface AvatarVerification {
  status: AvatarVerificationStatus;
  sourceAvatarUrl: string;
  qualitySignals: AvatarQualitySignals | null;
  rejectionReason: AvatarRejectionReason | null;
  /** 'system' for automated; userId (string) for recruiter overrides. */
  verifiedBy: 'system' | string;
  /** Firestore Timestamp on read; omit type dependency to keep this file framework-free. */
  verifiedAt: unknown;
  updatedAt: unknown;
  previousAutoDecision?: {
    status: AvatarVerificationStatus;
    rejectionReason: AvatarRejectionReason | null;
  };
  overrideNote?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * @deprecated Worker-facing copy is now translated via i18n (`avatarVerification.rejection.*`
 * in `public/i18n/locales/{en,es}.json`). Kept as an English-only fallback for non-React
 * callers (e.g. SMS templates that run server-side in the recruiter's locale). UI components
 * should use `useT()` from `src/i18n` instead.
 */
export const AVATAR_REJECTION_COPY: Record<AvatarRejectionReason, string> = {
  no_face: "We couldn't find a face in your photo. Please retake with your face clearly visible.",
  multiple_faces:
    'Your photo shows more than one person. Please retake with just you in the frame.',
  face_too_small:
    'Your face is too small in the frame. Hold the camera closer so your face fills most of the photo.',
  too_blurry:
    'Your photo looks blurry. Please retake with a steady hand in good light.',
  too_dark:
    'Your photo is too dark. Please retake in better lighting — natural daylight works best.',
  inappropriate:
    'Your photo was flagged for review. Please upload a clear, professional headshot.',
  manual_override:
    'A recruiter asked you to reupload your photo. Please take a new, clear headshot.',
  verification_error:
    "We couldn't check your photo right now. Please try uploading again in a moment.",
};
