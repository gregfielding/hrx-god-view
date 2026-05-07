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

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
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

  // Reset the manual-override flag whenever the entity changes — a new
  // entity may switch back to a weekly policy where the override is
  // meaningless.
  useEffect(() => {
    setManualOverride(false);
  }, [entity.id]);

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
   * Weekly policy controls
   * ------------------------------------------------------------------- */
  const handlePrevWeek = () => {
    if (mode.kind !== 'weekly' || !value) return;
    onChange(shiftWeeklyPeriod(value, -1));
  };
  const handleNextWeek = () => {
    if (mode.kind !== 'weekly' || !value) return;
    onChange(shiftWeeklyPeriod(value, 1));
  };
  const handleResetToCurrentWeek = () => {
    if (mode.kind !== 'weekly') return;
    onChange(currentWeeklyPeriod(mode.weekStartDow, mode.weekEndDow));
  };

  /* -------------------------------------------------------------------
   * Manual date picker controls
   * ------------------------------------------------------------------- */
  const handleManualStartChange = (newStart: Date | null) => {
    const startIso = dateToLocalYyyyMmDd(newStart);
    if (!startIso) return;
    const next: PeriodRange = {
      start: startIso,
      end: value?.end ?? startIso,
    };
    if (isValidPeriod(next)) {
      onChange(next);
    } else {
      // If the user picked a start AFTER the current end, snap end to
      // start so the period stays valid.
      onChange({ start: startIso, end: startIso });
    }
  };
  const handleManualEndChange = (newEnd: Date | null) => {
    const endIso = dateToLocalYyyyMmDd(newEnd);
    if (!endIso) return;
    const next: PeriodRange = {
      start: value?.start ?? endIso,
      end: endIso,
    };
    if (isValidPeriod(next)) {
      onChange(next);
    } else {
      // End before start — snap start to end for a single-day period.
      onChange({ start: endIso, end: endIso });
    }
  };

  /* -------------------------------------------------------------------
   * Render
   * ------------------------------------------------------------------- */
  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Stack spacing={1}>
        {mode.kind === 'weekly' ? (
          <Stack direction="row" alignItems="center" spacing={1}>
            <Tooltip title="Previous week">
              <span>
                <IconButton
                  size="small"
                  onClick={handlePrevWeek}
                  disabled={!value}
                  aria-label="Previous week"
                >
                  <ChevronLeftIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Box
              sx={{
                px: 1.5,
                py: 0.75,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                minWidth: 220,
                textAlign: 'center',
              }}
            >
              <Typography variant="body2" fontWeight={600}>
                {value ? formatWeekOfLabel(value) : 'Loading…'}
              </Typography>
              {value ? (
                <Typography variant="caption" color="text.secondary">
                  {formatPeriodLabel(value)}
                </Typography>
              ) : null}
            </Box>
            <Tooltip title="Next week">
              <span>
                <IconButton
                  size="small"
                  onClick={handleNextWeek}
                  disabled={!value}
                  aria-label="Next week"
                >
                  <ChevronRightIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Jump to current week">
              <span>
                <IconButton
                  size="small"
                  onClick={handleResetToCurrentWeek}
                  aria-label="Current week"
                >
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
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
          <Stack direction="row" alignItems="center" spacing={1}>
            <DatePicker
              label="Start date"
              value={value ? parseYyyyMmDdLocal(value.start) : null}
              onChange={handleManualStartChange}
              slotProps={{ textField: { size: 'small' } }}
            />
            <Typography variant="body2" color="text.secondary">
              –
            </Typography>
            <DatePicker
              label="End date"
              value={value ? parseYyyyMmDdLocal(value.end) : null}
              onChange={handleManualEndChange}
              slotProps={{ textField: { size: 'small' } }}
            />
          </Stack>
        ) : null}

        {mode.kind === 'weekly' && mode.isDefault ? (
          <Alert severity="info" sx={{ py: 0.5 }}>
            Using default Sun–Sat week. Set <code>payPeriodPolicy</code> on
            this hiring entity to customize.
          </Alert>
        ) : null}
      </Stack>
    </LocalizationProvider>
  );
};

export default PeriodPicker;
