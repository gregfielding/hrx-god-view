/**
 * Adornments rendered alongside an inline-editable cell:
 *   - Spinner (after the 150ms threshold from `useCellSaveState`).
 *   - Checkmark (briefly, on successful save).
 *   - Error chip (validation or save failure, with the message).
 *
 * Lives next to the input rather than inside it so the input itself
 * stays a clean text box — important for Tab/Enter/keyboard navigation
 * (P3.A) and for paste-detection (P3.C).
 *
 * The Stack is `direction="row"` and laid out so adornments hover at
 * the right edge of the cell. They're absolutely positioned where the
 * cell template needs them — the parent uses `position: relative` and
 * places this with `position: absolute`.
 */

import React from 'react';
import { Box, CircularProgress, Tooltip, Typography } from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  ErrorOutline as ErrorIcon,
} from '@mui/icons-material';

import type { CellSaveState } from './useCellSaveState';

export interface CellAdornmentsProps {
  state: CellSaveState;
  showSpinner: boolean;
  showCheckmark: boolean;
  errorMessage: string | null;
  /** Compact mode for narrow cells (time, number) — reduces icon size
   *  and hides the inline error text in favor of a tooltip-only chip. */
  compact?: boolean;
}

const CellAdornments: React.FC<CellAdornmentsProps> = ({
  state,
  showSpinner,
  showCheckmark,
  errorMessage,
  compact = false,
}) => {
  const iconSize = compact ? 14 : 16;

  if (showSpinner) {
    return (
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          ml: 0.5,
        }}
        aria-label="Saving"
        role="status"
      >
        <CircularProgress size={iconSize} thickness={5} />
      </Box>
    );
  }

  if (showCheckmark && state === 'saved') {
    return (
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          ml: 0.5,
        }}
        aria-label="Saved"
      >
        <CheckCircleIcon sx={{ fontSize: iconSize, color: 'success.main' }} />
      </Box>
    );
  }

  if ((state === 'invalid' || state === 'error') && errorMessage) {
    const tooltipTitle =
      state === 'invalid'
        ? errorMessage
        : `Save failed: ${errorMessage}. The cell has rolled back.`;
    return (
      <Tooltip title={tooltipTitle} placement="top" arrow>
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            ml: 0.5,
            color: 'error.main',
            cursor: 'help',
          }}
          aria-label={tooltipTitle}
          role="alert"
        >
          <ErrorIcon sx={{ fontSize: iconSize }} />
          {!compact ? (
            <Typography
              variant="caption"
              color="error"
              sx={{ ml: 0.5, lineHeight: 1 }}
            >
              {state === 'invalid' ? 'Invalid' : 'Save failed'}
            </Typography>
          ) : null}
        </Box>
      </Tooltip>
    );
  }

  return null;
};

export default CellAdornments;
