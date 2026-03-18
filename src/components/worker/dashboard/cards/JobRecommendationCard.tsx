/**
 * Job recommendation card — pastel green. One primary CTA: Apply Now.
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
  /** When false, rail uses single primary CTA (Apply Now). */
  showApplyButton?: boolean;
}

const JobRecommendationCard: React.FC<JobRecommendationCardProps> = ({ payload, onTap }) => {
  const navigate = useNavigate();
  const t = useT();
  const { bg, contrast } = CARD_THEMES.job[payload.category];
  const payStr = formatPay(payload.pay);
  const detailParts = [payload.dateTime, payload.location, payStr].filter(Boolean);
  const detailLine = detailParts.join(' · ');

  const handleApply = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Home recommendations should always open job posting details first.
    navigate(payload.viewJobTo || payload.applyTo || '/c1/jobs-board');
  };

  return (
    <Card
      variant="outlined"
      onClick={onTap}
      sx={{
        width: '100%',
        minHeight: 200,
        borderRadius: '14px',
        border: 'none',
        boxShadow: 1,
        backgroundColor: bg,
        color: contrast,
        cursor: onTap ? 'pointer' : 'default',
      }}
    >
      <CardContent sx={{ p: 1.5, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Typography variant="overline" sx={{ color: contrast, opacity: 0.85, fontWeight: 600, fontSize: '0.65rem', letterSpacing: '0.08em' }}>
          {payload.label}
        </Typography>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, color: contrast, mt: 0.25, lineHeight: 1.3 }}>
          {payload.jobTitle}
        </Typography>
        {payload.company && (
          <Typography variant="body2" sx={{ color: contrast, opacity: 0.9, mt: 0.25 }}>
            {payload.company}
          </Typography>
        )}
        {detailLine && (
          <Typography variant="body2" sx={{ color: contrast, opacity: 0.9, mt: 0.25 }}>
            {detailLine}
          </Typography>
        )}
        {payload.spotsLeft != null && payload.spotsLeft > 0 && (
          <Typography variant="caption" sx={{ color: contrast, opacity: 0.85, display: 'block', mt: 0.25 }}>
            {t('dashboard.cardSpotsLeft', { count: payload.spotsLeft })}
          </Typography>
        )}
        <Button
          variant="contained"
          fullWidth
          size="medium"
          onClick={handleApply}
          sx={{
            mt: 1.5,
            py: 1,
            bgcolor: contrast,
            color: '#fff',
            borderRadius: 2,
            fontSize: '0.875rem',
            textTransform: 'none',
            fontWeight: 600,
            '&:hover': { bgcolor: contrast, opacity: 0.92 },
          }}
        >
          {t('dashboard.cardApplyNow')}
        </Button>
      </CardContent>
    </Card>
  );
};

export default JobRecommendationCard;
