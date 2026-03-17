/**
 * Assignment card — "Upcoming Shift". Single CTA: View Assignment.
 * Hospitality → warm gold; default blue. 240–280px height, 16px radius, 20px padding.
 */

import React from 'react';
import { Card, CardContent, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../../i18n';
import type { AssignmentCardPayload } from './types';
import { CARD_THEMES } from './types';
import { getCategoryForTitle } from '../../../../utils/dashboardCardCategory';

function formatPay(pay: number | undefined): string {
  if (pay == null || Number.isNaN(pay)) return '';
  return `$${Number(pay).toFixed(2)}/hr`;
}

export interface AssignmentCardProps {
  payload: AssignmentCardPayload;
  onTap?: () => void;
}

const AssignmentCard: React.FC<AssignmentCardProps> = ({ payload, onTap }) => {
  const navigate = useNavigate();
  const t = useT();
  const isHospitality = getCategoryForTitle(payload.jobTitle) === 'hospitality';
  const { bg, contrast } = isHospitality ? CARD_THEMES.job.hospitality : CARD_THEMES.assignment;
  const payStr = formatPay(payload.pay);

  const handleViewAssignment = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(payload.viewAssignmentTo);
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
        {payStr && (
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: contrast }}>
            {payStr}
          </Typography>
        )}
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
        <Button
          variant="contained"
          fullWidth
          size="large"
          onClick={handleViewAssignment}
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
          {t('dashboard.cardViewAssignment')}
        </Button>
      </CardContent>
    </Card>
  );
};

export default AssignmentCard;
