/**
 * `TimeCell` — inline-editable HH:mm cell for actualStartTime /
 * actualEndTime on a TimesheetEntryV2.
 *
 * **UX contract (P3.A):**
 *   - Click anywhere in the cell to enter edit mode.
 *   - Tab / Enter / blur commit the value (save-on-blur is the only
 *     commit path; no explicit save button).
 *   - Escape cancels and reverts to the prior value.
 *   - Permissive parsing via `parseTimeInput` — recruiters can type
 *     "8a", "08:00", "0830" all interchangeably.
 *   - Validation runs synchronously BEFORE the Firestore patch.
 *     Failure → error chip + cell stays in edit mode + NO write.
 *   - Optimistic UI: the new value displays immediately on commit;
 *     server failure reverts to prior + surfaces the error chip.
 *   - 150ms threshold for the spinner; 300ms checkmark on success.
 *
 * **Data shape.**
 *   - `value`: current Firestore value (string `HH:mm` or null).
 *   - `onSave`: receives the canonicalized value to persist (string
 *     or null when the recruiter clears the cell). `null` is allowed
 *     because actuals can legitimately be cleared (worker no-show
 *     scenario).
 *
 * **Edit mode is per-cell, not page-wide.** The cell tracks its own
 * `mode: 'view' | 'edit'`. Multiple TimeCells can be in edit mode
 * across different rows; each commits independently. Useful for
 * P3.C's bulk paste flow which will programmatically commit many
 * cells.
 *
 * **Native `type="time"` is intentionally avoided.** OS chrome
 * fragmentation (Safari renders different stepper than Chrome) makes
 * the spreadsheet feel inconsistent across browsers, and shorthand
 * input ("8a") is rejected by the native control. We use a plain
 * text input + `parseTimeInput` to keep input behavior identical
 * everywhere.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, InputBase } from '@mui/material';

import {
  formatTimeForDisplay,
} from '../../../utils/timesheets/timeFormat';
import {
  isValidationFail,
  validateActualTime,
} from '../../../utils/timesheets/entryValidation';

import CellAdornments from './CellAdornments';
import { useCellSaveState } from './useCellSaveState';

/* -------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

export interface TimeCellProps {
  /** Current persisted value. `null` = cell was cleared / never set. */
  value: string | null | undefined;
  /**
   * Persistence callback. Receives the canonicalized HH:mm value (or
   * null for cleared) and returns a Promise that resolves on
   * Firestore success / rejects on failure. Errors are surfaced via
   * the error chip; cells roll back to `value` on failure.
   */
  onSave: (value: string | null) => Promise<void>;
  /**
   * Whether this cell is editable at all. `false` disables click-to-
   * edit and renders as a static value. Used for `sent_to_everee` /
   * `paid` entries that must use TimesheetAdjustment instead.
   */
  disabled?: boolean;
  /**
   * Optional placeholder shown in view mode when `value` is null.
   * Default `'—'` matches the existing read-only grid convention.
   */
  emptyDisplay?: string;
  /**
   * Optional aria-label / hint for screen readers. Cells are usually
   * inside a labeled column header so a generic "Time input" is fine
   * by default; pass a more specific label for cells that don't have
   * a clear column context.
   */
  ariaLabel?: string;
  /**
   * Optional callbacks fired when the cell enters / exits edit mode.
   * Used by the parent grid (P3.A.4) to wire keyboard navigation —
   * leaving edit mode in one cell can advance focus to the next cell.
   */
  onEditStart?: () => void;
  onEditEnd?: () => void;
}

/* -------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------- */

const TimeCell: React.FC<TimeCellProps> = ({
  value,
  onSave,
  disabled = false,
  emptyDisplay = '—',
  ariaLabel = 'Time',
  onEditStart,
  onEditEnd,
}) => {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [draft, setDraft] = useState<string>('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastCommittedRef = useRef<string | null | undefined>(value);
  const saveState = useCellSaveState();

  // Re-sync `lastCommittedRef` when the parent re-renders with a new
  // `value` (e.g. from `mergeEntryUpdate` or a refresh). The ref is
  // the authoritative "what's actually in Firestore" snapshot used by
  // optimistic-UI rollback.
  useEffect(() => {
    if (saveState.state === 'idle') {
      lastCommittedRef.current = value;
    }
  }, [value, saveState.state]);

  const enterEdit = useCallback(() => {
    if (disabled) return;
    setDraft(value ?? '');
    setMode('edit');
    saveState.reset();
    onEditStart?.();
    // Defer focus to next paint so the input has rendered.
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
    setDraft(value ?? '');
    saveState.reset();
    exitEdit();
  }, [value, saveState, exitEdit]);

  /**
   * Commit the draft. Path:
   *   1. Validate. Failure → setValidationError (chip + stays in edit).
   *   2. If unchanged from current persisted value → exit edit silently.
   *   3. Else fire onSave through the lifecycle hook.
   *
   * On success, exit edit mode after the commit resolves so the
   * checkmark briefly shows in view mode.
   */
  const commit = useCallback(async () => {
    const result = validateActualTime(draft);
    if (isValidationFail(result)) {
      saveState.setValidationError(result.message);
      return;
    }

    const next = result.value;
    const committed = lastCommittedRef.current ?? null;

    if (next === committed) {
      saveState.reset();
      exitEdit();
      return;
    }

    // Optimistic: update the committed-ref so the cell's view
    // reflects the new value during save. On failure the catch
    // branch in `commit` rolls back via `errorMessage` + we restore
    // the prior ref.
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
  }, [draft, onSave, saveState, exitEdit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        // For Tab, let the browser advance focus AFTER our blur
        // commits — don't preventDefault here. Just trigger commit
        // on the same tick; the input's own blur handler will then
        // run with the cell already in 'view' mode (commit resolved
        // synchronously for the validation pass; async for the
        // Firestore part).
        if (e.key === 'Enter') {
          e.preventDefault();
        }
        void commit();
      }
    },
    [cancel, commit],
  );

  const handleBlur = useCallback(() => {
    // Only commit if we're still in edit mode — otherwise this is a
    // re-blur after Enter/Tab already committed.
    if (mode === 'edit' && saveState.state !== 'invalid') {
      void commit();
    }
  }, [mode, saveState.state, commit]);

  const displayValue = formatTimeForDisplay(value) || emptyDisplay;

  /* ----------------------------------------------------------------- *
   * View mode
   * ----------------------------------------------------------------- */
  if (mode === 'view') {
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
          px: 0.75,
          py: 0.25,
          borderRadius: 0.5,
          cursor: disabled ? 'default' : 'text',
          color: value ? 'text.primary' : 'text.secondary',
          fontVariantNumeric: 'tabular-nums',
          // Subtle hover affordance — recruiters need to know the
          // cell is editable but not have it scream at them.
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
        minWidth: 56,
      }}
    >
      <InputBase
        inputRef={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder="HH:mm"
        inputProps={{
          'aria-label': ariaLabel,
          // Prevent autocomplete from polluting the dropdown — phone
          // keyboards in particular suggest random times.
          autoComplete: 'off',
          autoCorrect: 'off',
          autoCapitalize: 'off',
          spellCheck: false,
          inputMode: 'numeric',
          // Fixed character width approximation; longer than HH:mm to
          // accommodate "8:30 PM" while typing.
          size: 7,
          // Keep the input compact — no border by default; chrome lives
          // on the wrapping Box so the input visually merges with the
          // cell.
          style: {
            padding: '2px 6px',
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

export default TimeCell;
