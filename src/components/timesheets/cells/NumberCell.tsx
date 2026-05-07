/**
 * `NumberCell` — inline-editable non-negative dollar amount cell.
 * Used for `tips` and `bonusAmount` on TimesheetEntryV2.
 *
 * **Same UX contract as TimeCell:**
 *   - Click to edit, Tab/Enter/blur commit, Escape cancels.
 *   - Save-on-blur is the only commit path.
 *   - Validation runs synchronously before Firestore patch
 *     (`validateNonNegativeNumber` via field-specific validator).
 *   - Optimistic UI; auto-rollback on failure.
 *   - 150ms spinner / 300ms checkmark.
 *
 * **Display formatting.** View mode: `$12.50` (always two decimals).
 * Edit mode: raw numeric string the user typed (no leading `$`).
 *
 * **Why not MUI `TextField type="number"`.** It's flaky across
 * browsers (Safari shows a spinner; Firefox accepts "1e2"; mobile
 * keyboards default to a numeric pad without the decimal key on some
 * configurations). Plain text + custom validator gives consistent
 * cross-browser behavior matching the spreadsheet feel.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, InputBase } from '@mui/material';

import {
  isValidationFail,
  type ValidationResult,
} from '../../../utils/timesheets/entryValidation';

import CellAdornments from './CellAdornments';
import { useCellSaveState } from './useCellSaveState';

/* -------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

export interface NumberCellProps {
  value: number | null | undefined;
  onSave: (value: number) => Promise<void>;
  /** Field-specific validator (validateTips or validateBonusAmount).
   *  Returns canonicalized number on success; failure message on bad input. */
  validate: (raw: string) => ValidationResult<number>;
  disabled?: boolean;
  emptyDisplay?: string;
  ariaLabel?: string;
  onEditStart?: () => void;
  onEditEnd?: () => void;
}

/* -------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '$0.00';
  return `$${n.toFixed(2)}`;
}

function rawForEdit(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  // Keep two decimals on the way INTO edit mode so "12.5" → "12.50"
  // (matches what they'd see committed). The validator strips
  // trailing zeros on commit, so re-edits still feel natural.
  return n.toFixed(2);
}

/* -------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------- */

const NumberCell: React.FC<NumberCellProps> = ({
  value,
  onSave,
  validate,
  disabled = false,
  emptyDisplay = '$0.00',
  ariaLabel = 'Number',
  onEditStart,
  onEditEnd,
}) => {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [draft, setDraft] = useState<string>('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastCommittedRef = useRef<number | null | undefined>(value);
  const saveState = useCellSaveState();

  useEffect(() => {
    if (saveState.state === 'idle') {
      lastCommittedRef.current = value;
    }
  }, [value, saveState.state]);

  const enterEdit = useCallback(() => {
    if (disabled) return;
    setDraft(rawForEdit(value));
    setMode('edit');
    saveState.reset();
    onEditStart?.();
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [disabled, value, saveState, onEditStart]);

  const exitEdit = useCallback(() => {
    setMode('view');
    onEditEnd?.();
  }, [onEditEnd]);

  const cancel = useCallback(() => {
    setDraft(rawForEdit(value));
    saveState.reset();
    exitEdit();
  }, [value, saveState, exitEdit]);

  const commit = useCallback(async () => {
    const result = validate(draft);
    if (isValidationFail(result)) {
      saveState.setValidationError(result.message);
      return;
    }

    const next = result.value;
    const committed = lastCommittedRef.current ?? 0;

    if (Math.abs(next - committed) < 0.005) {
      saveState.reset();
      exitEdit();
      return;
    }

    const prior = committed;
    lastCommittedRef.current = next;

    await saveState.commit(next, async () => {
      try {
        await onSave(next);
      } catch (err) {
        lastCommittedRef.current = prior;
        throw err;
      }
    });

    if (saveState.state !== 'error') {
      exitEdit();
    }
  }, [draft, validate, onSave, saveState, exitEdit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (e.key === 'Enter') {
          e.preventDefault();
        }
        void commit();
      }
    },
    [cancel, commit],
  );

  const handleBlur = useCallback(() => {
    if (mode === 'edit' && saveState.state !== 'invalid') {
      void commit();
    }
  }, [mode, saveState.state, commit]);

  /* ----------------------------------------------------------------- *
   * View mode
   * ----------------------------------------------------------------- */
  if (mode === 'view') {
    const displayValue =
      value === null || value === undefined ? emptyDisplay : formatMoney(value);
    return (
      <Box
        component="span"
        onClick={enterEdit}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            enterEdit();
          }
        }}
        role={disabled ? undefined : 'button'}
        tabIndex={disabled ? -1 : 0}
        aria-label={`${ariaLabel}: ${displayValue}${disabled ? ' (read-only)' : ', click to edit'}`}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          minWidth: 56,
          justifyContent: 'flex-end',
          px: 0.75,
          py: 0.25,
          borderRadius: 0.5,
          cursor: disabled ? 'default' : 'text',
          color: value ? 'text.primary' : 'text.secondary',
          fontVariantNumeric: 'tabular-nums',
          '&:hover': disabled
            ? undefined
            : {
                backgroundColor: 'action.hover',
                outline: '1px solid',
                outlineColor: 'divider',
              },
          '&:focus-visible': disabled
            ? undefined
            : {
                outline: '2px solid',
                outlineColor: 'primary.main',
                outlineOffset: -1,
              },
        }}
      >
        {displayValue}
        <CellAdornments
          state={saveState.state}
          showSpinner={saveState.showSpinner}
          showCheckmark={saveState.showCheckmark}
          errorMessage={saveState.errorMessage}
          compact
        />
      </Box>
    );
  }

  /* ----------------------------------------------------------------- *
   * Edit mode
   * ----------------------------------------------------------------- */
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        minWidth: 56,
      }}
    >
      <InputBase
        inputRef={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder="0.00"
        inputProps={{
          'aria-label': ariaLabel,
          autoComplete: 'off',
          autoCorrect: 'off',
          autoCapitalize: 'off',
          spellCheck: false,
          inputMode: 'decimal',
          size: 7,
          style: {
            padding: '2px 6px',
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          },
        }}
        sx={{
          fontSize: 'inherit',
          backgroundColor: 'background.paper',
          borderRadius: 0.5,
          outline: '2px solid',
          outlineColor:
            saveState.state === 'invalid' ? 'error.main' : 'primary.main',
          outlineOffset: -1,
        }}
      />
      <CellAdornments
        state={saveState.state}
        showSpinner={saveState.showSpinner}
        showCheckmark={saveState.showCheckmark}
        errorMessage={saveState.errorMessage}
        compact
      />
    </Box>
  );
};

export default NumberCell;
