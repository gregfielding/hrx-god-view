import React from 'react';
import { Box, Typography, LinearProgress, Tooltip } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

interface CompactProfileQualityBarProps {
  score: number;
}

const CompactProfileQualityBar: React.FC<CompactProfileQualityBarProps> = ({
  score,
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
    <Box sx={{ mt: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary' }}>
          Profile Quality:
        </Typography>
        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.75rem', color: `${getScoreColor()}.main` }}>
          {score}%
        </Typography>
        <Tooltip title={getScoreLabel()}>
          <InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.secondary', cursor: 'help' }} />
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
          mt: 0.25,
          '& .MuiLinearProgress-bar': {
            borderRadius: 3,
          },
        }}
      />
    </Box>
  );
};

export default CompactProfileQualityBar;

