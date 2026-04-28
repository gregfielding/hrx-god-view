/**
 * **R.4** — `JobReadinessChipPopover` — hover/click breakdown for the
 * Job Readiness chip.
 *
 * Renders a sorted list of contributors (red \u2192 yellow \u2192 green) with:
 *   - a coloured tier dot
 *   - the requirement label
 *   - the popover-friendly detail string (e.g. "Needs review",
 *     "Worker has not answered yet")
 *
 * Each row is clickable; the parent chip wires these up to the worker's
 * Readiness tab (R.7) filtered to the contributor's item.
 *
 * Pure presentation — no state, no fetches.
 *
 * @see ./JobReadinessChip.tsx (the host)
 */

import React from 'react';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';

import type {
  JobReadinessChipContribution,
  JobReadinessChipContributor,
  JobReadinessChipData,
} from '../../../shared/jobReadinessChip/types';

export interface JobReadinessChipPopoverProps {
  data: JobReadinessChipData;
  onItemClick?: (contributor: JobReadinessChipContributor) => void;
}

const TIER_COLOR: Record<JobReadinessChipContribution, string> = {
  red: '#d32f2f',
  yellow: '#ed6c02',
  green: '#2e7d32',
};

const TIER_LABEL: Record<JobReadinessChipContribution, string> = {
  red: 'Blocker',
  yellow: 'Pending',
  green: 'Satisfied',
};

const JobReadinessChipPopover: React.FC<JobReadinessChipPopoverProps> = ({ data, onItemClick }) => {
  // Empty case — chip is either 'computing', orphan red, or (R.4.3)
  // 'legacy_review'. Show a hint so the user understands why the popover
  // has no rows.
  if (data.contributors.length === 0) {
    if (data.state === 'computing') {
      return (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Readiness is still being computed for this assignment.
        </Typography>
      );
    }
    if (data.state === 'legacy_review') {
      // R.4.3 — surface the legacy state explicitly so operators don't
      // chase a missing-data ghost. Action: backfill or contact ops.
      // No "trigger backfill" button here — R.4.2 isn't shipped yet.
      return (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          This assignment predates the readiness rebuild (R.1). Run R.4.2-style
          backfill or contact ops.
        </Typography>
      );
    }
    if (data.state === 'red') {
      return (
        <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 600 }}>
          Readiness has not been computed for this assignment. Re-seed from the recruiter
          actions menu.
        </Typography>
      );
    }
    // Green with no contributors — degenerate but valid (e.g. all not_applicable).
    return (
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        No outstanding readiness items.
      </Typography>
    );
  }

  return (
    <Stack spacing={0.5}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          mb: 0.25,
          pb: 0.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          Job Readiness breakdown
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {data.blockerCount} blocking · {data.pendingCount} pending
        </Typography>
      </Box>
      {data.contributors.map((c) => {
        const color = TIER_COLOR[c.contribution];
        const tierLabel = TIER_LABEL[c.contribution];
        const interactive = Boolean(onItemClick);
        const handleClick = () => {
          if (interactive) onItemClick?.(c);
        };
        return (
          <ButtonBase
            key={`${c.source}:${c.itemId}`}
            onClick={handleClick}
            disabled={!interactive}
            disableRipple={!interactive}
            sx={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              borderRadius: 1,
              px: 0.75,
              py: 0.4,
              cursor: interactive ? 'pointer' : 'default',
              '&:hover': interactive ? { backgroundColor: 'action.hover' } : undefined,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
              <Box
                aria-label={tierLabel}
                sx={{
                  flexShrink: 0,
                  mt: '5px',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: color,
                }}
              />
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.primary' }}>
                  {c.requirementLabel}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ display: 'block', color: 'text.secondary', lineHeight: 1.3 }}
                >
                  {c.detail}
                </Typography>
              </Box>
            </Box>
          </ButtonBase>
        );
      })}
    </Stack>
  );
};

export default JobReadinessChipPopover;
