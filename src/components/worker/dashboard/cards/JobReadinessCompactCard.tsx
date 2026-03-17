/**
 * Compact Job Readiness card — single line + Fix now. Used when only a few items are missing.
 */

import React from 'react';
import { Card, CardContent, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../../i18n';
import type { JobReadinessCardPayload } from './types';
import { CARD_THEMES } from './types';

export interface JobReadinessCompactCardProps {
  payload: JobReadinessCardPayload;
  onTap?: () => void;
}

const JobReadinessCompactCard: React.FC<JobReadinessCompactCardProps> = ({ payload, onTap }) => {
  const navigate = useNavigate();
  const t = useT();
  const { bg, contrast } = CARD_THEMES.job_readiness;

  const handleFixNow = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(payload.fixNowTo);
  };

  return (
    <Card
      variant="outlined"
      onClick={onTap}
      sx={{
        width: '100%',
        borderRadius: '12px',
        border: 'none',
        boxShadow: 1,
        backgroundColor: bg,
        color: contrast,
        cursor: onTap ? 'pointer' : 'default',
      }}
    >
      <CardContent sx={{ py: 1.5, px: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="body2" sx={{ color: contrast, fontWeight: 500 }}>
          {payload.body}
        </Typography>
        <Button
          variant="text"
          size="small"
          onClick={handleFixNow}
          sx={{
            color: contrast,
            fontWeight: 600,
            textTransform: 'none',
            minWidth: 'auto',
            px: 1.5,
          }}
          onClickCapture={(e) => e.stopPropagation()}
        >
          {t('dashboard.fixNow')}
        </Button>
      </CardContent>
    </Card>
  );
};

export default JobReadinessCompactCard;
