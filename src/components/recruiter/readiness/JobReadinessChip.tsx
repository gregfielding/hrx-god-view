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
import { Box, Chip, CircularProgress, Popover, Tooltip, Typography } from '@mui/material';
import type { ChipProps } from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';

import type {
  JobReadinessChipContribution,
  JobReadinessChipContributor,
  JobReadinessChipData,
  JobReadinessChipState,
} from '../../../shared/jobReadinessChip/types';
import JobReadinessChipPopover from './JobReadinessChipPopover';

const TOOLTIP_TIER_COLOR: Record<JobReadinessChipContribution, string> = {
  red: '#ff8a80',
  yellow: '#ffd180',
  green: '#b9f6ca',
};

/**
 * Build the hover-tooltip body listing what's missing on this chip.
 * Mirrors the popover's tier-sorted list at a glance density — designed
 * to be readable without committing to clicking the chip. Shows the top
 * outstanding items so the recruiter can scan multiple tiles quickly.
 */
function buildJobReadinessTooltip(data: JobReadinessChipData): React.ReactNode {
  if (data.state === 'computing') {
    return (
      <Typography variant="caption" sx={{ color: '#fff' }}>
        Job Ready (computing…)
      </Typography>
    );
  }
  if (data.state === 'legacy_review') {
    return (
      <Typography variant="caption" sx={{ color: '#fff' }}>
        Legacy assignment — predates the readiness rebuild.
      </Typography>
    );
  }
  const outstanding = data.contributors.filter(
    (c) => c.contribution !== 'green',
  );
  if (outstanding.length === 0) {
    return (
      <Typography variant="caption" sx={{ color: '#fff' }}>
        {data.text} — nothing outstanding.
      </Typography>
    );
  }
  const SHOWN = 8;
  const head = outstanding.slice(0, SHOWN);
  return (
    <Box sx={{ maxWidth: 320 }}>
      <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, color: '#fff', mb: 0.5 }}>
        {data.text}
      </Typography>
      <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, color: '#fff' }}>
        {data.blockerCount} blocking · {data.pendingCount} pending
      </Typography>
      <Box component="ul" sx={{ pl: 2, m: 0, color: '#fff' }}>
        {head.map((c) => (
          <Typography
            key={`${c.source}:${c.itemId}`}
            component="li"
            variant="caption"
            sx={{ color: '#fff', lineHeight: 1.35 }}
          >
            <Box
              component="span"
              sx={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: TOOLTIP_TIER_COLOR[c.contribution],
                mr: 0.75,
                verticalAlign: 'middle',
              }}
            />
            {c.requirementLabel}
            {c.detail ? (
              <Typography
                component="span"
                variant="caption"
                sx={{ color: '#fff', opacity: 0.85, ml: 0.5 }}
              >
                — {c.detail}
              </Typography>
            ) : null}
          </Typography>
        ))}
        {outstanding.length > SHOWN && (
          <Typography
            component="li"
            variant="caption"
            sx={{ color: '#fff', fontStyle: 'italic' }}
          >
            + {outstanding.length - SHOWN} more…
          </Typography>
        )}
      </Box>
    </Box>
  );
}

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
    // R.4.3 — `'legacy_review'` shares the gray `'default'` MUI color
    // with `'computing'`, but the icon + label distinguish them
    // visually (history icon vs spinner; "Legacy — needs review" vs
    // "Job Ready (computing…)"). Gray was a deliberate Greg-lock to
    // avoid conflating "in-flight processing" (yellow spinner) with
    // "predates our system" (gray history) — distinct color is the
    // whole point of adding the new state.
    case 'legacy_review':
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
      // Sized to match `placementActionChipSx` / `placementQualChipSx`
      // in `PlacementsTab.tsx` so the placement tile's bottom row
      // (Onboarding / Confirmed / Job Readiness) reads as one
      // consistent chip strip.
      return {
        height: 20,
        fontWeight: 600,
        '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' },
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
  //
  // R.4.3 — `'legacy_review'` swaps the spinner for a history icon: the
  // assignment isn't *processing*, it predates the rebuild. Same gray
  // chip color as `'computing'` but the icon makes the semantic obvious.
  let startIcon: React.ReactElement | undefined;
  if (effective.state === 'computing') {
    startIcon = (
      <CircularProgress size={10} thickness={5} sx={{ ml: 0.5, color: 'text.secondary' }} />
    );
  } else if (effective.state === 'legacy_review') {
    startIcon = (
      <HistoryIcon
        fontSize="small"
        sx={{ ml: 0.25, fontSize: '0.95rem', color: 'text.secondary' }}
      />
    );
  }

  // Hover surfaces a quick "what's missing" Tooltip; click opens the
  // detailed Popover with clickable contributor rows for drill-in.
  // (Hover-popover was the original interaction; we split tooltip vs.
  // popover so a recruiter can scan tiles at a glance without losing
  // the drill-in path.)
  const tooltipBody = useMemo(() => buildJobReadinessTooltip(effective), [effective]);

  return (
    <>
      <Tooltip
        title={tooltipBody}
        placement="top"
        enterDelay={150}
        enterNextDelay={150}
        slotProps={{ tooltip: { sx: { p: 1, maxWidth: 360 } } }}
      >
        <Box
          ref={anchorRef}
          component="span"
          onClick={handleOpen}
          onFocus={handleOpen}
          onBlur={handleClose}
          sx={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
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
      </Tooltip>
      <Popover
        open={popoverOpen}
        anchorEl={anchorRef.current}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        disableRestoreFocus
        slotProps={{
          paper: {
            sx: { p: 1.25, maxWidth: 360, minWidth: 240 },
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
