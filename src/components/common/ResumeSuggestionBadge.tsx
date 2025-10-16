import React from 'react';
import { Chip, Tooltip } from '@mui/material';
import { Description } from '@mui/icons-material';

interface ResumeSuggestionBadgeProps {
  confidence?: number;
  showIcon?: boolean;
  size?: 'small' | 'medium';
  variant?: 'filled' | 'outlined';
}

const ResumeSuggestionBadge: React.FC<ResumeSuggestionBadgeProps> = ({
  confidence,
  showIcon = true,
  size = 'small',
  variant = 'outlined'
}) => {
  const getColor = (confidence?: number) => {
    if (!confidence) return 'default';
    if (confidence >= 0.8) return 'success';
    if (confidence >= 0.6) return 'warning';
    return 'error';
  };

  const getTooltipText = (confidence?: number) => {
    if (!confidence) return 'This value was suggested from your resume';
    if (confidence >= 0.8) return `High confidence suggestion from resume (${Math.round(confidence * 100)}%)`;
    if (confidence >= 0.6) return `Medium confidence suggestion from resume (${Math.round(confidence * 100)}%)`;
    return `Low confidence suggestion from resume (${Math.round(confidence * 100)}%)`;
  };

  return (
    <Tooltip title={getTooltipText(confidence)} arrow>
      <Chip
        icon={showIcon ? <Description fontSize="small" /> : undefined}
        label="Suggested by Resume"
        color={getColor(confidence) as any}
        size={size}
        variant={variant}
        sx={{
          ml: 1,
          fontSize: '0.75rem',
          height: size === 'small' ? 20 : 24,
          '& .MuiChip-icon': {
            fontSize: '0.875rem'
          }
        }}
      />
    </Tooltip>
  );
};

export default ResumeSuggestionBadge;
