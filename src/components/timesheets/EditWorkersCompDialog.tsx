/**
 * EditWorkersCompDialog — single modal that takes both NCCI class code
 * and decimal rate for a timesheet row, then saves via the
 * `setEntryWorkersComp` callable.
 *
 * The callable stamps the override on the entry AND back-fills the
 * shift doc when its slot is empty, so one edit fixes every other
 * entry on the same shift without the recruiter having to walk through
 * each row.
 *
 * The dialog opens from the inline cells in the Timesheets grid.
 * Pre-filled with whatever the resolver already resolved (override OR
 * inherited from shift / JO / positions), so the recruiter can see what
 * the current value is and tweak only what's wrong.
 */

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { functions } from '../../firebase';
import { callSetEntryWorkersComp } from '../../services/setEntryWorkersCompCallable';
import { formatFirebaseHttpsError } from '../../utils/firebaseHttpsErrors';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  tenantId: string;
  entryId: string;
  /** Pre-filled values — typically the row's resolved (override OR inherited)
   *  values so the recruiter sees what's effective today. Undefined fields
   *  render as empty inputs. */
  initialCode?: string;
  initialRate?: number;
  /** Optional descriptor for the row — e.g. "Aaron T · 2026-05-29" — so
   *  the recruiter sees which entry they're editing in the header. */
  rowLabel?: string;
}

const EditWorkersCompDialog: React.FC<Props> = ({
  open,
  onClose,
  onSuccess,
  tenantId,
  entryId,
  initialCode,
  initialRate,
  rowLabel,
}) => {
  const [code, setCode] = useState<string>('');
  const [rate, setRate] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCode(initialCode ?? '');
    setRate(initialRate != null ? String(initialRate) : '');
    setError(null);
  }, [open, initialCode, initialRate]);

  const handleSubmit = async (): Promise<void> => {
    const trimmedCode = code.trim();
    const rateNum = rate.trim() ? Number.parseFloat(rate.trim()) : null;
    if (rate.trim() && (!Number.isFinite(rateNum) || (rateNum != null && rateNum < 0))) {
      setError('Rate must be a positive decimal number.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await callSetEntryWorkersComp(functions, {
        tenantId,
        entryId,
        // Pass null to clear, omit (undefined) to leave untouched. We
        // always send both fields here — the recruiter sees both inputs
        // and any blank one is interpreted as "clear that field."
        workersCompCode: trimmedCode || null,
        workersCompRate: rate.trim() ? rateNum : null,
      });
      onSuccess();
      onClose();
    } catch (e: unknown) {
      setError(formatFirebaseHttpsError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : onClose}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>Workers' Comp — {rowLabel || 'entry'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Saves an override on this row AND back-fills the shift when
            its WC fields are empty — so other entries on the same shift
            inherit automatically. Future shifts on this JO are
            unaffected; set the JO-level defaults there if needed.
          </Typography>

          <TextField
            label="NCCI class code"
            placeholder="e.g. 8044"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            inputProps={{ inputMode: 'numeric', maxLength: 8 }}
            helperText="4-digit code from your insurer's worker-class schedule."
          />
          <TextField
            label="WC rate"
            placeholder="e.g. 2.25"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            inputProps={{ inputMode: 'decimal' }}
            helperText="Per-$100 payroll rate (decimal). Optional — leave blank to clear."
          />

          {error && <Alert severity="error">{error}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting}
          startIcon={
            submitting ? <CircularProgress size={16} color="inherit" /> : null
          }
        >
          {submitting ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EditWorkersCompDialog;
