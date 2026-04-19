import React from 'react';
import { Box, Stack, Tooltip, Typography } from '@mui/material';
import {
  formatOneDecimal,
  getCanonicalStoredAiScore,
  getRelativeAiScore,
  type ScoreSummary,
  type ScoringDistribution,
} from '../../../utils/scoreSummary';
import { getRecruiterPrimaryScore100FromSummary } from '../../../utils/scoring/recruiterOperationalScore';
import { recruiterTableLetterGrade } from '../../../utils/recruiterUsersReadinessDisplay';
import { recordHeaderTooltipComponentsProps } from './recordHeaderStyles';

export type AiScoreGradeDisplayProps = {
  scoreSummary: ScoreSummary | undefined;
  scoringDistribution: ScoringDistribution | null;
};

/**
 * Letter grade + numeric score — same visual logic as {@link RecruiterUsers} `renderAiScore` (Score column).
 */
const AiScoreGradeDisplay: React.FC<AiScoreGradeDisplayProps> = ({ scoreSummary, scoringDistribution }) => {
  const rawScore = getRecruiterPrimaryScore100FromSummary(scoreSummary);
  const compositeScore = getCanonicalStoredAiScore(scoreSummary);
  if (rawScore === null || Number.isNaN(rawScore)) {
    return (
      <Tooltip
        title="No stored AI score yet (same field as Users table — interview submit or profile save after edit)."
        componentsProps={recordHeaderTooltipComponentsProps}
      >
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
          N/A
        </Typography>
      </Tooltip>
    );
  }

  const relativeScore = getRelativeAiScore(rawScore, scoringDistribution);
  const displayScore = relativeScore != null ? relativeScore : Math.round(rawScore);
  const showRelative = relativeScore != null;
  const grade = recruiterTableLetterGrade(displayScore);

  let scoreColor: 'success.main' | 'warning.main' | 'text.primary' = 'text.primary';
  if (displayScore >= 80) scoreColor = 'success.main';
  else if (displayScore >= 60) scoreColor = 'warning.main';

  return (
    <Tooltip
      arrow
      componentsProps={{
        ...recordHeaderTooltipComponentsProps,
        tooltip: {
          sx: {
            ...recordHeaderTooltipComponentsProps.tooltip.sx,
            maxWidth: 360,
          },
        },
      }}
      title={
        <Box sx={{ p: 0.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
            Score Summary
          </Typography>
          <Typography variant="caption" color="inherit" sx={{ display: 'block', mb: 0.5, opacity: 0.9 }}>
            Primary: operational score (prescreen trust when present), else composite Hiring Score.
          </Typography>
          <Stack spacing={0.25}>
            <Typography variant="body2">
              Operational / primary: <strong>{Math.round(rawScore)}</strong>
              {showRelative ? ` (relative: ${displayScore})` : ''}
            </Typography>
            {compositeScore != null && compositeScore !== rawScore ? (
              <Typography variant="caption" color="inherit" sx={{ opacity: 0.85 }}>
                Composite Hiring Score (scoreSummary.aiScore): <strong>{Math.round(compositeScore)}</strong>
              </Typography>
            ) : null}
            <Typography variant="body2">
              Interview: <strong>{formatOneDecimal(scoreSummary?.interviewAvg)}</strong>/10
              {scoreSummary?.interviewCount ? ` (${scoreSummary.interviewCount})` : ''}
            </Typography>
            <Typography variant="body2">
              Reviews: <strong>{formatOneDecimal(scoreSummary?.reviewAvg)}</strong>/5
              {scoreSummary?.reviewCount ? ` (${scoreSummary.reviewCount})` : ''}
            </Typography>
          </Stack>
        </Box>
      }
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, flexShrink: 0 }}>
        <Typography
          component="span"
          variant="body2"
          sx={{
            fontWeight: 700,
            color: scoreColor,
            fontSize: '0.8125rem',
            minWidth: 14,
          }}
        >
          {grade}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.8125rem' }}>
          {displayScore}
        </Typography>
      </Box>
    </Tooltip>
  );
};

export default AiScoreGradeDisplay;
