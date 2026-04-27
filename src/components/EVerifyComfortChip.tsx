import React from 'react';
import { Chip } from '@mui/material';
import type { EVerifyComfortStatus } from '../utils/eVerifyComfortDisplay';
import { getEVerifyComfortLabel } from '../utils/eVerifyComfortDisplay';

interface EVerifyComfortChipProps {
  status: EVerifyComfortStatus;
  size?: 'small' | 'medium';
}

/**
 * Chip for E-Verify comfort: Yes (green), No (red), Maybe (amber), Skipped (grey) — aligned with WorkAuthorizedChip.
 */
const EVerifyComfortChip: React.FC<EVerifyComfortChipProps> = ({ status, size = 'small' }) => {
  const label = getEVerifyComfortLabel(status);
  const sx =
    status === 'yes'
      ? { bgcolor: 'rgba(34, 197, 94, 0.12)', color: '#15803d', fontWeight: 600 }
      : status === 'no'
        ? { bgcolor: 'rgba(239, 68, 68, 0.12)', color: '#b91c1c', fontWeight: 600 }
        : status === 'maybe'
          ? { bgcolor: 'rgba(245, 158, 11, 0.12)', color: '#b45309', fontWeight: 600 }
          : { bgcolor: 'action.hover', color: 'text.secondary', fontWeight: 500 };

  return <Chip size={size} label={label} sx={sx} />;
};

export default EVerifyComfortChip;
