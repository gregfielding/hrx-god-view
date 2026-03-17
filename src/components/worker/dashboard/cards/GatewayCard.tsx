/**
 * Gateway card — "See all jobs". Light, minimal, one CTA.
 */

import React from 'react';
import { Card, CardContent, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../../i18n';
import type { GatewayCardPayload } from './types';

const GATEWAY_BG = '#F8FAFC';
const GATEWAY_ACCENT = '#0F9D58';

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
        minHeight: 200,
        borderRadius: '14px',
        border: '2px dashed',
        borderColor: GATEWAY_ACCENT,
        boxShadow: 1,
        backgroundColor: GATEWAY_BG,
        cursor: onTap ? 'pointer' : 'default',
      }}
    >
      <CardContent sx={{ p: 1.5, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '0.65rem', letterSpacing: '0.08em' }}>
          {payload.label}
        </Typography>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary', mt: 0.5 }}>
          {t('dashboard.seeAllJobs')}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25 }}>
          {t('dashboard.seeAllJobsSubtext')}
        </Typography>
        <Button
          variant="contained"
          fullWidth
          size="medium"
          onClick={handleSeeAll}
          sx={{
            mt: 1.5,
            py: 1,
            bgcolor: GATEWAY_ACCENT,
            color: '#fff',
            borderRadius: 2,
            fontSize: '0.875rem',
            textTransform: 'none',
            fontWeight: 600,
            '&:hover': { bgcolor: GATEWAY_ACCENT, opacity: 0.92 },
          }}
          onClickCapture={(e) => e.stopPropagation()}
        >
          {t('dashboard.seeAllJobs')}
        </Button>
      </CardContent>
    </Card>
  );
};

export default GatewayCard;
