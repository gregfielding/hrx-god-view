/**
 * Compact readiness chip for Workforce tab rows — Phase 5 of
 * `docs/WORKFORCE_DOMAIN_MODEL.md`.
 *
 * Reads `users.{uid}.workerReadinessV1.overallWorkerState` — the same
 * canonical state that drives the full-page banner on the worker's
 * profile (see `workerReadinessBannerModel.ts`). This chip condenses
 * that state into a single compact pill so the Workforce tab can surface
 * readiness without a separate fetch or recomputation.
 *
 * Read-only projection — the chip never writes. Its job is to let a
 * recruiter scan a row and know "can this worker actually go to work
 * tomorrow?" in one glance.
 */

import React from 'react';
import { Chip, Tooltip } from '@mui/material';

import type { WorkerState } from '../../types/workforceStateV1';

export interface WorkforceReadinessChipProps {
  state: WorkerState | null | undefined;
  /** Optional override for when the state is unknown (e.g. user doc hadn't loaded yet). */
  unknownLabel?: string;
  /** When true, render as a dot-sized icon with the label in a tooltip (for dense tables). */
  dense?: boolean;
}

type Severity = 'success' | 'info' | 'warning' | 'error' | 'default';

/**
 * Short label for the chip itself. Kept one or two words so the pill
 * stays narrow; tooltip carries the longer explanation.
 */
function chipLabelForState(state: WorkerState | null | undefined): string {
  switch (state) {
    case 'active':
      return 'Ready';
    case 'ready_for_placement':
      return 'Ready';
    case 'onboarding_in_progress':
      return 'Onboarding';
    case 'profile_incomplete':
      return 'Profile';
    case 'blocked':
      return 'Blocked';
    case 'inactive':
      return 'Inactive';
    case 'terminated':
      return 'Terminated';
    case 'applicant':
      return 'Applicant';
    default:
      return '—';
  }
}

/** Color band — mirrors the banner model's severity scale. */
function chipSeverityForState(state: WorkerState | null | undefined): Severity {
  switch (state) {
    case 'active':
    case 'ready_for_placement':
      return 'success';
    case 'onboarding_in_progress':
    case 'profile_incomplete':
      return 'warning';
    case 'blocked':
    case 'terminated':
      return 'error';
    case 'inactive':
    case 'applicant':
      return 'info';
    default:
      return 'default';
  }
}

/** Explanation shown in the tooltip — a bit more actionable than the label. */
function tooltipForState(state: WorkerState | null | undefined): string {
  switch (state) {
    case 'active':
      return 'Ready and currently working';
    case 'ready_for_placement':
      return 'Onboarding complete — ready for assignment';
    case 'onboarding_in_progress':
      return 'Onboarding in progress';
    case 'profile_incomplete':
      return 'Worker profile has incomplete fields';
    case 'blocked':
      return 'Blocked — profile gate or policy issue';
    case 'inactive':
      return 'Not currently placed; last assignment inactive';
    case 'terminated':
      return 'Employment terminated — not eligible';
    case 'applicant':
      return 'Applicant — has not completed onboarding';
    default:
      return 'Readiness state unknown';
  }
}

const WorkforceReadinessChip: React.FC<WorkforceReadinessChipProps> = ({
  state,
  unknownLabel,
  dense,
}) => {
  const resolvedLabel = state ? chipLabelForState(state) : unknownLabel ?? '—';
  const severity = chipSeverityForState(state);
  const title = tooltipForState(state);

  return (
    <Tooltip title={title} arrow>
      <Chip
        label={resolvedLabel}
        size="small"
        color={severity === 'default' ? undefined : severity}
        variant={severity === 'default' ? 'outlined' : 'filled'}
        sx={
          dense
            ? {
                height: 20,
                fontSize: '0.7rem',
                fontWeight: 600,
                '& .MuiChip-label': { px: 0.75 },
              }
            : {
                fontWeight: 500,
              }
        }
      />
    </Tooltip>
  );
};

export default WorkforceReadinessChip;
