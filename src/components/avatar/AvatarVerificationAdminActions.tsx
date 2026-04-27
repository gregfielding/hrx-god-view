/**
 * Recruiter / Manager / Admin action menu for `users/{uid}.avatarVerification`. Rendered
 * next to `AvatarVerificationStatus` on the UserProfileHeader when the viewer is not the
 * subject of the profile.
 *
 * Actions:
 *   - Approve              → calls `setAvatarVerificationDecision({ decision: 'approve' })`
 *   - Reject               → calls `setAvatarVerificationDecision({ decision: 'reject' })`
 *   - Request new photo    → calls `setAvatarVerificationDecision({ decision: 'request_reupload' })`
 *                            which ALSO fires an in-app notification + SMS (respecting the
 *                            worker's opt-in + quiet hours via the existing pipeline).
 *
 * The component is deliberately small — it only owns the button + confirm dialog. The
 * subscription to `users/{uid}.avatarVerification` lives in the parent via
 * `useAvatarVerification`, so once the callable succeeds the parent auto-refreshes the pill.
 */
import React, { useState } from 'react';
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';
import type { AvatarVerification } from '../../types/avatarVerification';

type AdminDecision = 'approve' | 'reject' | 'request_reupload';

export interface AvatarVerificationAdminActionsProps {
  /** The worker whose `users/{uid}.avatarVerification` we're editing. */
  targetUserId: string;
  /** Current verification record — drives which options are enabled. */
  verification: AvatarVerification | null;
  /** Viewer can only see this widget when they have Manager/Admin rights (parent gates). */
  disabled?: boolean;
  /** Called after a successful callable run — lets the parent refresh dependent UI. */
  onDecisionApplied?: (decision: AdminDecision) => void;
}

interface DialogState {
  open: boolean;
  decision: AdminDecision | null;
  note: string;
}

const INITIAL_DIALOG: DialogState = { open: false, decision: null, note: '' };
const NOTE_MAX = 500;

const setAvatarVerificationDecisionCallable = httpsCallable<
  {
    userId: string;
    decision: AdminDecision;
    overrideNote?: string;
  },
  {
    status: 'approved' | 'rejected';
    rejectionReason: string | null;
    verifiedBy: string;
    nudge?: { inAppCreated: boolean; smsQueued: boolean; smsSkipReason?: string };
  }
>(functions, 'setAvatarVerificationDecision');

/** Copy for the trigger button + menu items. Recruiter portal is English-only. */
const COPY = {
  trigger: 'Manage photo',
  approve: 'Approve photo',
  reject: 'Reject photo',
  requestReupload: 'Request new photo',
  dialogTitle: {
    approve: 'Approve this headshot?',
    reject: 'Reject this headshot?',
    request_reupload: 'Request a new photo from this worker?',
  } satisfies Record<AdminDecision, string>,
  dialogBody: {
    approve:
      "This will mark the worker's photo as approved and allow them to accept shifts immediately.",
    reject:
      "This will mark the photo as rejected without notifying the worker. They won't be able to accept shifts until a new photo is approved.",
    request_reupload:
      "This will flag the current photo for replacement AND send the worker an in-app notification plus an SMS (if they've opted in and it's outside quiet hours) asking them to retake it.",
  } satisfies Record<AdminDecision, string>,
  noteLabel: 'Note (optional — visible to other recruiters)',
  cancel: 'Cancel',
  confirm: {
    approve: 'Approve',
    reject: 'Reject',
    request_reupload: 'Request & notify',
  } satisfies Record<AdminDecision, string>,
  nudgeSuccess: 'Worker notified.',
  nudgeSuccessSmsSkipped: 'Worker notified in-app. SMS was skipped ({reason}).',
  genericError: 'Could not update the photo status. Please try again.',
};

const AvatarVerificationAdminActions: React.FC<AvatarVerificationAdminActionsProps> = ({
  targetUserId,
  verification,
  disabled = false,
  onDecisionApplied,
}) => {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<DialogState>(INITIAL_DIALOG);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );

  const currentStatus = verification?.status ?? null;
  const menuOpen = Boolean(menuAnchor);

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>) => setMenuAnchor(e.currentTarget);
  const closeMenu = () => setMenuAnchor(null);

  const pick = (decision: AdminDecision) => {
    closeMenu();
    setFeedback(null);
    setDialog({ open: true, decision, note: '' });
  };

  const closeDialog = () => {
    if (submitting) return;
    setDialog(INITIAL_DIALOG);
  };

  const submitDialog = async () => {
    if (!dialog.decision) return;
    setSubmitting(true);
    try {
      const res = await setAvatarVerificationDecisionCallable({
        userId: targetUserId,
        decision: dialog.decision,
        overrideNote: dialog.note.trim() || undefined,
      });
      onDecisionApplied?.(dialog.decision);

      if (dialog.decision === 'request_reupload') {
        const nudge = res.data?.nudge;
        if (nudge?.smsQueued) {
          setFeedback({ kind: 'success', text: COPY.nudgeSuccess });
        } else if (nudge?.inAppCreated) {
          setFeedback({
            kind: 'success',
            text: COPY.nudgeSuccessSmsSkipped.replace(
              '{reason}',
              humanizeSmsSkipReason(nudge.smsSkipReason),
            ),
          });
        } else {
          // Neither channel went out — the Firestore flip still succeeded, so flag it as a
          // soft warning rather than a hard error.
          setFeedback({
            kind: 'success',
            text: 'Photo status updated. The worker nudge could not be sent.',
          });
        }
      }

      setDialog(INITIAL_DIALOG);
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: string }).message)
          : COPY.genericError;
      setFeedback({ kind: 'error', text: msg });
    } finally {
      setSubmitting(false);
    }
  };

  // Approve is only meaningful when the current status is not already approved. Reject is
  // only meaningful when the worker HAS a record (otherwise there's nothing to reject).
  // Request-reupload is always available — it's the "nag + fix" shortcut.
  const canApprove = currentStatus !== 'approved';
  const canReject = currentStatus === 'approved';

  return (
    <Stack spacing={0.5} alignItems="flex-start">
      <Button
        size="small"
        variant="outlined"
        onClick={openMenu}
        disabled={disabled || submitting}
        endIcon={<ArrowDropDownIcon />}
      >
        {COPY.trigger}
      </Button>
      <Menu anchorEl={menuAnchor} open={menuOpen} onClose={closeMenu}>
        {canApprove ? <MenuItem onClick={() => pick('approve')}>{COPY.approve}</MenuItem> : null}
        {canReject ? <MenuItem onClick={() => pick('reject')}>{COPY.reject}</MenuItem> : null}
        <MenuItem onClick={() => pick('request_reupload')}>{COPY.requestReupload}</MenuItem>
      </Menu>

      {feedback ? (
        <Typography
          variant="caption"
          color={feedback.kind === 'error' ? 'error.main' : 'success.main'}
          sx={{ fontWeight: 500 }}
        >
          {feedback.text}
        </Typography>
      ) : null}

      <Dialog open={dialog.open} onClose={closeDialog} fullWidth maxWidth="xs">
        <DialogTitle>
          {dialog.decision ? COPY.dialogTitle[dialog.decision] : ''}
        </DialogTitle>
        <DialogContent>
          {dialog.decision ? (
            <DialogContentText sx={{ mb: 2 }}>
              {COPY.dialogBody[dialog.decision]}
            </DialogContentText>
          ) : null}
          <TextField
            label={COPY.noteLabel}
            value={dialog.note}
            onChange={(e) =>
              setDialog((prev) => ({ ...prev, note: e.target.value.slice(0, NOTE_MAX) }))
            }
            fullWidth
            multiline
            minRows={2}
            inputProps={{ maxLength: NOTE_MAX }}
            helperText={`${dialog.note.length}/${NOTE_MAX}`}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={submitting}>
            {COPY.cancel}
          </Button>
          <Button
            onClick={submitDialog}
            variant="contained"
            disabled={submitting || !dialog.decision}
            startIcon={submitting ? <CircularProgress size={16} thickness={5} /> : undefined}
          >
            {dialog.decision ? COPY.confirm[dialog.decision] : ''}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};

function humanizeSmsSkipReason(reason: string | undefined): string {
  switch (reason) {
    case 'worker_has_not_opted_in_to_sms':
      return 'worker not opted in';
    case 'no_phone_on_record':
      return 'no phone on file';
    case 'no_tenant_for_sms':
      return 'no tenant for SMS';
    case 'sms_enqueue_error':
      return 'carrier queue error';
    default:
      return reason ?? 'unknown';
  }
}

export default AvatarVerificationAdminActions;
