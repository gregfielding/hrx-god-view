/**
 * Phase D.1.1 — segmented progress bar for the per-worker collapsed row.
 *
 * Renders one horizontal bar with up to 5 colored segments proportional
 * to the worker's status family counts:
 *   - red    needs_review + complete_fail  (CSA-blocking)
 *   - yellow expired                       (worker-side, time-pressured)
 *   - blue   in_progress                   (vendor / system processing)
 *   - gray   incomplete + blocked          (waiting on worker)
 *   - green  complete_pass + complete      (done)
 *
 * `not_applicable` items are excluded from the denominator so the bar
 * represents "of the items that COULD be done, how many are."
 *
 * Visual encoding stays in lockstep with `WorkerCountChips` (same color
 * per family); changing the palette here without changing it there will
 * make the row read inconsistently.
 *
 * Pure presentational: no Firestore, no hooks beyond `useTheme`. Memoize
 * upstream if you're rendering thousands.
 */

import React from 'react';
import { Box, Tooltip, Typography, useTheme } from '@mui/material';

import type { WorkerGroupCounts } from '../../utils/readinessQueue';

interface ReadinessProgressBarProps {
  counts: WorkerGroupCounts;
  /** Total label rendered on the right (e.g. "3/9"). When omitted, only
   *  the segmented bar shows. */
  showLabel?: boolean;
  /** Width of the bar. Defaults to 100% of the parent (table cell). */
  width?: number | string;
  /** Bar height. 8px reads well in a dense table row. */
  height?: number;
}

const ReadinessProgressBar: React.FC<ReadinessProgressBarProps> = ({
  counts,
  showLabel = true,
  width = '100%',
  height = 8,
}) => {
  const theme = useTheme();

  // Denominator excludes N/A — see file header for rationale.
  const completed = counts.complete_pass + counts.complete;
  const inProgress = counts.in_progress;
  const incomplete = counts.incomplete + counts.blocked;
  const expired = counts.expired;
  const needsReview = counts.needs_review + counts.complete_fail;
  const denom = completed + inProgress + incomplete + expired + needsReview;

  // Defensive: a worker with only N/A items shows an empty (gray) bar
  // rather than a divide-by-zero or a fully-red one.
  if (denom === 0) {
    return (
      <Box sx={{ width, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box
          sx={{
            flex: 1,
            height,
            bgcolor: theme.palette.action.disabledBackground,
            borderRadius: height / 2,
          }}
        />
        {showLabel && (
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 32, textAlign: 'right' }}>
            —
          </Typography>
        )}
      </Box>
    );
  }

  const segments: Array<{
    family: string;
    count: number;
    color: string;
    label: string;
  }> = [
    {
      family: 'complete',
      count: completed,
      color: theme.palette.success.main,
      label: `${completed} complete`,
    },
    {
      family: 'in_progress',
      count: inProgress,
      color: theme.palette.info.main,
      label: `${inProgress} in progress`,
    },
    {
      family: 'expired',
      count: expired,
      color: theme.palette.warning.main,
      label: `${expired} expired`,
    },
    {
      family: 'needs_review',
      count: needsReview,
      color: theme.palette.error.main,
      label: `${needsReview} needs review`,
    },
    {
      family: 'incomplete',
      count: incomplete,
      // Subtle gray — most common segment for in-progress workers, so
      // the strong colors stay visually rare and signal-heavy.
      color: theme.palette.grey[400],
      label: `${incomplete} incomplete`,
    },
  ].filter((s) => s.count > 0);

  // Tooltip text — comma-joined non-zero segments, e.g.
  // "3 complete, 1 needs review, 5 incomplete (of 9)".
  const tooltip = `${segments.map((s) => s.label).join(', ')} (of ${denom})`;

  return (
    <Tooltip title={tooltip}>
      <Box sx={{ width, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box
          sx={{
            flex: 1,
            height,
            bgcolor: theme.palette.action.disabledBackground,
            borderRadius: height / 2,
            overflow: 'hidden',
            display: 'flex',
          }}
        >
          {segments.map((s) => (
            <Box
              key={s.family}
              sx={{
                width: `${(s.count / denom) * 100}%`,
                bgcolor: s.color,
                // First/last segments get rounded outer edges so the bar
                // looks like one capsule rather than a stack of squares.
                // Inner segments stay square — borderRadius on the parent
                // handles the visual rounding.
                transition: 'width 240ms ease',
              }}
            />
          ))}
        </Box>
        {showLabel && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
          >
            {completed}/{denom}
          </Typography>
        )}
      </Box>
    </Tooltip>
  );
};

export default ReadinessProgressBar;
