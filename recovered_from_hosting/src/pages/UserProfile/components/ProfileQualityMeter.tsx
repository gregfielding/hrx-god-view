import React from 'react';
import { Box, Typography, LinearProgress, Tooltip, Chip } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

interface ProfileQualityMeterProps {
  score: number;
  missingItemsCount: number;
  missingItemsSummary?: string;
}

const ProfileQualityMeter: React.FC<ProfileQualityMeterProps> = ({
  score,
  missingItemsCount,
  missingItemsSummary,
}) => {
  const getScoreColor = () => {
    if (score >= 80) return 'success';
    if (score >= 60) return 'warning';
    return 'error';
  };

  const getScoreLabel = () => {
    if (score >= 80) return 'Very competitive candidate';
    if (score >= 60) return 'Good candidate';
    if (score >= 40) return 'Needs resume update';
    return 'Missing key info';
  };

  return (
    <Box sx={{ mt: 0.5, mb: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary' }}>
          Profile Quality:
        </Typography>
        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.75rem', color: `${getScoreColor()}.main` }}>
          {score}%
        </Typography>
        <Tooltip title={getScoreLabel()}>
          <InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
        </Tooltip>
      </Box>
      <LinearProgress
        variant="determinate"
        value={score}
        color={getScoreColor()}
        sx={{
          height: 6,
          borderRadius: 3,
          bgcolor: 'grey.200',
          '& .MuiLinearProgress-bar': {
            borderRadius: 3,
          },
        }}
      />
      {missingItemsCount > 0 && (
        <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'text.secondary', mt: 0.25, display: 'block' }}>
          {missingItemsCount} {missingItemsCount === 1 ? 'item' : 'items'} missing {missingItemsSummary ? `— ${missingItemsSummary}` : ''}
        </Typography>
      )}
    </Box>
  );
};

export default ProfileQualityMeter;

