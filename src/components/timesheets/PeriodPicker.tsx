/**
 * PeriodPicker — pay-period selector for the timesheet workspace.
 *
 * Three behaviors driven by the entity's `payPeriodPolicy` (see
 * `src/types/recruiter/hiringEntity.ts`):
 *
 *   1. `policyType: 'weekly'` — "Week of [date]" with prev/next arrows.
 *      Defaults to the period containing today using the entity's
 *      `weekStartDOW` / `weekEndDOW` (Sun–Sat fallback if missing).
 *
 *   2. `policyType: 'per_event'` AND the page filter is scoped to a
 *      shift or job order — auto-populate from the scope's dates with a
 *      "Switch to manual" affordance. The page passes the resolved
 *      scope dates via `scopeAutoFill`. Once the user clicks "Switch to
 *      manual", we expose two date pickers and stop reacting to scope
 *      changes for the rest of the session.
 *
 *   3. `policyType: 'per_event'` AND no scope (entity-wide) — two
 *      manual date pickers, no auto-fill.
 *
 * If `payPeriodPolicy` is missing on the entity (legacy doc), behavior
 * defaults to weekly Sun–Sat with a small inline note. Don't block.
 *
 * Calls `onPeriodChange` with the resolved `PeriodRange` whenever the
 * user changes the period (arrows, manual date pickers, or the policy
 * itself changes due to entity switch). The page owns the filter state;
 * this component is controlled.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';

import type { HiringEntity } from '../../types/recruiter/hiringEntity';
import {
  type PeriodRange,
  currentWeeklyPeriod,
  shiftWeeklyPeriod,
  formatPeriodLabel,
  formatWeekOfLabel,
  isValidPeriod,
  parseYyyyMmDdLocal,
  dateToLocalYyyyMmDd,
  DEFAULT_WEEK_START_DOW,
  DEFAULT_WEEK_END_DOW,
} from '../../utils/timesheets/dateRange';
import { isAfter } from 'date-fns';

/**
 * Mirrors `Timesheets.tsx`'s `filterSelectSx` so the weekly Select reads
 * as one visual family with the Hiring Entity / Account / Job Order
 * dropdowns next to it. Duplicated rather than imported to keep the
 * component self-contained.
 */
const filterSelectSx = {
  height: 36,
  borderRadius: '6px',
  backgroundColor: 'white',
  fontSize: '0.875rem',
  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#E5E7EB' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#D1D5DB' },
} as const;

/** How many weeks back / forward to surface in the dropdown. Balanced
 *  for the typical payroll workflow: a few weeks back for close-outs,
 *  current week, and a small forward window for previewing the next
 *  pay run. 12 options total → a comfortable dropdown height. */
const WEEKS_BACK_IN_DROPDOWN = 8;
const WEEKS_FORWARD_IN_DROPDOWN = 3;

/**
 * Scope context the page passes when the user navigated here from a
 * specific shift or job order — used to auto-fill the period for
 * `per_event` entities. `null` means "entity-wide" (no scope).
 */
export type PeriodPickerScope =
  | null
  | {
      kind: 'shift' | 'jobOrder';
      refId: string;
      /** Resolved start/end of the scope (single date for a shift, or
       *  the JO's start/end). Null when not yet resolved. */
      autoFillPeriod: PeriodRange | null;
    };

export interface PeriodPickerProps {
  /** The currently selected entity. Required — caller gates rendering
   *  on entity selection so this is never null in practice. */
  entity: HiringEntity;
  /** Currently selected period (null when not yet picked). */
  value: PeriodRange | null;
  onChange: (period: PeriodRange | null) => void;
  /** Scope context if applicable (else `null`). */
  scope?: PeriodPickerScope;
}

type PolicyMode =
  | { kind: 'weekly'; weekStartDow: number; weekEndDow: number; isDefault: boolean }
  | { kind: 'per_event_scoped'; scope: NonNullable<PeriodPickerScope> }
  | { kind: 'per_event_manual' };

/** Resolve which UI mode to render given the entity's policy + scope. */
function resolvePolicyMode(
  entity: HiringEntity,
  scope: PeriodPickerScope,
  manualOverride: boolean,
): PolicyMode {
  const policy = entity.payPeriodPolicy;
  // Legacy doc / missing policy → default to weekly Sun-Sat with banner.
  if (!policy) {
    return {
      kind: 'weekly',
      weekStartDow: DEFAULT_WEEK_START_DOW,
      weekEndDow: DEFAULT_WEEK_END_DOW,
      isDefault: true,
    };
  }

  if (policy.policyType === 'weekly') {
    return {
      kind: 'weekly',
      weekStartDow: policy.weekStartDOW ?? DEFAULT_WEEK_START_DOW,
      weekEndDow: policy.weekEndDOW ?? DEFAULT_WEEK_END_DOW,
      isDefault: false,
    };
  }

  // per_event
  if (scope && scope.kind && !manualOverride) {
    return { kind: 'per_event_scoped', scope };
  }
  return { kind: 'per_event_manual' };
}

export const PeriodPicker: React.FC<PeriodPickerProps> = ({
  entity,
  value,
  onChange,
  scope = null,
}) => {
  const [manualOverride, setManualOverride] = useState(false);

  /**
   * Per_event manual mode holds its date pickers' partial state
   * locally so we don't surface a half-filled period to the parent.
   * Without this, a user picking only a start date would silently
   * commit `{start, end: start}` and trigger the grid to load a
   * one-day period — a confusing footgun. The parent only sees a
   * non-null period after BOTH endpoints are filled and validated.
   *
   * Seeded from `value` whenever the parent's value changes (e.g.
   * the user navigated here with a deep link). When the user clears
   * one picker, `onChange(null)` fires and the grid re-gates back to
   * the empty state — same UX as if they hadn't selected anything.
   */
  const [manualStartDate, setManualStartDate] = useState<Date | null>(
    value ? parseYyyyMmDdLocal(value.start) : null,
  );
  const [manualEndDate, setManualEndDate] = useState<Date | null>(
    value ? parseYyyyMmDdLocal(value.end) : null,
  );

  // Reset the manual-override flag whenever the entity changes — a new
  // entity may switch back to a weekly policy where the override is
  // meaningless. Also reset the local manual-mode state so we don't
  // leak the previous entity's half-typed dates.
  useEffect(() => {
    setManualOverride(false);
    setManualStartDate(null);
    setManualEndDate(null);
  }, [entity.id]);

  // Sync local manual state when the parent's value changes from
  // outside (e.g. scoped → manual switch with a pre-resolved scope, or
  // a deep link populating both dates). Only reseed when the parent
  // value is non-null; clearing the parent shouldn't wipe the user's
  // in-progress local entry.
  useEffect(() => {
    if (!value) return;
    setManualStartDate(parseYyyyMmDdLocal(value.start));
    setManualEndDate(parseYyyyMmDdLocal(value.end));
  }, [value]);

  const mode = useMemo(
    () => resolvePolicyMode(entity, scope, manualOverride),
    [entity, scope, manualOverride],
  );

  /* -------------------------------------------------------------------
   * Initial value resolution
   *
   * When the picker mounts (or when `mode` flips), seed `value` if it's
   * unset. The page also listens for this via `onChange`, so the parent
   * filter state stays in sync.
   * ------------------------------------------------------------------- */
  useEffect(() => {
    if (value) return;
    if (mode.kind === 'weekly') {
      onChange(currentWeeklyPeriod(mode.weekStartDow, mode.weekEndDow));
    } else if (mode.kind === 'per_event_scoped' && mode.scope.autoFillPeriod) {
      onChange(mode.scope.autoFillPeriod);
    }
    // per_event_manual → leave null until the user picks dates manually
    // (the date pickers below render placeholders).
  }, [mode, value, onChange]);

  // When the scope auto-fill changes (e.g. shift loaded after entity
  // selection), refresh `value` if we're in scoped mode and the user
  // hasn't manually overridden.
  useEffect(() => {
    if (mode.kind !== 'per_event_scoped') return;
    if (!mode.scope.autoFillPeriod) return;
    // Only update if it actually changed — avoids cascading effects.
    if (
      value?.start === mode.scope.autoFillPeriod.start &&
      value?.end === mode.scope.autoFillPeriod.end
    ) {
      return;
    }
    onChange(mode.scope.autoFillPeriod);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally
    // not including `value` to prevent loops when value changes via
    // other pathways (manual switch, entity change, etc.).
  }, [mode]);

  /* -------------------------------------------------------------------
   * Weekly policy controls — dropdown variant
   *
   * The dropdown lists a sliding window of weeks centered on the
   * current week (per the entity's `weekStartDOW` / `weekEndDOW`).
   *
   * Edge case: if the user is viewing a period OUTSIDE the window
   * (e.g. a deep-link from way back), we transparently splice it into
   * the option list so the Select can still render its current value.
   * Without this, MUI logs an "out-of-range value" warning and the
   * field shows blank.
   * ------------------------------------------------------------------- */
  const weeklyOptions = useMemo(() => {
    if (mode.kind !== 'weekly') return [];
    const currentWeek = currentWeeklyPeriod(mode.weekStartDow, mode.weekEndDow);
    const windowed: PeriodRange[] = [];
    // Sliding window: oldest first so the dropdown reads top-down
    // "older → newer" (matches how recruiters scan a week list).
    for (
      let delta = -WEEKS_BACK_IN_DROPDOWN;
      delta <= WEEKS_FORWARD_IN_DROPDOWN;
      delta++
    ) {
      windowed.push(shiftWeeklyPeriod(currentWeek, delta));
    }
    // Splice in the active value if it's outside the window. Maintains
    // the "older → newer" sort order using lexicographic comparison on
    // `start` (safe because YYYY-MM-DD is zero-padded).
    if (value && !windowed.some((p) => p.start === value.start)) {
      const merged = [...windowed, value].sort((a, b) =>
        a.start < b.start ? -1 : a.start > b.start ? 1 : 0,
      );
      return merged;
    }
    return windowed;
  }, [mode, value]);

  const currentWeekStart = useMemo(() => {
    if (mode.kind !== 'weekly') return null;
    return currentWeeklyPeriod(mode.weekStartDow, mode.weekEndDow).start;
  }, [mode]);

  const handleWeeklySelect = (startIso: string) => {
    const next = weeklyOptions.find((p) => p.start === startIso);
    if (next) onChange(next);
  };

  /* -------------------------------------------------------------------
   * Manual date picker controls
   *
   * Strategy: track partial state locally; only emit `onChange(period)`
   * to the parent when both pickers have valid, non-inverted dates.
   * Clearing either picker emits `onChange(null)` so the grid re-gates
   * to the empty state — same as if the user hadn't picked anything.
   *
   * Inverted ranges (end < start) emit `onChange(null)` and rely on
   * the inline validation message to nudge the user. We deliberately
   * don't auto-snap because that masks the misclick — the user typed
   * a date, we should respect it and show why nothing's loading.
   * ------------------------------------------------------------------- */
  const commitManual = useCallback(
    (start: Date | null, end: Date | null) => {
      if (!start || !end) {
        if (value !== null) onChange(null);
        return;
      }
      if (isAfter(start, end)) {
        // Inverted — surface the validation but don't load a phantom
        // one-day period.
        if (value !== null) onChange(null);
        return;
      }
      const startIso = dateToLocalYyyyMmDd(start);
      const endIso = dateToLocalYyyyMmDd(end);
      if (!startIso || !endIso) {
        if (value !== null) onChange(null);
        return;
      }
      const next: PeriodRange = { start: startIso, end: endIso };
      if (!isValidPeriod(next)) {
        if (value !== null) onChange(null);
        return;
      }
      // Only emit when something actually changed — avoids re-render
      // loops with the parent's filter useMemo.
      if (
        value &&
        value.start === next.start &&
        value.end === next.end
      ) {
        return;
      }
      onChange(next);
    },
    [onChange, value],
  );

  const handleManualStartChange = (newStart: Date | null) => {
    setManualStartDate(newStart);
    commitManual(newStart, manualEndDate);
  };
  const handleManualEndChange = (newEnd: Date | null) => {
    setManualEndDate(newEnd);
    commitManual(manualStartDate, newEnd);
  };

  /** True when either picker is empty OR the range is inverted. Drives
   *  both the inline "select both dates" hint and the date pickers'
   *  error styling. */
  const manualValidationMessage = useMemo(() => {
    if (mode.kind !== 'per_event_manual') return null;
    if (!manualStartDate && !manualEndDate) {
      return 'Select a start and end date to load timesheets.';
    }
    if (!manualStartDate) return 'Select a start date.';
    if (!manualEndDate) return 'Select an end date.';
    if (isAfter(manualStartDate, manualEndDate)) {
      return 'End date must be on or after start date.';
    }
    return null;
  }, [mode.kind, manualStartDate, manualEndDate]);

  /* -------------------------------------------------------------------
   * Render
   * ------------------------------------------------------------------- */
  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Stack spacing={1}>
        {mode.kind === 'weekly' ? (
          <FormControl size="small" sx={{ minWidth: 240, height: 36 }}>
            <InputLabel shrink sx={{ fontSize: '0.875rem' }}>
              Week
            </InputLabel>
            <Select
              value={value?.start ?? ''}
              onChange={(e) => handleWeeklySelect(String(e.target.value))}
              label="Week"
              notched
              displayEmpty
              sx={filterSelectSx}
              renderValue={(val) => {
                if (!val) {
                  return (
                    <Typography
                      component="span"
                      sx={{ fontSize: '0.875rem', color: 'text.disabled' }}
                    >
                      Loading…
                    </Typography>
                  );
                }
                const selected =
                  weeklyOptions.find((p) => p.start === val) ??
                  (value && value.start === val ? value : null);
                if (!selected) return String(val);
                const isCurrent = selected.start === currentWeekStart;
                // Single-line label so the Select hugs the canonical
                // 36px filter height — the MenuItem subtitle still
                // shows the full date range when expanded.
                return (
                  <Typography
                    component="span"
                    sx={{
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {formatWeekOfLabel(selected)}
                    {isCurrent ? ' · This week' : ''}
                  </Typography>
                );
              }}
            >
              {weeklyOptions.map((p) => {
                const isCurrent = p.start === currentWeekStart;
                return (
                  <MenuItem key={p.start} value={p.start}>
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        py: 0.25,
                      }}
                    >
                      <Typography
                        component="span"
                        sx={{
                          fontSize: '0.875rem',
                          fontWeight: isCurrent ? 700 : 500,
                        }}
                      >
                        {formatWeekOfLabel(p)}
                        {isCurrent ? ' · This week' : ''}
                      </Typography>
                      <Typography
                        component="span"
                        sx={{
                          fontSize: '0.75rem',
                          color: 'text.secondary',
                        }}
                      >
                        {formatPeriodLabel(p)}
                      </Typography>
                    </Box>
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
        ) : null}

        {mode.kind === 'per_event_scoped' ? (
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box
              sx={{
                px: 1.5,
                py: 0.75,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                minWidth: 240,
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {mode.scope.kind === 'shift' ? 'Shift period' : 'Job order period'}
              </Typography>
              <Typography variant="body2" fontWeight={600}>
                {value ? formatPeriodLabel(value) : 'Resolving scope…'}
              </Typography>
            </Box>
            <Button
              size="small"
              variant="text"
              onClick={() => setManualOverride(true)}
            >
              Switch to manual
            </Button>
          </Stack>
        ) : null}

        {mode.kind === 'per_event_manual' ? (
          <Stack spacing={1}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <DatePicker
                label="Start date"
                value={manualStartDate}
                onChange={handleManualStartChange}
                slotProps={{
                  textField: {
                    size: 'small',
                    required: true,
                    error: Boolean(manualValidationMessage) && !manualStartDate,
                  },
                }}
              />
              <Typography variant="body2" color="text.secondary">
                –
              </Typography>
              <DatePicker
                label="End date"
                value={manualEndDate}
                onChange={handleManualEndChange}
                minDate={manualStartDate ?? undefined}
                slotProps={{
                  textField: {
                    size: 'small',
                    required: true,
                    error:
                      Boolean(manualValidationMessage) &&
                      (!manualEndDate ||
                        Boolean(
                          manualStartDate &&
                            manualEndDate &&
                            isAfter(manualStartDate, manualEndDate),
                        )),
                  },
                }}
              />
            </Stack>
            {manualValidationMessage ? (
              <Typography variant="caption" color="text.secondary">
                {manualValidationMessage}
              </Typography>
            ) : null}
          </Stack>
        ) : null}

        {/* The "Using default Sun–Sat week" advisory used to render here
            when the entity had no `payPeriodPolicy`. Removed per UX
            cleanup — most production entities still don't have an
            explicit policy and the banner just added noise to the
            filter row. The fallback behavior (Sun–Sat) is unchanged. */}
      </Stack>
    </LocalizationProvider>
  );
};

export default PeriodPicker;
