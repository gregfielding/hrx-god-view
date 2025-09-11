import React from 'react';
import { Box, Typography, Tooltip, Chip, List, ListItem, ListItemText } from '@mui/material';

export type HealthBucket = 'healthy' | 'watch' | 'at_risk' | 'stale';

interface HealthBadgeProps {
  bucket: HealthBucket;
  score: number;
  reasons?: string[];
  showScore?: boolean;
  variant?: 'default' | 'compact';
}

const HealthBadge: React.FC<HealthBadgeProps> = ({ 
  bucket, 
  score, 
  reasons = [], 
  showScore = true,
  variant = 'default'
}) => {
  const healthMap = {
    healthy: { 
      status: 'Healthy', 
      color: 'success' as const, 
      emoji: '🟢',
      bgcolor: 'success.light',
      textColor: 'success.dark'
    },
    watch: { 
      status: 'Watch', 
      color: 'warning' as const, 
      emoji: '🟡',
      bgcolor: 'warning.light',
      textColor: 'warning.dark'
    },
    at_risk: { 
      status: 'At Risk', 
      color: 'error' as const, 
      emoji: '🟠',
      bgcolor: 'error.light',
      textColor: 'error.dark'
    },
    stale: { 
      status: 'Stale', 
      color: 'error' as const, 
      emoji: '🔴',
      bgcolor: 'error.light',
      textColor: 'error.dark'
    }
  };

  const health = healthMap[bucket];

  const tooltipContent = (
    <Box>
      {showScore && (
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
          Health Score: {score}/100
        </Typography>
      )}
      {reasons.length > 0 && (
        <Box>
          <Typography variant="caption" sx={{ fontWeight: 500 }}>
            Issues:
          </Typography>
          <List dense sx={{ py: 0 }}>
            {reasons.map((reason, index) => (
              <ListItem key={index} sx={{ py: 0, px: 0 }}>
                <ListItemText 
                  primary={reason} 
                  primaryTypographyProps={{ variant: 'caption' }}
                />
              </ListItem>
            ))}
          </List>
        </Box>
      )}
    </Box>
  );

  if (variant === 'compact') {
    return (
      <Tooltip 
        title={tooltipContent}
        arrow
        placement="top"
      >
        <Chip
          label={health.status}
          size="small"
          sx={{
            bgcolor: health.bgcolor,
            color: health.textColor,
            fontWeight: 500,
            fontSize: '0.75rem',
            cursor: 'help'
          }}
          icon={<span style={{ fontSize: '0.75rem' }}>{health.emoji}</span>}
        />
      </Tooltip>
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Tooltip 
        title={tooltipContent}
        arrow
        placement="top"
      >
        <Chip
          label={health.status}
          size="small"
          sx={{
            bgcolor: health.bgcolor,
            color: health.textColor,
            fontWeight: 500,
            fontSize: '0.75rem',
            my: 0.5,
            cursor: 'help'
          }}
          icon={<span style={{ fontSize: '0.75rem' }}>{health.emoji}</span>}
        />
      </Tooltip>
    </Box>
  );
};

export default HealthBadge;
