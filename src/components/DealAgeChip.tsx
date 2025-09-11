import React from 'react';
import { Box, Typography, Tooltip, Chip } from '@mui/material';

interface DealAgeChipProps {
  ageDays: number;
  createdAt: Date;
  showEmoji?: boolean;
  variant?: 'default' | 'compact';
}

const DealAgeChip: React.FC<DealAgeChipProps> = ({ 
  ageDays, 
  createdAt, 
  showEmoji = true, 
  variant = 'default' 
}) => {
  const getAgeColor = (days: number) => {
    if (days <= 7) return 'default';
    if (days <= 14) return 'info';
    if (days <= 30) return 'warning';
    return 'error';
  };

  const getAgeEmoji = (days: number) => {
    if (days <= 7) return '🟢';
    if (days <= 14) return '🟡';
    if (days <= 30) return '🟠';
    return '🔴';
  };

  const ageColor = getAgeColor(ageDays);
  const ageEmoji = getAgeEmoji(ageDays);

  if (variant === 'compact') {
    return (
      <Tooltip 
        title={`Opened ${createdAt.toLocaleDateString()} at ${createdAt.toLocaleTimeString()}`}
        arrow
      >
        <Chip
          label={`${ageDays}d`}
          size="small"
          color={ageColor as any}
          icon={showEmoji ? <span style={{ fontSize: '0.75rem' }}>{ageEmoji}</span> : undefined}
          sx={{ cursor: 'help' }}
        />
      </Tooltip>
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Age:</Typography>
      <Tooltip 
        title={`Opened ${createdAt.toLocaleDateString()} at ${createdAt.toLocaleTimeString()}`}
        arrow
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'help' }}>
          <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500 }}>
            {ageDays} day{ageDays !== 1 ? 's' : ''}
          </Typography>
          {showEmoji && (
            <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
              {ageEmoji}
            </Typography>
          )}
        </Box>
      </Tooltip>
    </Box>
  );
};

export default DealAgeChip;
