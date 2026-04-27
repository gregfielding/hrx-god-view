import React from 'react';
import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import type { ReadinessSummaryCardData } from './types';

interface ReadinessSummaryCardProps {
  data: ReadinessSummaryCardData;
  readinessMessage: string;
  primaryCtaLabel: string;
  onContinueSetup: () => void;
  onViewProfile: () => void;
}

const ReadinessSummaryCard: React.FC<ReadinessSummaryCardProps> = ({
  data,
  readinessMessage,
  primaryCtaLabel,
  onContinueSetup,
  onViewProfile,
}) => {
  const readinessPercent = Math.max(0, Math.min(100, data.readinessPercent || 0));
  const showCount = data.requiredCount > 0;

  return (
    <Card id="home-readiness-summary" variant="outlined">
      <CardContent>
        <Stack spacing={1.5}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Your Job Readiness
          </Typography>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>
            {showCount
              ? `${data.completedCount} of ${data.requiredCount} key items complete`
              : `${readinessPercent}% ready`}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {readinessMessage}
          </Typography>
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
              Complete the next steps below to improve your job matches and get selected faster.
            </Typography>
            <Box sx={{ width: '100%' }}>
              <Box
                sx={{
                  height: 8,
                  borderRadius: 4,
                  bgcolor: 'action.hover',
                  overflow: 'hidden',
                }}
              >
                <Box
                  sx={{
                    width: `${readinessPercent}%`,
                    height: '100%',
                    bgcolor: 'primary.main',
                  }}
                />
              </Box>
            </Box>
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button variant="contained" onClick={onContinueSetup}>
              {primaryCtaLabel}
            </Button>
            <Button variant="text" onClick={onViewProfile}>
              View profile
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default ReadinessSummaryCard;
