/**
 * Assignment card — "Your Next Shift", blue theme.
 * CTAs: View Assignment, Get Directions.
 */

import React from 'react';
import { Card, CardContent, Typography, Button, Stack } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../../i18n';
import type { AssignmentCardPayload } from './types';
import { CARD_THEMES } from './types';

function formatPay(pay: number | undefined): string {
  if (pay == null || Number.isNaN(pay)) return '';
  return `$${Number(pay).toFixed(2)}/hr`;
}

function getDirectionsUrl(query: string): string {
  const encoded = encodeURIComponent(query);
  return `https://www.google.com/maps/search/?api=1&query=${encoded}`;
}

export interface AssignmentCardProps {
  payload: AssignmentCardPayload;
  onTap?: () => void;
}

const AssignmentCard: React.FC<AssignmentCardProps> = ({ payload, onTap }) => {
  const navigate = useNavigate();
  const t = useT();
  const { bg, contrast } = CARD_THEMES.assignment;
  const payStr = formatPay(payload.pay);

  const handleViewAssignment = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(payload.viewAssignmentTo);
  };

  const handleGetDirections = (e: React.MouseEvent) => {
    e.stopPropagation();
    const query = payload.directionsQuery || payload.location || payload.jobTitle;
    if (query) window.open(getDirectionsUrl(query), '_blank', 'noopener,noreferrer');
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
        <Typography variant="body2" sx={{ color: contrast, opacity: 0.9 }}>
          {payload.dateTime}
        </Typography>
        {payload.location && (
          <Typography variant="body2" sx={{ color: contrast, opacity: 0.85 }}>
            {payload.location}
          </Typography>
        )}
        {payload.status && (
          <Typography variant="caption" sx={{ color: contrast, opacity: 0.8 }}>
            {payload.status}
          </Typography>
        )}
        {payStr && (
          <Typography variant="body1" sx={{ fontWeight: 600, color: contrast, mt: 0.5 }}>
            {payStr}
          </Typography>
        )}
        <Stack direction="row" spacing={1} sx={{ mt: 2 }} onClick={(e) => e.stopPropagation()}>
          <Button variant="contained" size="medium" onClick={handleViewAssignment} sx={{ bgcolor: contrast, color: bg, '&:hover': { bgcolor: contrast, opacity: 0.9 } }}>
            {t('dashboard.cardViewAssignment')}
          </Button>
          {(payload.directionsQuery || payload.location) && (
            <Button variant="outlined" size="medium" onClick={handleGetDirections} sx={{ borderColor: contrast, color: contrast }}>
              {t('dashboard.cardGetDirections')}
            </Button>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default AssignmentCard;
