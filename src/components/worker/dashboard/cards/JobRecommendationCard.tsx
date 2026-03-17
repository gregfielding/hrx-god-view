/**
 * Job recommendation card — "New Job Near You", category-based theme.
 * CTAs: View Job, optional Apply.
 */

import React from 'react';
import { Card, CardContent, Typography, Button, Stack } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../../i18n';
import type { JobRecommendationCardPayload } from './types';
import { CARD_THEMES } from './types';

function formatPay(pay: number | undefined): string {
  if (pay == null || Number.isNaN(pay)) return '';
  return `$${Number(pay).toFixed(2)}/hr`;
}

export interface JobRecommendationCardProps {
  payload: JobRecommendationCardPayload;
  onTap?: () => void;
}

const JobRecommendationCard: React.FC<JobRecommendationCardProps> = ({ payload, onTap }) => {
  const navigate = useNavigate();
  const t = useT();
  const { bg, contrast } = CARD_THEMES.job[payload.category];
  const payStr = formatPay(payload.pay);

  const handleViewJob = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(payload.viewJobTo);
  };

  const handleApply = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (payload.applyTo) navigate(payload.applyTo);
    else navigate(payload.viewJobTo);
  };

  return (
    <Card
      variant="outlined"
      onClick={onTap}
      sx={{
        width: '100%',
        minHeight: 240,
        borderRadius: 3,
        border: 'none',
        boxShadow: 2,
        backgroundColor: bg,
        color: contrast,
        cursor: onTap ? 'pointer' : 'default',
      }}
    >
      <CardContent sx={{ p: 2.5, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Typography variant="overline" sx={{ color: contrast, opacity: 0.9, fontWeight: 600 }}>
          {payload.label}
        </Typography>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, color: contrast, mt: 0.5 }}>
          {payload.jobTitle}
        </Typography>
        {payload.company && (
          <Typography variant="body2" sx={{ color: contrast, opacity: 0.85 }}>
            {payload.company}
          </Typography>
        )}
        {payload.dateTime && (
          <Typography variant="body2" sx={{ color: contrast, opacity: 0.9 }}>
            {payload.dateTime}
          </Typography>
        )}
        {payload.location && (
          <Typography variant="body2" sx={{ color: contrast, opacity: 0.85 }}>
            {payload.location}
          </Typography>
        )}
        {payStr && (
          <Typography variant="body1" sx={{ fontWeight: 600, color: contrast }}>
            {payStr}
          </Typography>
        )}
        {payload.spotsLeft != null && payload.spotsLeft > 0 && (
          <Typography variant="caption" sx={{ color: contrast, opacity: 0.9 }}>
            {t('dashboard.cardSpotsLeft', { count: payload.spotsLeft })}
          </Typography>
        )}
        <Stack direction="row" spacing={1} sx={{ mt: 2 }} onClick={(e) => e.stopPropagation()}>
          <Button variant="contained" size="medium" onClick={handleViewJob} sx={{ bgcolor: contrast, color: bg, '&:hover': { bgcolor: contrast, opacity: 0.9 } }}>
            {t('dashboard.cardViewJob')}
          </Button>
          {(payload.applyTo || payload.viewJobTo) && (
            <Button variant="outlined" size="medium" onClick={handleApply} sx={{ borderColor: contrast, color: contrast }}>
              {t('jobs.applyNow')}
            </Button>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default JobRecommendationCard;
