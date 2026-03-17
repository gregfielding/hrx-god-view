/**
 * Application card — "Application Update", amber theme.
 * CTAs: View Job, View Applications; optional Accept / Decline when needsResponse.
 */

import React from 'react';
import { Card, CardContent, Typography, Button, Stack } from '@mui/material';
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

  const handleViewJob = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(payload.viewJobTo);
  };

  const handleViewApplications = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(payload.viewApplicationsTo);
  };

  const handleAccept = (e: React.MouseEvent) => {
    e.stopPropagation();
    payload.onAccept?.();
  };

  const handleDecline = (e: React.MouseEvent) => {
    e.stopPropagation();
    payload.onDecline?.();
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
        <Typography variant="body2" sx={{ color: contrast, opacity: 0.9 }}>
          {payload.appliedDateOrStatus}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap onClick={(e) => e.stopPropagation()}>
          <Button variant="contained" size="medium" onClick={handleViewJob} sx={{ bgcolor: contrast, color: bg, '&:hover': { bgcolor: contrast, opacity: 0.9 } }}>
            {t('dashboard.cardViewJob')}
          </Button>
          <Button variant="outlined" size="medium" onClick={handleViewApplications} sx={{ borderColor: contrast, color: contrast }}>
            {t('dashboard.cardViewApplications')}
          </Button>
          {payload.needsResponse && (
            <>
              <Button variant="contained" size="medium" color="success" onClick={handleAccept}>
                {t('dashboard.cardAccept')}
              </Button>
              <Button variant="outlined" size="medium" color="error" onClick={handleDecline}>
                {t('dashboard.cardDecline')}
              </Button>
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default ApplicationCard;
