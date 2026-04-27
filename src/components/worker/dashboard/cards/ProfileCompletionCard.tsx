/**
 * Profile completion card — pastel orange. Single CTA: Complete Profile.
 */

import React from 'react';
import { Card, CardContent, Typography, Button, LinearProgress } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../../i18n';
import type { ProfileCompletionCardPayload } from './types';
import { CARD_THEMES } from './types';

export interface ProfileCompletionCardProps {
  payload: ProfileCompletionCardPayload;
  onTap?: () => void;
}

const ProfileCompletionCard: React.FC<ProfileCompletionCardProps> = ({ payload, onTap }) => {
  const navigate = useNavigate();
  const t = useT();
  const { bg, contrast } = CARD_THEMES.profile;
  const subtitle = payload.suggestedTasks.length > 0
    ? payload.suggestedTasks[0]
    : t('dashboard.suggestedTaskProfile');

  const handleUpdateProfile = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(payload.continueProfileTo);
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
        <Typography variant="body2" sx={{ color: contrast, opacity: 0.9, mt: 0.5 }}>
          {subtitle}
        </Typography>
        <Typography variant="caption" sx={{ color: contrast, fontWeight: 600, mt: 0.25 }}>
          {t('dashboard.jobReadinessScore', { percent: payload.readinessPercent })}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={Math.min(100, Math.max(0, payload.readinessPercent))}
          sx={{
            mt: 0.75,
            height: 6,
            borderRadius: 1,
            bgcolor: 'rgba(0,0,0,0.1)',
            '& .MuiLinearProgress-bar': { borderRadius: 1, bgcolor: contrast },
          }}
        />
        <Button
          variant="contained"
          fullWidth
          size="medium"
          onClick={handleUpdateProfile}
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
          {t('dashboard.cardCompleteProfile')}
        </Button>
      </CardContent>
    </Card>
  );
};

export default ProfileCompletionCard;
