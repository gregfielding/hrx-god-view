/**
 * Phase D.1.1 — compact count chips for the per-worker collapsed row.
 *
 * Renders 1-3 small badge chips indicating non-zero status families:
 *   - red   needs_review + complete_fail  (CSA-blocking)
 *   - yellow expired                      (yellow)
 *   - gray  incomplete + blocked          (waiting on worker — most common)
 *
 * Skips zero-count families (spec §2: "Skip chips with count 0"). Skips
 * `complete` because the progress bar already encodes it. Skips
 * `in_progress` because most CSAs don't act on items in that state.
 * Skips `not_applicable` entirely.
 *
 * Visual coupling with `ReadinessProgressBar`: same colors per family.
 */

import React from 'react';
import { Box, Tooltip } from '@mui/material';

import type { WorkerGroupCounts } from '../../utils/readinessQueue';

interface WorkerCountChipsProps {
  counts: WorkerGroupCounts;
}

const chipBaseSx = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 22,
  height: 20,
  px: 0.75,
  borderRadius: '10px',
  fontSize: 11,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums' as const,
  lineHeight: 1,
  color: '#fff',
};

const WorkerCountChips: React.FC<WorkerCountChipsProps> = ({ counts }) => {
  const needsReview = counts.needs_review + counts.complete_fail;
  const expired = counts.expired;
  const incomplete = counts.incomplete + counts.blocked;

  const chips: Array<{
    key: string;
    count: number;
    bgColor: string;
    tooltip: string;
  }> = [];
  if (needsReview > 0) {
    chips.push({
      key: 'needs_review',
      count: needsReview,
      // Use HSL/sx tokens via inline color; theming handled at parent level.
      bgColor: 'error.main',
      tooltip: `${needsReview} need${needsReview === 1 ? 's' : ''} review or failed`,
    });
  }
  if (expired > 0) {
    chips.push({
      key: 'expired',
      count: expired,
      bgColor: 'warning.main',
      tooltip: `${expired} expired`,
    });
  }
  if (incomplete > 0) {
    chips.push({
      key: 'incomplete',
      count: incomplete,
      bgColor: 'grey.500',
      tooltip: `${incomplete} incomplete (waiting on worker)`,
    });
  }

  if (chips.length === 0) return null;

  return (
    <Box sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'center' }}>
      {chips.map((c) => (
        <Tooltip key={c.key} title={c.tooltip}>
          <Box sx={{ ...chipBaseSx, bgcolor: c.bgColor }}>{c.count}</Box>
        </Tooltip>
      ))}
    </Box>
  );
};

export default WorkerCountChips;
