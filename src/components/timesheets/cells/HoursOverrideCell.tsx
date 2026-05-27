/**
 * HoursOverrideCell — inline-editable decimal-hours input for the
 * `actualHoursOverride` field on a TimesheetEntryV2.
 *
 * Why this exists separately from NumberCell: NumberCell formats as
 * currency ($X.XX) and isn't separable from that. Hours need plain
 * decimal display (e.g. "6.25" not "$6.25"). Small enough that a
 * dedicated cell beats a NumberCell variant prop.
 *
 * Used by TimesheetGrid in the Actual hrs column — rendered only when
 * `actualStartTime` AND `actualEndTime` are both empty/null. When
 * either time is set, the time-based computation wins and we show the
 * resolved `actualHrs` as a read-only number (no input). This mirrors
 * the recompute trigger's precedence so the UI never disagrees with
 * what's persisted.
 *
 * Save-on-blur idiom matches the other inline cells (TimeCell,
 * NumberCell, NotesCell). Clearing the input persists `null`.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, InputBase, Typography } from '@mui/material';

import CellAdornments from './CellAdornments';
import { useCellSaveState } from './useCellSaveState';

export interface HoursOverrideCellProps {
  /** Current value in decimal hours; `null` / undefined → blank. */
  value: number | null | undefined;
  /** Persist callback. `null` clears the override. */
  onSave: (value: number | null) => Promise<void>;
  disabled?: boolean;
  ariaLabel?: string;
  onEditStart?: () => void;
  onEditEnd?: () => void;
}

/** Maximum decimal hours we'll accept on commit. 24h covers any single
 *  shift; anything larger is almost certainly a typo (recruiter meant
 *  minutes instead of hours, or fat-fingered an extra digit). */
const MAX_HOURS = 24;

function formatDisplay(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) return '—';
  if (Number.isInteger(n)) return String(n);
  // Trim trailing zero (so 6.25 stays 6.25 but 6.5 doesn't render 6.50).
  // .toFixed(2) → "6.50"; then strip the trailing zero.
  return n
    .toFixed(2)
    .replace(/\.?0+$/, (m) => (m.includes('.') ? '' : m));
}

function rawForEdit(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) return '';
  // Two decimals on the way in so re-edits feel natural.
  return n.toFixed(2).replace(/\.?0+$/, (m) => (m.includes('.') ? '' : m));
}

interface ValidationOk {
  ok: true;
  value: number | null;
}
interface ValidationFail {
  ok: false;
  message: string;
}
type Validation = ValidationOk | ValidationFail;

/** Permissive decimal parser. Accepts integers, decimals, leading dot,
 *  optional whitespace. Rejects negatives + values above MAX_HOURS so
 *  a fat-fingered "625" doesn't write 625 hours into a row. */
function validate(raw: string): ValidationOk | ValidationFail {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };
  if (!/^\d*(?:\.\d+)?$/.test(trimmed)) {
    return { ok: false, message: 'Enter a positive number.' };
  }
  const n = parseFloat(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, message: 'Enter a positive number.' };
  }
  if (n > MAX_HOURS) {
    return { ok: false, message: `Max ${MAX_HOURS}h per day.` };
  }
  // Round to 2 decimals so we don't persist floating-point cruft.
  return { ok: true, value: Math.round(n * 100) / 100 || null };
}

const HoursOverrideCell: React.FC<HoursOverrideCellProps> = ({
  value,
  onSave,
  disabled = false,
  ariaLabel = 'Actual hours override',
  onEditStart,
  onEditEnd,
}) => {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState<string>(() => rawForEdit(value));
  const [validation, setValidation] = useState<Validation>({ ok: true, value: value ?? null });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const saveState = useCellSaveState();
  const lastCommittedRef = useRef<number | null>(value ?? null);

  useEffect(() => {
    if (saveState.state === 'idle') {
      lastCommittedRef.current = value ?? null;
    }
  }, [value, saveState.state]);

  const enterEdit = useCallback(() => {
    if (disabled) return;
    setRaw(rawForEdit(value));
    setValidation({ ok: true, value: value ?? null });
    setEditing(true);
    saveState.reset();
    onEditStart?.();
    // Focus on next tick so the InputBase has mounted.
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [disabled, value, saveState, onEditStart]);

  const commit = useCallback(async () => {
    const v = validate(raw);
    setValidation(v);
    if (v.ok === false) {
      saveState.setValidationError(v.message);
      return;
    }
    // v is narrowed to ValidationOk after the early-return.
    const nextValue = v.value;
    setEditing(false);
    onEditEnd?.();
    if (nextValue === lastCommittedRef.current) {
      saveState.reset();
      return;
    }
    const prior = lastCommittedRef.current;
    lastCommittedRef.current = nextValue;
    await saveState.commit(nextValue, async () => {
      try {
        await onSave(nextValue);
      } catch (err) {
        lastCommittedRef.current = prior;
        throw err;
      }
    });
  }, [raw, saveState, onSave, onEditEnd]);

  const cancel = useCallback(() => {
    setRaw(rawForEdit(value));
    setValidation({ ok: true, value: value ?? null });
    setEditing(false);
    saveState.reset();
    onEditEnd?.();
  }, [value, saveState, onEditEnd]);

  if (editing && !disabled) {
    return (
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.25,
          minWidth: 60,
        }}
      >
        <InputBase
          inputRef={inputRef}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
          placeholder="0.00"
          inputProps={{
            'aria-label': ariaLabel,
            autoComplete: 'off',
            inputMode: 'decimal',
            size: 5,
            style: { padding: '2px 6px', textAlign: 'right' },
          }}
          sx={{
            fontSize: 'inherit',
            fontVariantNumeric: 'tabular-nums',
            backgroundColor: 'background.paper',
            borderRadius: 0.5,
            border: '1px solid',
            borderColor: validation.ok ? 'primary.main' : 'error.main',
            px: 0.5,
            outline: validation.ok ? 'none' : '1px solid',
            outlineColor: 'error.main',
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
  }

  // Static / view mode.
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
      aria-label={
        disabled
          ? `${ariaLabel}: ${formatDisplay(value)} (read-only)`
          : `${ariaLabel}: ${formatDisplay(value)}, click to edit`
      }
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        minWidth: 40,
        justifyContent: 'flex-end',
        px: 0.75,
        py: 0.25,
        borderRadius: 0.5,
        cursor: disabled ? 'default' : 'text',
        color:
          value !== null && value !== undefined && value > 0
            ? 'text.primary'
            : 'text.secondary',
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
      <Typography component="span" variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatDisplay(value)}
      </Typography>
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

export default HoursOverrideCell;
