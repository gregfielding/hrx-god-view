/**
 * EditWorkersCompDialog — set a timesheet row's WC class code via the
 * `setEntryWorkersComp` callable. Asks for the CODE only; the (internal)
 * rate resolves server-side from the WC matrix by the row's worksite state
 * + code (Greg 2026-07-30).
 *
 * When the row's worksite `state` is known, the code field is a searchable
 * dropdown of the codes actually rated for that state in the matrix — each
 * shown with its catalog title + rate — so the recruiter picks from the
 * real options instead of typing a number (Greg 2026-07-31). Free typing is
 * still allowed for a code the matrix doesn't list yet.
 *
 * The callable stamps the override on the entry AND back-fills the shift
 * doc when its slot is empty, so one edit fixes every other entry on the
 * same shift.
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
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { functions } from '../../firebase';
import { callSetEntryWorkersComp } from '../../services/setEntryWorkersCompCallable';
import WcCodeSelect from '../workersComp/WcCodeSelect';
import { formatFirebaseHttpsError } from '../../utils/firebaseHttpsErrors';
import { normalizeStateCode, US_STATE_CODES } from '../../utils/unemploymentRates';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  tenantId: string;
  entryId: string;
  /** Worksite state — scopes the code dropdown to the matrix's codes for it. */
  state?: string;
  /** Worksite label — when no state resolves, a 2-letter state token in the
   *  name (e.g. "Mubadala Citi DC Open" → DC) pre-selects the state picker. */
  worksiteName?: string;
  /** Entity-scoped matrix rows for this entity win over generic rows. */
  hiringEntityId?: string | null;
  /** Pre-filled values — typically the row's resolved (override OR inherited)
   *  values so the recruiter sees what's effective today. */
  initialCode?: string;
  initialRate?: number;
  /** Optional descriptor for the row — e.g. "Aaron T · 2026-05-29". */
  rowLabel?: string;
}

/** Uppercase 2-letter state token in a worksite label ("Mubadala Citi DC Open"
 *  → "DC"). Uppercase-only so words like "in"/"or" never match. */
function sniffStateToken(name?: string): string {
  for (const tok of String(name ?? '').split(/[^A-Za-z]+/)) {
    if (tok.length === 2 && tok === tok.toUpperCase() && (US_STATE_CODES as readonly string[]).includes(tok)) {
      return tok;
    }
  }
  return '';
}

const EditWorkersCompDialog: React.FC<Props> = ({
  open,
  onClose,
  onSuccess,
  tenantId,
  entryId,
  state,
  worksiteName,
  hiringEntityId,
  initialCode,
  initialRate,
  rowLabel,
}) => {
  const [code, setCode] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Manual work-state pick for rows that can't resolve one — traveling crews
  // (e.g. VenueSmart) whose assignment has no fixed worksite state. Drives
  // the code dropdown AND is stamped on the entry server-side.
  const [pickedState, setPickedState] = useState<string>('');

  const propStateCode = normalizeStateCode(state ?? '').trim().toUpperCase();
  const stateCode = propStateCode || pickedState;

  useEffect(() => {
    if (!open) return;
    setCode(initialCode ?? '');
    // No resolvable state → pre-select the picker with a state token sniffed
    // from the worksite label (recruiter can still change it).
    setPickedState(propStateCode ? '' : sniffStateToken(worksiteName));
    setError(null);
  }, [open, initialCode, propStateCode, worksiteName]);

  const handleSubmit = async (): Promise<void> => {
    const trimmedCode = code.trim();
    setSubmitting(true);
    setError(null);
    try {
      await callSetEntryWorkersComp(
        functions,
        trimmedCode
          ? // Code only — the server resolves the (internal) rate from the WC
            // matrix by the row's worksite state + code. When the row had no
            // resolvable state, send the manually picked one so the lookup
            // works and the entry gets stamped with it.
            {
              tenantId,
              entryId,
              workersCompCode: trimmedCode,
              ...(!propStateCode && pickedState ? { workState: pickedState } : {}),
            }
          : // Blank code = clear the WC override (code + rate).
            { tenantId, entryId, workersCompCode: null, workersCompRate: null },
      );
      onSuccess();
      onClose();
    } catch (e: unknown) {
      setError(formatFirebaseHttpsError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Workers' Comp — {rowLabel || 'entry'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {stateCode
              ? `Pick a class code rated for ${stateCode} — the (internal) rate resolves automatically from the matrix. `
              : 'This row has no work state (traveling crew) — pick the state worked first, then the class code. '}
            Saves an override on this row AND back-fills the shift when its WC fields are empty, so
            other entries on the same shift inherit too.
          </Typography>

          {!propStateCode && (
            <TextField
              select
              label="Work state"
              value={pickedState}
              onChange={(e) => setPickedState(e.target.value)}
              helperText="State where this work was performed — saved onto the row for WC reporting."
              fullWidth
            >
              {US_STATE_CODES.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
          )}

          <WcCodeSelect
            tenantId={tenantId}
            state={stateCode}
            hiringEntityId={hiringEntityId}
            value={code}
            onChange={(c) => setCode(c)}
            label="NCCI class code"
            autoFocus
            helperText={
              stateCode
                ? `Codes rated for ${stateCode}. Rate resolves from the matrix; leave blank to clear WC.`
                : "4-digit code from your insurer's schedule. Rate resolves from the matrix; leave blank to clear."
            }
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
          startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {submitting ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EditWorkersCompDialog;
