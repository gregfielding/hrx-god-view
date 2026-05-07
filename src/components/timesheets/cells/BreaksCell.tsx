/**
 * `BreaksCell` — popover-based editor for the breaks array on a
 * TimesheetEntryV2.
 *
 * **UX deltas from single-field cells:**
 *   - View mode shows total break minutes (sum across breaks):
 *     "30m" / "60m" / "—" when no breaks.
 *   - Click opens a Popover anchored to the cell. Inside:
 *     - Each break shows start time + end time + paid checkbox + "×" remove.
 *     - "+ Add break" button appends an empty break (defaults to
 *       middle of shift if shift window known, else 12:00–12:30).
 *     - Footer: "Save" (commit) or "Cancel" (discard local edits).
 *   - Save commits ALL breaks at once via a single `onSave(breaks[])`.
 *     Atomic at the Firestore level — either all of the array
 *     changes land or none.
 *
 * **Validation.** Each break runs `validateBreakAgainstShift` (or
 * `validateBreak` if no shift window passed). Per-break errors show
 * inline next to the break row; Save is disabled until all breaks
 * are valid. This is stricter than the single-field cells (which
 * commit AS the user blurs) because the popover already has explicit
 * Save/Cancel semantics — and a popover full of validation chips
 * with auto-rollback would be chaotic.
 *
 * **Save-on-popover-close vs explicit Save button.** Greg's spec
 * says "Save-on-blur as the only commit path. No Save button." For
 * the breaks cell, the popover-close IS the blur — clicking outside
 * the popover triggers `onClose`, which commits if breaks are valid
 * (and quietly discards if there are no changes). The "Save" button
 * inside the popover is redundant but kept for discoverability —
 * it's the same semantic as the popover-close blur.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  InputBase,
  Popover,
  Stack,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Close as CloseIcon,
} from '@mui/icons-material';

import type { TimesheetBreak } from '../../../types/recruiter/timesheet';
import {
  isValidationFail,
  validateBreakAgainstShift,
} from '../../../utils/timesheets/entryValidation';
import { minutesToTime, timeToMinutes } from '../../../utils/timesheets/timeFormat';

import CellAdornments from './CellAdornments';
import { useCellSaveState } from './useCellSaveState';

/* -------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

export interface BreaksCellProps {
  value: TimesheetBreak[] | null | undefined;
  onSave: (breaks: TimesheetBreak[]) => Promise<void>;
  /**
   * Shift window — used to:
   *   1. Default a new break to the middle of the shift.
   *   2. Validate that breaks fall inside the shift via
   *      `validateBreakAgainstShift`.
   * Pass actuals when set; scheduled times as fallback. `null` for
   * either is fine — validation skips the shift-window check.
   */
  shiftStart?: string | null;
  shiftEnd?: string | null;
  disabled?: boolean;
  ariaLabel?: string;
  onEditStart?: () => void;
  onEditEnd?: () => void;
}

interface DraftBreak {
  startTime: string;
  endTime: string;
  paid: boolean;
  /** Live validation error, if any. Updated as the user edits. */
  error: string | null;
}

/* -------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

function totalBreakMinutes(breaks: TimesheetBreak[] | null | undefined): number {
  if (!Array.isArray(breaks) || breaks.length === 0) return 0;
  return breaks.reduce((acc, b) => {
    if (typeof b.durationMins === 'number' && Number.isFinite(b.durationMins)) {
      return acc + b.durationMins;
    }
    const start = timeToMinutes(b.startTime);
    const end = timeToMinutes(b.endTime);
    if (start === null || end === null) return acc;
    return acc + Math.max(0, end - start);
  }, 0);
}

function defaultBreakWindow(
  shiftStart: string | null | undefined,
  shiftEnd: string | null | undefined,
): { startTime: string; endTime: string } {
  const startMin = timeToMinutes(shiftStart ?? null);
  const endMin = timeToMinutes(shiftEnd ?? null);
  if (startMin === null || endMin === null || endMin <= startMin) {
    return { startTime: '12:00', endTime: '12:30' };
  }
  const mid = Math.floor((startMin + endMin) / 2);
  return {
    startTime: minutesToTime(mid),
    endTime: minutesToTime(mid + 30),
  };
}

function toDraft(breaks: TimesheetBreak[] | null | undefined): DraftBreak[] {
  if (!Array.isArray(breaks)) return [];
  return breaks.map((b) => ({
    startTime: typeof b.startTime === 'string' ? b.startTime : '',
    endTime: typeof b.endTime === 'string' ? b.endTime : '',
    paid: b.paid === true,
    error: null,
  }));
}

function validateAll(
  drafts: DraftBreak[],
  shiftStart: string | null | undefined,
  shiftEnd: string | null | undefined,
): {
  drafts: DraftBreak[];
  validBreaks: TimesheetBreak[] | null;
} {
  const updated: DraftBreak[] = [];
  const valid: TimesheetBreak[] = [];
  let allOk = true;

  for (const d of drafts) {
    const r = validateBreakAgainstShift(
      { startTime: d.startTime, endTime: d.endTime, paid: d.paid },
      shiftStart ?? null,
      shiftEnd ?? null,
    );
    if (isValidationFail(r)) {
      updated.push({ ...d, error: r.message });
      allOk = false;
    } else {
      updated.push({ ...d, error: null });
      valid.push(r.value);
    }
  }

  return { drafts: updated, validBreaks: allOk ? valid : null };
}

function breaksEqual(a: TimesheetBreak[], b: TimesheetBreak[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (
      x.startTime !== y.startTime ||
      x.endTime !== y.endTime ||
      x.durationMins !== y.durationMins ||
      x.paid !== y.paid
    ) {
      return false;
    }
  }
  return true;
}

/* -------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------- */

const BreaksCell: React.FC<BreaksCellProps> = ({
  value,
  onSave,
  shiftStart,
  shiftEnd,
  disabled = false,
  ariaLabel = 'Breaks',
  onEditStart,
  onEditEnd,
}) => {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<DraftBreak[]>(() => toDraft(value));
  const lastCommittedRef = useRef<TimesheetBreak[]>(
    Array.isArray(value) ? value : [],
  );
  const saveState = useCellSaveState();

  useEffect(() => {
    if (saveState.state === 'idle') {
      lastCommittedRef.current = Array.isArray(value) ? value : [];
    }
  }, [value, saveState.state]);

  const totalMin = totalBreakMinutes(value);
  const display =
    totalMin === 0 ? '—' : `${totalMin}m`;

  const openPopover = useCallback(() => {
    if (disabled) return;
    setDrafts(toDraft(value));
    saveState.reset();
    setOpen(true);
    onEditStart?.();
  }, [disabled, value, saveState, onEditStart]);

  const closePopover = useCallback(() => {
    setOpen(false);
    onEditEnd?.();
  }, [onEditEnd]);

  const updateDraft = useCallback(
    (index: number, patch: Partial<DraftBreak>) => {
      setDrafts((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], ...patch, error: null };
        return next;
      });
    },
    [],
  );

  const removeDraft = useCallback((index: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const addDraft = useCallback(() => {
    setDrafts((prev) => [
      ...prev,
      {
        ...defaultBreakWindow(shiftStart, shiftEnd),
        paid: false,
        error: null,
      },
    ]);
  }, [shiftStart, shiftEnd]);

  /**
   * Commit on close: validate everything; if valid AND different
   * from prior, fire save. If invalid, leave popover open with the
   * inline errors (don't silently discard the user's work).
   */
  const commit = useCallback(async () => {
    const { drafts: validated, validBreaks } = validateAll(
      drafts,
      shiftStart,
      shiftEnd,
    );
    setDrafts(validated);
    if (validBreaks === null) {
      // First invalid break's message becomes the cell-level chip
      // tooltip — chrome compositing handles surfacing.
      const firstError = validated.find((d) => d.error !== null)?.error ?? 'Invalid breaks';
      saveState.setValidationError(firstError);
      return;
    }

    const committed = lastCommittedRef.current;
    if (breaksEqual(validBreaks, committed)) {
      saveState.reset();
      closePopover();
      return;
    }

    const prior = committed;
    lastCommittedRef.current = validBreaks;

    await saveState.commit(validBreaks, async () => {
      try {
        await onSave(validBreaks);
      } catch (err) {
        lastCommittedRef.current = prior;
        throw err;
      }
    });

    if (saveState.state !== 'error') {
      closePopover();
    }
  }, [drafts, shiftStart, shiftEnd, saveState, onSave, closePopover]);

  const cancel = useCallback(() => {
    setDrafts(toDraft(value));
    saveState.reset();
    closePopover();
  }, [value, saveState, closePopover]);

  // Live validation as the user edits — drives the per-row error
  // text inside the popover. Memoized so we don't redo it on every
  // keystroke when the deps haven't changed.
  const liveValidated = useMemo(
    () => validateAll(drafts, shiftStart, shiftEnd),
    [drafts, shiftStart, shiftEnd],
  );

  /* ----------------------------------------------------------------- *
   * View
   * ----------------------------------------------------------------- */
  return (
    <>
      <Box
        ref={anchorRef}
        component="span"
        onClick={openPopover}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            openPopover();
          }
        }}
        role={disabled ? undefined : 'button'}
        tabIndex={disabled ? -1 : 0}
        aria-label={`${ariaLabel}: ${display}${disabled ? ' (read-only)' : ', click to edit'}`}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          minWidth: 40,
          px: 0.75,
          py: 0.25,
          borderRadius: 0.5,
          cursor: disabled ? 'default' : 'text',
          color: totalMin > 0 ? 'text.primary' : 'text.secondary',
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
        {display}
        <CellAdornments
          state={saveState.state}
          showSpinner={saveState.showSpinner}
          showCheckmark={saveState.showCheckmark}
          errorMessage={saveState.errorMessage}
          compact
        />
      </Box>

      <Popover
        open={open}
        anchorEl={anchorRef.current}
        onClose={() => {
          // Popover dismissal IS the blur. Commit (which itself
          // closes on success / leaves open on validation error).
          void commit();
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: { minWidth: 320, p: 2 },
          },
        }}
      >
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
          Breaks
        </Typography>
        {drafts.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            No breaks. Click + Add break below to insert one.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {drafts.map((d, i) => {
              const liveError = liveValidated.drafts[i]?.error ?? null;
              return (
                <Stack
                  key={i}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{
                    p: 1,
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: liveError ? 'error.main' : 'divider',
                  }}
                >
                  <InputBase
                    value={d.startTime}
                    onChange={(e) => updateDraft(i, { startTime: e.target.value })}
                    placeholder="Start"
                    inputProps={{
                      'aria-label': `Break ${i + 1} start`,
                      autoComplete: 'off',
                      autoCorrect: 'off',
                      autoCapitalize: 'off',
                      spellCheck: false,
                      inputMode: 'numeric',
                      size: 6,
                      style: { padding: '2px 6px' },
                    }}
                    sx={{
                      fontSize: 'inherit',
                      backgroundColor: 'background.paper',
                      borderRadius: 0.5,
                      border: '1px solid',
                      borderColor: 'divider',
                      px: 0.5,
                    }}
                  />
                  <Typography variant="body2" color="text.secondary">
                    –
                  </Typography>
                  <InputBase
                    value={d.endTime}
                    onChange={(e) => updateDraft(i, { endTime: e.target.value })}
                    placeholder="End"
                    inputProps={{
                      'aria-label': `Break ${i + 1} end`,
                      autoComplete: 'off',
                      autoCorrect: 'off',
                      autoCapitalize: 'off',
                      spellCheck: false,
                      inputMode: 'numeric',
                      size: 6,
                      style: { padding: '2px 6px' },
                    }}
                    sx={{
                      fontSize: 'inherit',
                      backgroundColor: 'background.paper',
                      borderRadius: 0.5,
                      border: '1px solid',
                      borderColor: 'divider',
                      px: 0.5,
                    }}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        size="small"
                        checked={d.paid}
                        onChange={(e) => updateDraft(i, { paid: e.target.checked })}
                      />
                    }
                    label={
                      <Typography variant="caption">Paid</Typography>
                    }
                    sx={{ ml: 0, mr: 0 }}
                  />
                  <IconButton
                    size="small"
                    aria-label={`Remove break ${i + 1}`}
                    onClick={() => removeDraft(i)}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                  {liveError ? (
                    <Typography
                      variant="caption"
                      color="error"
                      sx={{ flex: 1, minWidth: 80 }}
                    >
                      {liveError}
                    </Typography>
                  ) : null}
                </Stack>
              );
            })}
          </Stack>
        )}
        <Box sx={{ mt: 1.5, display: 'flex', justifyContent: 'space-between' }}>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={addDraft}
          >
            Add break
          </Button>
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={cancel}>
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={() => void commit()}
              disabled={liveValidated.validBreaks === null && drafts.length > 0}
            >
              Save
            </Button>
          </Stack>
        </Box>
      </Popover>
    </>
  );
};

export default BreaksCell;
