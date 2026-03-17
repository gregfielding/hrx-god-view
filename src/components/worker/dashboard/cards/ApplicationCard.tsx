/**
 * Application card — pastel purple. Short copy: label + "JobTitle — Company", one CTA: View Status.
 */

import React from 'react';
import { Card, CardContent, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../../i18n';
import type { ApplicationCardPayload } from './types';
import { CARD_THEMES } from './types';

export interface ApplicationCardProps {
  payload: ApplicationCardPayload;
  onTap?: () => void;
}

const ApplicationCard: React.FC<ApplicationCardProps> = ({ payload, onTap }) => {
  const navigate = useNavigate();
  const t = useT();
  const { bg, contrast } = CARD_THEMES.application;
  const titleLine = payload.company ? `${payload.jobTitle} — ${payload.company}` : payload.jobTitle;

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
          {titleLine}
        </Typography>
        <Typography variant="body2" sx={{ color: contrast, opacity: 0.9, mt: 0.25 }}>
          {payload.appliedDateOrStatus}
        </Typography>
        <Button
          variant="contained"
          fullWidth
          size="medium"
          onClick={handlePrimary}
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
          onClickCapture={(e) => e.stopPropagation()}
        >
          {t('dashboard.cardViewStatus')}
        </Button>
      </CardContent>
    </Card>
  );
};

export default ApplicationCard;
