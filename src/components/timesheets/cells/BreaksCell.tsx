/**
 * `BreaksCell` — popover-based editor for the breaks array on a
 * TimesheetEntryV2.
 *
 * **UX (2026-05-26 simplification — duration-only).** Recruiters
 * historically had to enter break start AND end times — which was
 * fiddly, broke on overnight shifts (the validator refused to
 * compare clock times across midnight), and didn't reflect how
 * payroll actually consumes breaks. The pay-rules engine + Everee
 * submission both read only `durationMins` + `paid` per break.
 *
 * Now each break is a single duration input (with preset chips
 * 15 / 30 / 45 / 60 / 90 minutes) plus a Paid checkbox plus a
 * remove button. Existing rows with explicit start/end times are
 * collapsed to their effective duration on open — no migration
 * needed.
 *
 * **Wire-shape compatibility.** TimesheetBreak still has `startTime`
 * + `endTime` as required strings (declared in `types/recruiter/timesheet.ts`).
 * We synthesize noon-anchored stub values on save (12:00 → 12:00 +
 * duration) so the document shape stays compatible with existing
 * readers. The synthetic times are never displayed to the user.
 *
 * **No more shift-window validation.** The old
 * `validateBreakAgainstShift` rejected breaks that fell outside the
 * shift, and it was also the source of the "Overnight shifts can't
 * be edited inline yet" error. With durations there's no clock time
 * to validate — only that the duration is a positive integer and
 * less than the shift itself (in total).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
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
   * Shift window — kept on the prop signature for backwards-compat
   * with callers, but now only used to compute a sanity cap on the
   * total break duration (sum of breaks ≤ shift length). Individual
   * breaks no longer need clock-time validation against the shift.
   */
  shiftStart?: string | null;
  shiftEnd?: string | null;
  disabled?: boolean;
  ariaLabel?: string;
  onEditStart?: () => void;
  onEditEnd?: () => void;
}

interface DraftBreak {
  durationMins: number;
  paid: boolean;
  /** Live validation error, if any. Updated as the user edits. */
  error: string | null;
}

/* -------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

const PRESET_DURATIONS_MIN: ReadonlyArray<number> = [15, 30, 45, 60, 90];
/** Defensive cap on a single break — 8h is a full shift, anything longer
 *  is almost certainly a typo. */
const MAX_BREAK_MIN = 480;
const DEFAULT_NEW_BREAK_MIN = 30;

function totalBreakMinutes(breaks: TimesheetBreak[] | null | undefined): number {
  if (!Array.isArray(breaks) || breaks.length === 0) return 0;
  return breaks.reduce((acc, b) => {
    if (typeof b.durationMins === 'number' && Number.isFinite(b.durationMins)) {
      return acc + Math.max(0, b.durationMins);
    }
    const start = timeToMinutes(b.startTime);
    const end = timeToMinutes(b.endTime);
    if (start === null || end === null) return acc;
    return acc + Math.max(0, end - start);
  }, 0);
}

/**
 * Derive the duration of an existing break from whichever fields it
 * happens to carry. Newer rows have a populated `durationMins`; older
 * rows only had `startTime` + `endTime` and the duration was implicit.
 */
function deriveDurationMins(b: TimesheetBreak): number {
  if (typeof b.durationMins === 'number' && Number.isFinite(b.durationMins) && b.durationMins > 0) {
    return Math.round(b.durationMins);
  }
  const start = timeToMinutes(b.startTime);
  const end = timeToMinutes(b.endTime);
  if (start === null || end === null) return 0;
  return Math.max(0, end - start);
}

function toDraft(breaks: TimesheetBreak[] | null | undefined): DraftBreak[] {
  if (!Array.isArray(breaks)) return [];
  return breaks.map((b) => ({
    durationMins: deriveDurationMins(b),
    paid: b.paid === true,
    error: null,
  }));
}

/**
 * Per-break validator: must be a positive integer ≤ MAX_BREAK_MIN.
 * `validateAll` also enforces sum-of-breaks ≤ shift length so a
 * recruiter can't enter breaks that exceed the worked shift.
 */
function validateOne(d: DraftBreak): DraftBreak {
  if (!Number.isFinite(d.durationMins) || d.durationMins <= 0) {
    return { ...d, error: 'Enter a duration greater than 0 minutes.' };
  }
  if (!Number.isInteger(d.durationMins)) {
    return { ...d, error: 'Duration must be a whole number of minutes.' };
  }
  if (d.durationMins > MAX_BREAK_MIN) {
    return { ...d, error: `Duration must be ≤ ${MAX_BREAK_MIN} minutes.` };
  }
  return { ...d, error: null };
}

function validateAll(
  drafts: DraftBreak[],
  shiftStart: string | null | undefined,
  shiftEnd: string | null | undefined,
): {
  drafts: DraftBreak[];
  validBreaks: TimesheetBreak[] | null;
} {
  const stepwise = drafts.map(validateOne);
  // Sum sanity. Compute the shift length in minutes; if the shift is
  // overnight (endMin < startMin), fold the second leg into the next
  // day (same trick the recompute trigger uses). Anything longer than
  // that is clearly over-counted.
  const startMin = timeToMinutes(shiftStart ?? null);
  const endMinRaw = timeToMinutes(shiftEnd ?? null);
  let shiftLen = Number.POSITIVE_INFINITY;
  if (startMin !== null && endMinRaw !== null) {
    const endMin = endMinRaw <= startMin ? endMinRaw + 1440 : endMinRaw;
    shiftLen = endMin - startMin;
  }
  const totalMin = stepwise.reduce((acc, d) => acc + (d.durationMins || 0), 0);
  const totalExceedsShift = totalMin > shiftLen;

  if (totalExceedsShift) {
    // Mark every row with the shared error so the user knows it's
    // a sum issue, not any one row in particular.
    const flagged = stepwise.map((d) =>
      d.error == null
        ? { ...d, error: `Total breaks (${totalMin}m) exceed shift length (${shiftLen}m).` }
        : d,
    );
    return { drafts: flagged, validBreaks: null };
  }

  const allOk = stepwise.every((d) => d.error === null);
  if (!allOk) return { drafts: stepwise, validBreaks: null };

  // Synthesize stub clock times. Anchored at noon so existing
  // type-shape readers (TimesheetBreak.startTime/endTime are required
  // strings on the type) get valid HH:mm values. The pay-rules engine
  // + Everee submission only read durationMins + paid, so the
  // synthetic times don't affect downstream computation.
  let cursor = 12 * 60; // 12:00 in minutes
  const valid: TimesheetBreak[] = stepwise.map((d) => {
    const start = cursor % 1440;
    cursor += d.durationMins;
    const end = cursor % 1440;
    return {
      startTime: minutesToTime(start),
      endTime: minutesToTime(end),
      durationMins: d.durationMins,
      paid: d.paid,
    };
  });
  return { drafts: stepwise, validBreaks: valid };
}

function breaksEqual(a: TimesheetBreak[], b: TimesheetBreak[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x.durationMins !== y.durationMins || x.paid !== y.paid) {
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
  const display = totalMin === 0 ? '—' : `${totalMin}m`;

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
        durationMins: DEFAULT_NEW_BREAK_MIN,
        paid: false,
        error: null,
      },
    ]);
  }, []);

  const commit = useCallback(async () => {
    const { drafts: validated, validBreaks } = validateAll(
      drafts,
      shiftStart,
      shiftEnd,
    );
    setDrafts(validated);
    if (validBreaks === null) {
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
            sx: { minWidth: 340, p: 2 },
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
                <Box
                  key={i}
                  sx={{
                    p: 1,
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: liveError ? 'error.main' : 'divider',
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center">
                    <InputBase
                      value={Number.isFinite(d.durationMins) ? d.durationMins : ''}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === '') {
                          updateDraft(i, { durationMins: 0 });
                          return;
                        }
                        const n = Number(raw);
                        if (Number.isFinite(n)) {
                          updateDraft(i, { durationMins: Math.round(n) });
                        }
                      }}
                      placeholder="Mins"
                      inputProps={{
                        'aria-label': `Break ${i + 1} duration (minutes)`,
                        autoComplete: 'off',
                        autoCorrect: 'off',
                        spellCheck: false,
                        inputMode: 'numeric',
                        size: 4,
                        style: { padding: '4px 8px', textAlign: 'right' },
                      }}
                      sx={{
                        fontSize: 'inherit',
                        backgroundColor: 'background.paper',
                        borderRadius: 0.5,
                        border: '1px solid',
                        borderColor: 'divider',
                        width: 64,
                      }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      min
                    </Typography>
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={d.paid}
                          onChange={(e) => updateDraft(i, { paid: e.target.checked })}
                        />
                      }
                      label={<Typography variant="caption">Paid</Typography>}
                      sx={{ ml: 0.5, mr: 0 }}
                    />
                    <Box sx={{ flex: 1 }} />
                    <IconButton
                      size="small"
                      aria-label={`Remove break ${i + 1}`}
                      onClick={() => removeDraft(i)}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                  {/* Preset chips — one tap to set a common value.
                      Selected state if the current value matches. */}
                  <Stack direction="row" spacing={0.5} sx={{ mt: 0.75 }}>
                    {PRESET_DURATIONS_MIN.map((p) => {
                      const selected = d.durationMins === p;
                      return (
                        <Chip
                          key={p}
                          size="small"
                          label={`${p}m`}
                          onClick={() => updateDraft(i, { durationMins: p })}
                          variant={selected ? 'filled' : 'outlined'}
                          color={selected ? 'primary' : 'default'}
                          sx={{
                            height: 22,
                            fontSize: 11,
                            fontWeight: selected ? 600 : 400,
                            cursor: 'pointer',
                          }}
                        />
                      );
                    })}
                  </Stack>
                  {liveError ? (
                    <Typography
                      variant="caption"
                      color="error"
                      sx={{ display: 'block', mt: 0.5 }}
                    >
                      {liveError}
                    </Typography>
                  ) : null}
                </Box>
              );
            })}
          </Stack>
        )}
        <Box sx={{ mt: 1.5, display: 'flex', justifyContent: 'space-between' }}>
          <Button size="small" startIcon={<AddIcon />} onClick={addDraft}>
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
