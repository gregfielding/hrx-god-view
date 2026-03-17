/**
 * Profile completion card — "Unlock More Jobs", teal theme.
 * CTAs: Continue Profile, See Jobs Anyway.
 */

import React from 'react';
import { Card, CardContent, Typography, Button, Stack, LinearProgress } from '@mui/material';
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

  const handleContinueProfile = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(payload.continueProfileTo);
  };

  const handleSeeJobs = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(payload.seeJobsTo);
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
        <Typography variant="h6" sx={{ fontWeight: 700, color: contrast, mt: 1 }}>
          {payload.readinessPercent}%
        </Typography>
        <LinearProgress
          variant="determinate"
          value={Math.min(100, Math.max(0, payload.readinessPercent))}
          sx={{
            mt: 1,
            mb: 1.5,
            height: 8,
            borderRadius: 1,
            bgcolor: 'rgba(0,0,0,0.1)',
            '& .MuiLinearProgress-bar': { borderRadius: 1 },
          }}
        />
        {payload.suggestedTasks.length > 0 && (
          <Typography variant="body2" sx={{ color: contrast, opacity: 0.9 }}>
            {payload.suggestedTasks.slice(0, 2).join(' • ')}
          </Typography>
        )}
        <Stack direction="row" spacing={1} sx={{ mt: 2 }} onClick={(e) => e.stopPropagation()}>
          <Button variant="contained" size="medium" onClick={handleContinueProfile} sx={{ bgcolor: contrast, color: bg, '&:hover': { bgcolor: contrast, opacity: 0.9 } }}>
            {t('dashboard.cardContinueProfile')}
          </Button>
          <Button variant="outlined" size="medium" onClick={handleSeeJobs} sx={{ borderColor: contrast, color: contrast }}>
            {t('dashboard.cardSeeJobsAnyway')}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default ProfileCompletionCard;
