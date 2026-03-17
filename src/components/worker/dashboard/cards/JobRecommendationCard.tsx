/**
 * Job recommendation card — "New Job Near You", category-based theme.
 * CTAs: View Job, optional Apply.
 */

import React from 'react';
import { Card, CardContent, Typography, Button } from '@mui/material';
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
  /** When false, only show View Job (e.g. Find Work deck: apply only in detail). Default true. */
  showApplyButton?: boolean;
}

const JobRecommendationCard: React.FC<JobRecommendationCardProps> = ({ payload, onTap, showApplyButton = true }) => {
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
        <Typography variant="h6" sx={{ fontWeight: 700, color: contrast, mt: 0.5 }}>
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
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: contrast }}>
            {payStr}
          </Typography>
        )}
        {payload.spotsLeft != null && payload.spotsLeft > 0 && (
          <Typography variant="caption" sx={{ color: contrast, opacity: 0.9 }}>
            {t('dashboard.cardSpotsLeft', { count: payload.spotsLeft })}
          </Typography>
        )}
        <Button
          variant="contained"
          fullWidth
          size="large"
          onClick={handleViewJob}
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
          {t('dashboard.cardViewJob')}
        </Button>
      </CardContent>
    </Card>
  );
};

export default JobRecommendationCard;
