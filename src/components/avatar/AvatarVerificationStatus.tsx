/**
 * Renders the user-facing (or recruiter-facing) state of `users/{uid}.avatarVerification`:
 * pending spinner, green "looks good" chip, amber/red retake prompt, or a soft "couldn't
 * check" retry affordance. Worker-facing copy is translated via `useT()` and honors the
 * current UI language (English / Spanish) — keep the `avatarVerification.*` keys in
 * `public/i18n/locales/{en,es}.json` in sync with the rejection reason enum.
 *
 * Designed as a small, drop-in widget for:
 *   - the apply wizard's ProfilePictureStep (post-upload feedback)
 *   - the UserProfile header (post-avatar-change feedback for both the worker and for
 *     recruiters editing a worker's headshot)
 *
 * The component is stateless — it does not subscribe to Firestore itself. Callers pair it
 * with `useAvatarVerification(userId)` from `../../hooks/useAvatarVerification`.
 */
import React from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ReplayIcon from '@mui/icons-material/Replay';

import { useT } from '../../i18n';
import type {
  AvatarRejectionReason,
  AvatarVerification,
} from '../../types/avatarVerification';

export interface AvatarVerificationStatusProps {
  /** The verification record. Null means no record yet (never uploaded, or doc missing). */
  verification: AvatarVerification | null;
  /** True while the trigger is still running (fresh upload) or the Firestore record is stale. */
  isPending?: boolean;
  /** True while the initial Firestore snapshot is loading. Suppresses "no record" UI. */
  loading?: boolean;
  /**
   * Called when the user clicks the retake / retry CTA. Parent is responsible for launching
   * whatever photo-picker flow is appropriate (file input, camera modal, etc.).
   */
  onRetake?: () => void;
  /**
   * When true, the "approved" state renders a compact green check + short label. When false
   * (default), approved renders a small success alert. Use compact in tight spots like a
   * card header where we just need a badge, not a banner.
   */
  compact?: boolean;
  /**
   * Worker-facing copy assumes the viewer is the subject, and is translated via the user's
   * UI language. Recruiter-facing mode swaps to third-person English copy (recruiter portal
   * is English-only, so we intentionally do NOT route recruiter strings through `useT()`).
   */
  audience?: 'worker' | 'recruiter';
}

/** Recruiter-view versions of the retry copy. Mirrors `AvatarRejectionReason` exactly. */
const RECRUITER_REJECTION_COPY: Record<AvatarRejectionReason, string> = {
  no_face: 'No face detected in the photo — a retake is needed.',
  multiple_faces: 'More than one person is in the photo — a solo retake is needed.',
  face_too_small: 'Face is too small in the frame — ask the worker to hold the camera closer.',
  too_blurry: 'Photo is blurry — ask the worker to retake with a steady hand in good light.',
  too_dark: 'Photo is underexposed — ask the worker to retake in better lighting.',
  inappropriate: 'Photo was flagged for review — a professional headshot is needed.',
  manual_override: 'A recruiter previously asked for a new headshot.',
  verification_error: 'Photo check could not complete — ask the worker to re-upload.',
};

const RECRUITER_RETAKE_LABEL = 'Request new photo';
const RECRUITER_ERROR_COPY = "Photo check couldn't complete. Ask the worker to re-upload or try again.";

/**
 * Small status chip for the `compact` approved state — avoids taking vertical space in
 * tight surfaces like a profile header.
 */
const ApprovedChip: React.FC<{ label: string }> = ({ label }) => (
  <Stack direction="row" spacing={0.5} alignItems="center">
    <CheckCircleIcon fontSize="small" color="success" />
    <Typography variant="caption" color="success.main" fontWeight={600}>
      {label}
    </Typography>
  </Stack>
);

const PendingChip: React.FC<{ compact: boolean; compactLabel: string; fullLabel: string }> = ({
  compact,
  compactLabel,
  fullLabel,
}) => {
  if (compact) {
    return (
      <Stack direction="row" spacing={0.75} alignItems="center">
        <CircularProgress size={14} thickness={5} />
        <Typography variant="caption" color="text.secondary">
          {compactLabel}
        </Typography>
      </Stack>
    );
  }
  return (
    <Alert severity="info" icon={<CircularProgress size={18} thickness={5} />}>
      <Typography variant="body2">{fullLabel}</Typography>
    </Alert>
  );
};

const AvatarVerificationStatus: React.FC<AvatarVerificationStatusProps> = ({
  verification,
  isPending = false,
  loading = false,
  onRetake,
  compact = false,
  audience = 'worker',
}) => {
  const t = useT();

  // Pre-compute worker-facing strings once per render. These are the only ones that need
  // translation — recruiter strings are hardcoded English above since the recruiter portal
  // is English-only.
  const verifiedBadgeLabel = t('avatarVerification.verifiedBadge');
  const compactLabel = t('avatarVerification.checkingCompact');
  const fullLabel = t('avatarVerification.checkingFull');
  const approvedAlertLabel = t('avatarVerification.approvedAlert');
  const retakeLabel =
    audience === 'recruiter' ? RECRUITER_RETAKE_LABEL : t('avatarVerification.retakeButton');
  const tryAgainLabel = t('avatarVerification.tryAgainButton');
  const workerErrorCopy = t('avatarVerification.errorRetry');

  const rejectionCopyFor = (reason: AvatarRejectionReason): string => {
    if (audience === 'recruiter') {
      return RECRUITER_REJECTION_COPY[reason] ?? RECRUITER_REJECTION_COPY.verification_error;
    }
    return t(`avatarVerification.rejection.${reason}`);
  };

  // Nothing to show while the initial snapshot is in flight.
  if (loading) return null;

  // Fresh upload mid-verification — take precedence over any prior record.
  if (isPending) return <PendingChip compact={compact} compactLabel={compactLabel} fullLabel={fullLabel} />;

  if (!verification) return null;

  if (verification.status === 'approved') {
    if (compact) return <ApprovedChip label={verifiedBadgeLabel} />;
    return (
      <Alert severity="success" variant="outlined">
        {approvedAlertLabel}
      </Alert>
    );
  }

  if (verification.status === 'pending') {
    // Rare — we normally short-circuit this via `isPending`, but handle it for safety.
    return <PendingChip compact={compact} compactLabel={compactLabel} fullLabel={fullLabel} />;
  }

  if (verification.status === 'rejected') {
    const reason = verification.rejectionReason ?? 'verification_error';
    const copy = rejectionCopyFor(reason);

    return (
      <Alert
        severity="warning"
        action={
          onRetake ? (
            <Button
              color="inherit"
              size="small"
              startIcon={<ReplayIcon />}
              onClick={onRetake}
            >
              {retakeLabel}
            </Button>
          ) : undefined
        }
      >
        <Box>
          <Typography variant="body2">{copy}</Typography>
        </Box>
      </Alert>
    );
  }

  // 'error' — network/Vision hiccup, eligible for retry.
  return (
    <Alert
      severity="info"
      action={
        onRetake ? (
          <Button color="inherit" size="small" startIcon={<ReplayIcon />} onClick={onRetake}>
            {audience === 'recruiter' ? 'Try again' : tryAgainLabel}
          </Button>
        ) : undefined
      }
    >
      <Typography variant="body2">
        {audience === 'recruiter' ? RECRUITER_ERROR_COPY : workerErrorCopy}
      </Typography>
    </Alert>
  );
};

export default AvatarVerificationStatus;
