/**
 * Application card — "Application Update". Single primary CTA: View Application.
 * 240–280px height, 16px radius, 20px padding.
 */

import React from 'react';
import { Card, CardContent, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../../i18n';
import type { ApplicationCardPayload } from './types';
import { CARD_THEMES } from './types';

function formatPay(pay: number | undefined): string {
  if (pay == null || Number.isNaN(pay)) return '';
  return `$${Number(pay).toFixed(2)}/hr`;
}

export interface ApplicationCardProps {
  payload: ApplicationCardPayload;
  onTap?: () => void;
}

const ApplicationCard: React.FC<ApplicationCardProps> = ({ payload, onTap }) => {
  const navigate = useNavigate();
  const t = useT();
  const { bg, contrast } = CARD_THEMES.application;
  const payStr = formatPay(payload.pay);

  const handlePrimary = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(payload.viewJobTo);
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
        <Typography variant="body2" sx={{ color: contrast, opacity: 0.9 }}>
          {t('applications.status')}: {payload.appliedDateOrStatus}
        </Typography>
        {payStr && (
          <Typography variant="body1" sx={{ fontWeight: 600, color: contrast }}>
            {payStr}
          </Typography>
        )}
        <Button
          variant="contained"
          fullWidth
          size="large"
          onClick={handlePrimary}
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
          {t('dashboard.cardViewApplication')}
        </Button>
      </CardContent>
    </Card>
  );
};

export default ApplicationCard;
