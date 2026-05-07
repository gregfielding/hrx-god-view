/**
 * `NotesCell` — inline-editable free-text notes cell on
 * TimesheetEntryV2.
 *
 * **UX deltas vs TimeCell/NumberCell:**
 *   - Larger column footprint, view mode shows truncated text with
 *     ellipsis if longer than the visible width; tooltip exposes the
 *     full text on hover.
 *   - Edit mode opens a small textarea (multiline) inline, anchored
 *     at the cell. Auto-grows to ~3 lines.
 *   - Enter inserts a newline (notes are multi-line); blur or
 *     Cmd/Ctrl+Enter commits.
 *
 * **Validation.** Capped at 1000 characters via `validateNotes`.
 * Empty string is valid (clearing the note).
 *
 * **Recompute trigger note.** `notes` is NOT in COMPUTE_INPUT_FIELDS
 * on the recompute trigger — confirmed by the P2 spot-check (Tier-1
 * gate test passed). So a notes-only edit is essentially free
 * server-side: no recompute fires, just the field write + audit
 * stamps.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, InputBase, Tooltip } from '@mui/material';

import {
  isValidationFail,
  validateNotes,
} from '../../../utils/timesheets/entryValidation';

import CellAdornments from './CellAdornments';
import { useCellSaveState } from './useCellSaveState';

/* -------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

export interface NotesCellProps {
  value: string | null | undefined;
  onSave: (value: string) => Promise<void>;
  disabled?: boolean;
  emptyDisplay?: string;
  ariaLabel?: string;
  onEditStart?: () => void;
  onEditEnd?: () => void;
}

/* -------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------- */

const NotesCell: React.FC<NotesCellProps> = ({
  value,
  onSave,
  disabled = false,
  emptyDisplay = '—',
  ariaLabel = 'Notes',
  onEditStart,
  onEditEnd,
}) => {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [draft, setDraft] = useState<string>('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastCommittedRef = useRef<string | null | undefined>(value);
  const saveState = useCellSaveState();

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

  const commit = useCallback(async () => {
    const result = validateNotes(draft);
    if (isValidationFail(result)) {
      saveState.setValidationError(result.message);
      return;
    }

    const next = result.value;
    const committed = lastCommittedRef.current ?? '';

    if (next === committed) {
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
  }, [draft, onSave, saveState, exitEdit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
        return;
      }
      // Cmd/Ctrl+Enter commits (Enter alone inserts newline).
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void commit();
        return;
      }
      // Tab leaves the cell, commits, lets browser advance focus.
      if (e.key === 'Tab') {
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

  const trimmedValue = (value ?? '').trim();
  const displayValue = trimmedValue || emptyDisplay;
  // Truncate display in view mode at ~40 chars to keep the column
  // tight; full text shown in tooltip on hover.
  const truncated =
    trimmedValue.length > 40 ? `${trimmedValue.slice(0, 37).trim()}…` : displayValue;

  /* ----------------------------------------------------------------- *
   * View mode
   * ----------------------------------------------------------------- */
  if (mode === 'view') {
    return (
      <Tooltip
        title={trimmedValue.length > 40 ? trimmedValue : ''}
        placement="top"
        arrow
        disableHoverListener={trimmedValue.length <= 40}
      >
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
            display: 'inline-block',
            minWidth: 100,
            maxWidth: 280,
            px: 0.75,
            py: 0.25,
            borderRadius: 0.5,
            cursor: disabled ? 'default' : 'text',
            color: trimmedValue ? 'text.primary' : 'text.secondary',
            fontStyle: trimmedValue ? 'normal' : 'italic',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            verticalAlign: 'middle',
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
          {truncated}
          <CellAdornments
            state={saveState.state}
            showSpinner={saveState.showSpinner}
            showCheckmark={saveState.showCheckmark}
            errorMessage={saveState.errorMessage}
            compact
          />
        </Box>
      </Tooltip>
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
        alignItems: 'flex-start',
        minWidth: 200,
      }}
    >
      <InputBase
        inputRef={inputRef as React.Ref<HTMLInputElement>}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder="Notes (Cmd+Enter to save)"
        multiline
        minRows={1}
        maxRows={3}
        inputProps={{
          'aria-label': ariaLabel,
          maxLength: 1000,
          spellCheck: true,
          autoComplete: 'off',
          style: {
            padding: '2px 6px',
          },
        }}
        sx={{
          fontSize: 'inherit',
          width: '100%',
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

export default NotesCell;
