import React from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import type { ScoreSummary } from '../../../utils/scoreSummary';
import { formatOneDecimal } from '../../../utils/scoreSummary';

type Props = {
  /** AI score 0-100 (fallback: profileScore) */
  aiScore?: number;
  scoreSummary?: ScoreSummary;
};

const chipSx = {
  height: 28,
  fontWeight: 700,
};

export default function ScoreStack({ aiScore, scoreSummary }: Props) {
  const interviewAvg = scoreSummary?.interviewAvg;
  const interviewCount = scoreSummary?.interviewCount;
  const reviewAvg = scoreSummary?.reviewAvg;
  const reviewCount = scoreSummary?.reviewCount;

  return (
    <Box sx={{ mt: 1 }}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
        <Chip
          label={`AI ${aiScore !== undefined ? Math.round(aiScore) : '—'}`}
          color="primary"
          sx={chipSx}
        />
        <Chip
          label={`Interview ${formatOneDecimal(interviewAvg)}/10${interviewCount ? ` (${interviewCount})` : ''}`}
          variant="outlined"
          sx={chipSx}
        />
        <Chip
          label={`Reviews ${formatOneDecimal(reviewAvg)}/5${reviewCount ? ` (${reviewCount})` : ''}`}
          variant="outlined"
          sx={chipSx}
        />
        {!scoreSummary && (
          <Typography variant="caption" color="text.secondary">
            (Scores will populate as interviews/reviews are added)
          </Typography>
        )}
      </Stack>
    </Box>
  );
}

