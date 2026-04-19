import React, { useCallback, useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
} from '@mui/material';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../firebase';
import { overviewCardHeaderTextButtonSx } from './OverviewDashboardSections';

export type UserScoreRefreshButtonProps = {
  targetUserId: string;
  tenantId?: string | null;
  /** Optional hook to refetch dependent profile signals (e.g. interview-derived action items). */
  onAfterSuccess?: () => void;
};

type ReviewAndRescoreResponse = {
  ok?: boolean;
  hadPrescreenInterview?: boolean;
  userId?: string;
  scoreSource?: string | null;
  primaryScore?: number | null;
  recommendation?: string | null;
  hiringDecision?: string | null;
  updatedAt?: string;
};

const reviewAndRescoreUser = httpsCallable(functions, 'reviewAndRescoreUser');

/**
 * Recruiter-only manual action: confirm → callable rescore for one user (no page-load triggers).
 */
export default function UserScoreRefreshButton({ targetUserId, tenantId, onAfterSuccess }: UserScoreRefreshButtonProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [snackbar, setSnackbar] = useState<{ severity: 'success' | 'error'; message: string } | null>(null);

  const handleConfirm = useCallback(async () => {
    setIsSubmitting(true);
    try {
      const result = await reviewAndRescoreUser({
        userId: targetUserId,
        ...(tenantId ? { tenantId } : {}),
      });
      const data = result.data as ReviewAndRescoreResponse;
      const hadPrescreen = data?.hadPrescreenInterview === true;
      const message = hadPrescreen
        ? 'User score refreshed'
        : 'No interview found. Refreshed available score data.';
      setSnackbar({ severity: 'success', message });
      onAfterSuccess?.();
    } catch (e: unknown) {
      console.error('reviewAndRescoreUser failed', e);
      setSnackbar({
        severity: 'error',
        message: "Could not refresh this user's score",
      });
    } finally {
      setIsSubmitting(false);
      setConfirmOpen(false);
    }
  }, [onAfterSuccess, targetUserId, tenantId]);

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={isSubmitting ? <CircularProgress color="inherit" size={14} /> : undefined}
        sx={{
          ...overviewCardHeaderTextButtonSx,
          borderColor: 'divider',
          px: 0.75,
          py: 0.25,
          lineHeight: 1.2,
          fontWeight: 600,
        }}
        disabled={isSubmitting}
        onClick={() => setConfirmOpen(true)}
      >
        Review & rescore
      </Button>

      <Dialog open={confirmOpen} onClose={() => !isSubmitting && setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Review and rescore this user?</DialogTitle>
        <DialogContent>
          This will recompute the latest recruiter-facing score and related summaries for this user only.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isSubmitting} variant="contained" color="primary">
            {isSubmitting ? 'Working…' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar != null}
        autoHideDuration={6000}
        onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snackbar ? (
          <Alert severity={snackbar.severity} onClose={() => setSnackbar(null)} sx={{ width: '100%' }}>
            {snackbar.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
}
