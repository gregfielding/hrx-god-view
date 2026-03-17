/**
 * Job Readiness dashboard card — "Unlock More Jobs". Body, readiness %, Fix Now → job readiness feed.
 */

import React from 'react';
import { Card, CardContent, Typography, Button, LinearProgress } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../../i18n';
import type { JobReadinessCardPayload } from './types';
import { CARD_THEMES } from './types';

export interface JobReadinessCardProps {
  payload: JobReadinessCardPayload;
  onTap?: () => void;
}

const JobReadinessCard: React.FC<JobReadinessCardProps> = ({ payload, onTap }) => {
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
        minHeight: 260,
        maxHeight: 280,
        borderRadius: '16px',
        border: 'none',
        boxShadow: 2,
        backgroundColor: bg,
        color: contrast,
        cursor: onTap ? 'pointer' : 'default',
      }}
    >
      <CardContent sx={{ p: 2.5, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Typography variant="overline" sx={{ color: contrast, opacity: 0.9, fontWeight: 600, fontSize: '0.7rem' }}>
          {payload.label}
        </Typography>
        <Typography variant="body2" sx={{ color: contrast, opacity: 0.9, mt: 1 }}>
          {payload.body}
        </Typography>
        <Typography variant="body2" sx={{ color: contrast, fontWeight: 600, mt: 0.5 }}>
          {t('dashboard.jobReadinessLabel', { percent: payload.readinessPercent })}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={Math.min(100, Math.max(0, payload.readinessPercent))}
          sx={{
            mt: 1,
            mb: 1.5,
            height: 8,
            borderRadius: 1,
            bgcolor: 'rgba(0,0,0,0.1)',
            '& .MuiLinearProgress-bar': { borderRadius: 1 },
          }}
        />
        <Button
          variant="contained"
          fullWidth
          size="large"
          onClick={handleFixNow}
          sx={{
            mt: 2,
            py: 1.25,
            bgcolor: contrast,
            color: bg,
            borderRadius: 2,
            '&:hover': { bgcolor: contrast, opacity: 0.9 },
          }}
          onClickCapture={(e) => e.stopPropagation()}
        >
          {t('dashboard.fixNow')}
        </Button>
      </CardContent>
    </Card>
  );
};

export default JobReadinessCard;
