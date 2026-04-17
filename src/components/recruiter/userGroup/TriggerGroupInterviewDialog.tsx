import React, { useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../firebase';

type TriggerResult = {
  sent?: number;
  failed?: number;
  skipped?: number;
  totalMembers?: number;
  candidatesConsidered?: number;
  truncated?: boolean;
  eligibleQueuedForSend?: number;
};

export type TriggerGroupInterviewDialogProps = {
  open: boolean;
  onClose: () => void;
  tenantId: string | undefined;
  groupId: string;
  groupTitle?: string;
};

export function TriggerGroupInterviewDialog({
  open,
  onClose,
  tenantId,
  groupId,
  groupTitle,
}: TriggerGroupInterviewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TriggerResult | null>(null);

  const handleConfirm = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const fn = httpsCallable(functions, 'triggerUserGroupInterviewInvites');
      const res = await fn({ tenantId, groupId });
      setResult((res.data as TriggerResult) || null);
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message?: string }).message)
          : 'Request failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;
    setResult(null);
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Invite group to interview</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This will invite all users in this group who have not completed an interview.
        </Typography>
        {groupTitle ? (
          <Typography variant="body2" sx={{ mb: 1 }}>
            Group: <strong>{groupTitle}</strong>
          </Typography>
        ) : null}
        {error ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        ) : null}
        {result ? (
          <Alert severity="success" sx={{ mt: 1 }}>
            <Typography variant="body2" component="span" display="block">
              Sent: <strong>{result.sent ?? 0}</strong>, failed: <strong>{result.failed ?? 0}</strong>, skipped:{' '}
              <strong>{result.skipped ?? 0}</strong>. Group members: {result.totalMembers ?? '—'}, eligible
              candidates: {result.candidatesConsidered ?? '—'}.
            </Typography>
            {result.truncated ? (
              <Typography variant="body2" sx={{ mt: 1 }} component="span" display="block">
                This run processed up to <strong>{result.eligibleQueuedForSend ?? '—'}</strong> invites; run again to
                reach remaining eligible members in this group.
              </Typography>
            ) : null}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading} sx={{ textTransform: 'none' }}>
          {result ? 'Close' : 'Cancel'}
        </Button>
        {!result ? (
          <Button
            onClick={handleConfirm}
            variant="contained"
            disabled={loading || !tenantId}
            sx={{ textTransform: 'none', minWidth: 120 }}
          >
            {loading ? <CircularProgress size={22} color="inherit" /> : 'Confirm'}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
