/**
 * StatusDot Component
 * 
 * Displays a colored dot indicating user presence status (online/idle/offline).
 */

import React from 'react';
import { Box, Typography } from '@mui/material';
import type { PresenceStatus } from '../../types/presence';
import { formatDistanceToNowStrict } from 'date-fns';

export type StatusDotSize = 'xs' | 'sm' | 'md';

export interface StatusDotProps {
  status: PresenceStatus;
  size?: StatusDotSize;
  showLabel?: boolean;
  lastSeenAt?: Date | null;
  variant?: 'solid' | 'subtle'; // subtle for less-dominant places
  className?: string;
}

const SIZE_MAP: Record<StatusDotSize, number> = {
  xs: 6,
  sm: 8,
  md: 10,
};

const COLOR_MAP: Record<PresenceStatus, string> = {
  online: '#22c55e',  // green
  idle: '#facc15',    // yellow
  offline: '#9ca3af', // gray
};

export const StatusDot: React.FC<StatusDotProps> = ({
  status,
  size = 'sm',
  showLabel = false,
  lastSeenAt,
  variant = 'solid',
  className,
}) => {
  const px = SIZE_MAP[size];
  const color = COLOR_MAP[status];

  const label = React.useMemo(() => {
    if (status === 'online') return 'Online';
    if (status === 'idle') return 'Idle';
    if (!lastSeenAt) return 'Offline';

    const distance = formatDistanceToNowStrict(lastSeenAt, { addSuffix: true });
    return `Offline · ${distance}`;
  }, [status, lastSeenAt]);

  const dotStyles =
    variant === 'solid'
      ? {
          backgroundColor: color,
        }
      : {
          border: `2px solid ${color}`,
          backgroundColor: 'transparent',
        };

  return (
    <Box
      display="inline-flex"
      alignItems="center"
      gap={0.75}
      className={className}
    >
      <Box
        component="span"
        sx={{
          width: px,
          height: px,
          borderRadius: '999px',
          flexShrink: 0,
          ...dotStyles,
        }}
      />
      {showLabel && (
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
      )}
    </Box>
  );
};

