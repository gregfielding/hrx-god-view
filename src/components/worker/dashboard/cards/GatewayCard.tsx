/**
 * Gateway card — "See all jobs" entry to the full jobs board.
 */

import React from 'react';
import { Card, CardContent, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../../i18n';
import type { GatewayCardPayload } from './types';

export interface GatewayCardProps {
  payload: GatewayCardPayload;
  onTap?: () => void;
}

const GatewayCard: React.FC<GatewayCardProps> = ({ payload, onTap }) => {
  const navigate = useNavigate();
  const t = useT();

  const handleSeeAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(payload.seeJobsTo);
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
        border: '2px dashed',
        borderColor: 'primary.main',
        boxShadow: 1,
        backgroundColor: 'grey.50',
        cursor: onTap ? 'pointer' : 'default',
      }}
    >
      <CardContent sx={{ p: 2.5, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '0.7rem' }}>
          {payload.label}
        </Typography>
        <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary', mt: 1 }}>
          {t('dashboard.seeAllJobs')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t('dashboard.seeAllJobsSubtext')}
        </Typography>
        <Button
          variant="contained"
          fullWidth
          size="large"
          onClick={handleSeeAll}
          sx={{ mt: 2, py: 1.25, borderRadius: 2 }}
          onClickCapture={(e) => e.stopPropagation()}
        >
          {t('dashboard.seeAllJobs')}
        </Button>
      </CardContent>
    </Card>
  );
};

export default GatewayCard;
