/**
 * Per-status chip for readiness items. Implements the §6e vocabulary —
 * "Complete" is gone as a pass/fail-ambiguous label; items render as
 * Passed / Failed / Needs review / Expired when they carry a verdict, and
 * keep the pre-verdict states (Incomplete / In progress / Blocked / N/A)
 * otherwise.
 *
 * Legacy `complete` renders as "Passed" since that's how pre-§6e rows are
 * to be interpreted going forward.
 *
 * **Provenance:** extracted verbatim from `RecruiterMyQueue.tsx` so the
 * Workforce surface and the legacy `/jobs/my-queue` redirect target render
 * identical chips. Don't drift either side without updating the other.
 */

import React from 'react';
import { Chip } from '@mui/material';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import RateReviewIcon from '@mui/icons-material/RateReview';
import ScheduleIcon from '@mui/icons-material/Schedule';

import type { QueueRow } from '../../utils/readinessQueue/queueRow';

type ChipColor = 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';

interface StatusConfig {
  label: string;
  color: ChipColor;
  icon: React.ReactElement | undefined;
}

const STATUS_CONFIG: Record<QueueRow['status'], StatusConfig> = {
  incomplete: { label: 'Incomplete', color: 'default', icon: <HourglassEmptyIcon fontSize="small" /> },
  in_progress: { label: 'In progress', color: 'info', icon: <PlayCircleOutlineIcon fontSize="small" /> },
  blocked: { label: 'Blocked', color: 'error', icon: <ErrorOutlineIcon fontSize="small" /> },
  complete_pass: { label: 'Passed', color: 'success', icon: <CheckCircleIcon fontSize="small" /> },
  complete_fail: { label: 'Failed', color: 'error', icon: <CancelIcon fontSize="small" /> },
  needs_review: { label: 'Needs review', color: 'warning', icon: <RateReviewIcon fontSize="small" /> },
  expired: { label: 'Expired', color: 'warning', icon: <ScheduleIcon fontSize="small" /> },
  not_applicable: { label: 'N/A', color: 'default', icon: undefined },
  // Legacy — interpret as pass per the type comment.
  complete: { label: 'Passed', color: 'success', icon: <CheckCircleIcon fontSize="small" /> },
};

export interface StatusChipProps {
  status: QueueRow['status'];
  size?: 'small' | 'medium';
}

const StatusChip: React.FC<StatusChipProps> = ({ status, size = 'small' }) => {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.incomplete;
  return (
    <Chip
      label={cfg.label}
      size={size}
      color={cfg.color}
      variant="outlined"
      icon={cfg.icon}
    />
  );
};

export default StatusChip;
