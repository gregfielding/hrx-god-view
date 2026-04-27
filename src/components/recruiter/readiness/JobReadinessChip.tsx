/**
 * **R.4** — `JobReadinessChip` — per-(worker × shift) Job Readiness chip.
 *
 * Reads pre-computed chip data (`JobReadinessChipData`) from the persisted
 * `readinessSnapshotV1.jobReadinessChip` field — see
 * `docs/READINESS_R4_HANDOFF.md` for the data flow. The chip itself is
 * pure presentation: no fetches, no computations, no side effects other
 * than firing the `onItemClick` drill-in callback.
 *
 * Three size variants — the same component is reused on:
 *   - **placement tiles**     (R.4)   — `size="sm"`
 *   - **worker view header**  (R.7)   — `size="lg"`
 *   - **CSA cross-worker matrix** (R.8) — `size="inline"`
 *
 * Hover (or focus) opens a `JobReadinessChipPopover` listing contributors
 * sorted red \u2192 yellow \u2192 green; clicking a row fires `onItemClick`
 * so the parent can drill into that worker's Readiness tab.
 *
 * @see ../../shared/jobReadinessChip/computeJobReadinessChip.ts (the aggregator)
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Box, Chip, CircularProgress, Popover, Typography } from '@mui/material';
import type { ChipProps } from '@mui/material';

import type {
  JobReadinessChipContributor,
  JobReadinessChipData,
  JobReadinessChipState,
} from '../../../shared/jobReadinessChip/types';
import JobReadinessChipPopover from './JobReadinessChipPopover';

export type JobReadinessChipSize = 'sm' | 'lg' | 'inline';

export interface JobReadinessChipProps {
  /**
   * Chip data, normally read off `readinessSnapshotV1.jobReadinessChip`.
   * Pass `null` / `undefined` when the snapshot hasn't loaded yet — the
   * chip renders the `'computing'` initial state in that case (matches
   * the spec's "Job Ready (computing\u2026)" first-render text).
   */
  data: JobReadinessChipData | null | undefined;
  /** Size variant. Drives padding, font-size, density. */
  size?: JobReadinessChipSize;
  /**
   * Drill-in handler. Fired when a contributor row is clicked in the
   * popover. Parent decides routing — for placement tiles this is usually
   * a router push to the worker's Readiness tab, for the worker header
   * this might scroll within the same page.
   */
  onItemClick?: (contributor: JobReadinessChipContributor) => void;
  /**
   * When provided, replaces the default popover header. Lets the worker
   * header surface include the worker's name without re-fetching it on
   * the chip side.
   */
  popoverTitle?: string;
}

type ChipColor = NonNullable<ChipProps['color']>;

function chipColorForState(state: JobReadinessChipState): ChipColor {
  switch (state) {
    case 'green':
      return 'success';
    case 'yellow':
      return 'warning';
    case 'red':
      return 'error';
    case 'computing':
    default:
      return 'default';
  }
}

/**
 * Small MUI sizing matrix — kept here (not in a theme override) because
 * R.4 is the only component using `inline`. Numbers cribbed from the
 * existing `WorkforceReadinessChip` `dense` mode and the spec's "many
 * small chips at scale" / "large prominent chip" requirement.
 */
function chipSx(size: JobReadinessChipSize) {
  switch (size) {
    case 'lg':
      return {
        height: 32,
        fontSize: '0.875rem',
        fontWeight: 600,
        '& .MuiChip-label': { px: 1.25 },
      } as const;
    case 'inline':
      return {
        height: 20,
        fontSize: '0.7rem',
        fontWeight: 500,
        '& .MuiChip-label': { px: 0.75 },
        borderRadius: '6px',
      } as const;
    case 'sm':
    default:
      return {
        height: 22,
        fontSize: '0.72rem',
        fontWeight: 600,
        '& .MuiChip-label': { px: 0.75 },
      } as const;
  }
}

function fallbackComputingData(): JobReadinessChipData {
  return {
    state: 'computing',
    text: 'Job Ready (computing\u2026)',
    pendingCount: 0,
    blockerCount: 0,
    contributors: [],
  };
}

const JobReadinessChip: React.FC<JobReadinessChipProps> = ({
  data,
  size = 'sm',
  onItemClick,
  popoverTitle,
}) => {
  const effective = useMemo(() => data ?? fallbackComputingData(), [data]);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const handleOpen = useCallback(() => setPopoverOpen(true), []);
  const handleClose = useCallback(() => setPopoverOpen(false), []);

  const handleItemClick = useCallback(
    (c: JobReadinessChipContributor) => {
      onItemClick?.(c);
      // Close the popover once the parent has handled routing — keeps
      // the click feel snappy and avoids the popover staying open after
      // a tab switch when the chip lives in a now-stale tile.
      setPopoverOpen(false);
    },
    [onItemClick],
  );

  const color = chipColorForState(effective.state);
  const sxOverrides = chipSx(size);

  // The 'computing' state shows a tiny spinner inside the chip so the user
  // sees activity without us claiming a green/yellow/red. Per spec wording
  // the LABEL still says "Job Ready (computing\u2026)" — we don't replace it
  // entirely with a spinner.
  const startIcon =
    effective.state === 'computing' ? (
      <CircularProgress size={10} thickness={5} sx={{ ml: 0.5, color: 'text.secondary' }} />
    ) : undefined;

  return (
    <>
      <Box
        ref={anchorRef}
        component="span"
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
        onClick={handleOpen}
        onFocus={handleOpen}
        onBlur={handleClose}
        sx={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
        // Keyboard accessibility — Enter/Space toggles the popover for
        // users who tab through the placement tile.
        tabIndex={0}
        role="button"
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        aria-label={effective.text}
      >
        <Chip
          icon={startIcon}
          label={effective.text}
          color={color}
          size="small"
          variant={effective.state === 'green' ? 'filled' : 'outlined'}
          sx={sxOverrides}
        />
      </Box>
      <Popover
        open={popoverOpen}
        anchorEl={anchorRef.current}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        // Mouse-leave on the chip closes the popover; the popover doesn't
        // intercept pointer events itself, so users can still hover into
        // the popover content to click on a contributor.
        disableRestoreFocus
        slotProps={{
          paper: {
            sx: { p: 1.25, maxWidth: 360, minWidth: 240 },
            // Allow hovering INTO the popover without it closing.
            onMouseEnter: handleOpen,
            onMouseLeave: handleClose,
          },
        }}
      >
        {popoverTitle && (
          <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, mb: 0.5 }}>
            {popoverTitle}
          </Typography>
        )}
        <JobReadinessChipPopover data={effective} onItemClick={handleItemClick} />
      </Popover>
    </>
  );
};

export default JobReadinessChip;
