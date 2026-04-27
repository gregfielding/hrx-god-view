import React from 'react';
import { Chip } from '@mui/material';
import type { WorkAuthorizedStatus } from '../utils/workAuthorizedDisplay';
import { getWorkAuthorizedLabel } from '../utils/workAuthorizedDisplay';

interface WorkAuthorizedChipProps {
  status: WorkAuthorizedStatus;
  size?: 'small' | 'medium';
}

/**
 * Chip for Work Authorized (Auth): Yes (light green), No (light red), Skipped (grey).
 */
const WorkAuthorizedChip: React.FC<WorkAuthorizedChipProps> = ({ status, size = 'small' }) => {
  const label = getWorkAuthorizedLabel(status);
  const sx =
    status === 'yes'
      ? { bgcolor: 'rgba(34, 197, 94, 0.12)', color: '#15803d', fontWeight: 600 }
      : status === 'no'
        ? { bgcolor: 'rgba(239, 68, 68, 0.12)', color: '#b91c1c', fontWeight: 600 }
        : { bgcolor: 'action.hover', color: 'text.secondary', fontWeight: 500 };

  return <Chip size={size} label={label} sx={sx} />;
};

export default WorkAuthorizedChip;
