import React from 'react';
import { Chip } from '@mui/material';

/** Light fill + darker text (same idea as WorkAuthorizedChip). */
export function jobBoardPostStatusChipSx(status: string | undefined): Record<string, unknown> {
  const raw = typeof status === 'string' ? status : '';
  const s = (raw || 'draft').toLowerCase();
  if (s === 'active') {
    return {
      bgcolor: 'rgba(34, 197, 94, 0.16)',
      color: '#15803d',
      fontWeight: 600,
      border: '1px solid rgba(34, 197, 94, 0.35)',
    };
  }
  if (s === 'draft' || s === 'paused') {
    return {
      bgcolor: 'rgba(245, 158, 11, 0.16)',
      color: '#b45309',
      fontWeight: 600,
      border: '1px solid rgba(245, 158, 11, 0.35)',
    };
  }
  if (s === 'cancelled' || s === 'expired') {
    return {
      bgcolor: 'rgba(239, 68, 68, 0.16)',
      color: '#b91c1c',
      fontWeight: 600,
      border: '1px solid rgba(239, 68, 68, 0.35)',
    };
  }
  if (s === 'completed') {
    return {
      bgcolor: 'rgba(59, 130, 246, 0.16)',
      color: '#1d4ed8',
      fontWeight: 600,
      border: '1px solid rgba(59, 130, 246, 0.35)',
    };
  }
  return {
    bgcolor: 'action.hover',
    color: 'text.secondary',
    fontWeight: 500,
    border: '1px solid',
    borderColor: 'divider',
  };
}

export function jobBoardPostStatusLabel(status: string | undefined): string {
  const raw = typeof status === 'string' ? status : '';
  const s = (raw || 'draft').toLowerCase();
  const labels: Record<string, string> = {
    draft: 'Draft',
    active: 'Active',
    paused: 'Paused',
    cancelled: 'Cancelled',
    expired: 'Expired',
    completed: 'Completed',
  };
  if (labels[s]) return labels[s];
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Draft';
}

interface JobBoardPostStatusChipProps {
  status: string | undefined;
  size?: 'small' | 'medium';
}

/**
 * Job board post lifecycle status — green / amber / red / blue (completed),
 * pill-shaped, title case label (never forced uppercase).
 */
const JobBoardPostStatusChip: React.FC<JobBoardPostStatusChipProps> = ({
  status,
  size = 'small',
}) => {
  return (
    <Chip
      size={size}
      variant="filled"
      label={jobBoardPostStatusLabel(status)}
      sx={{
        ...jobBoardPostStatusChipSx(status),
        borderRadius: '999px',
        textTransform: 'none',
        '& .MuiChip-label': {
          textTransform: 'none',
          px: 1.25,
          fontSize: size === 'small' ? '0.8125rem' : '0.875rem',
          fontWeight: 600,
        },
      }}
    />
  );
};

export default JobBoardPostStatusChip;
