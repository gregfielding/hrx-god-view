import React from 'react';
import { Box, Stack, Tooltip, Typography } from '@mui/material';
import {
  formatOneDecimal,
  getCanonicalStoredAiScore,
  getRelativeAiScore,
  type ScoreSummary,
  type ScoringDistribution,
} from '../../../utils/scoreSummary';
import type { PrescreenCategoryScoresV1 } from '../../../types/prescreenCategoryScores';
import type { WorkerRiskProfileV1 } from '../../../types/workerRiskProfile';
import { recruiterTableLetterGrade } from '../../../utils/recruiterUsersReadinessDisplay';
import { recordHeaderTooltipComponentsProps } from './recordHeaderStyles';
import {
  overallRiskBandLabel,
  topCategoryLabelsForRecordHeader,
} from '../utils/recordHeaderScoreHelpers';
import { workerRiskPrimaryLine } from '../../../utils/workerRiskProfileDisplay';

export type RecordHeaderScoreSummaryBlockProps = {
  scoreSummary: ScoreSummary | undefined;
  scoringDistribution: ScoringDistribution | null;
  categoryScores: PrescreenCategoryScoresV1 | null;
  riskProfile: WorkerRiskProfileV1 | null;
};

/**
 * Score + category strengths + risk band + top concern + hiring-score recommendations (record header column).
 */
const RecordHeaderScoreSummaryBlock: React.FC<RecordHeaderScoreSummaryBlockProps> = ({
  scoreSummary,
  scoringDistribution,
  categoryScores,
  riskProfile,
}) => {
  const rawScore = getCanonicalStoredAiScore(scoreSummary);
  const hasScore = rawScore !== null && !Number.isNaN(rawScore);
  const relativeScore = hasScore ? getRelativeAiScore(rawScore!, scoringDistribution) : null;
  const displayScore = relativeScore != null ? relativeScore : hasScore ? Math.round(rawScore!) : null;
  const grade = displayScore != null ? recruiterTableLetterGrade(displayScore) : '—';

  let scoreColor: 'success.main' | 'warning.main' | 'text.primary' = 'text.primary';
  if (displayScore != null) {
    if (displayScore >= 80) scoreColor = 'success.main';
    else if (displayScore >= 60) scoreColor = 'warning.main';
  }

  const strengths = topCategoryLabelsForRecordHeader(categoryScores, 3);
  const strengthsLine = strengths.length > 0 ? strengths.join(' · ') : null;
  const riskBand = overallRiskBandLabel(riskProfile);
  const topConcernLine = workerRiskPrimaryLine(riskProfile);

  const nextActions = (scoreSummary?.explainability?.nextActions ?? [])
    .map((a) => String(a?.label || '').trim())
    .filter(Boolean)
    .slice(0, 2);
  const firstGap = scoreSummary?.explainability?.missingFields?.[0];
  const recommendationLines: string[] = [...nextActions];
  if (recommendationLines.length < 2 && firstGap) {
    recommendationLines.push(`Profile: add ${firstGap}`);
  }

  const tooltipTitle = (
    <Box sx={{ p: 0.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        Score summary
      </Typography>
      <Stack spacing={0.25}>
            {hasScore ? (
          <Typography variant="body2">
            Stored AI: <strong>{Math.round(rawScore!)}</strong>
            {relativeScore != null && displayScore != null ? ` (relative ${displayScore})` : ''}
          </Typography>
        ) : (
          <Typography variant="body2">No stored AI score yet</Typography>
        )}
        <Typography variant="body2">
          Interview avg: <strong>{formatOneDecimal(scoreSummary?.interviewAvg)}</strong>/10
        </Typography>
        <Typography variant="body2">
          Reviews: <strong>{formatOneDecimal(scoreSummary?.reviewAvg)}</strong>/5
        </Typography>
        {riskProfile && (
          <Typography variant="caption" color="inherit" sx={{ display: 'block', mt: 0.5, opacity: 0.9 }}>
            Risk index: {riskProfile.overallRiskScore}
          </Typography>
        )}
      </Stack>
    </Box>
  );

  return (
    <Tooltip
      arrow
      componentsProps={{
        ...recordHeaderTooltipComponentsProps,
        tooltip: { sx: { ...recordHeaderTooltipComponentsProps.tooltip.sx, maxWidth: 360 } },
      }}
      title={tooltipTitle}
    >
      <Box sx={{ width: '100%', minWidth: 0 }}>
        <Stack spacing={0.5} alignItems="flex-start">
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
            <Typography
              component="span"
              sx={{
                fontWeight: 800,
                color: scoreColor,
                fontSize: '1.75rem',
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {grade}
            </Typography>
            <Typography
              component="span"
              sx={{
                fontWeight: 700,
                color: 'text.primary',
                fontSize: '1.35rem',
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {displayScore ?? '—'}
            </Typography>
          </Box>
          {strengthsLine && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                fontSize: '0.68rem',
                fontWeight: 500,
                lineHeight: 1.35,
                display: 'block',
              }}
            >
              {strengthsLine}
            </Typography>
          )}
          <Typography
            variant="caption"
            sx={{
              fontSize: '0.68rem',
              fontWeight: 600,
              color:
                riskBand === 'High' ? 'error.main' : riskBand === 'Medium' ? 'warning.dark' : 'text.secondary',
            }}
          >
            Risk: {riskBand}
          </Typography>
          {topConcernLine ? (
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.74rem', lineHeight: 1.4 }}>
              {topConcernLine}
            </Typography>
          ) : null}
          {recommendationLines.length > 0 && (
            <Box sx={{ pt: 0.25 }}>
              <Typography
                variant="caption"
                sx={{
                  fontSize: '0.6rem',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'text.secondary',
                  display: 'block',
                  mb: 0.35,
                }}
              >
                Recommendations
              </Typography>
              <Stack spacing={0.35} component="ul" sx={{ m: 0, pl: 2 }}>
                {recommendationLines.map((line, i) => (
                  <Typography
                    key={i}
                    component="li"
                    variant="body2"
                    color="text.secondary"
                    sx={{ fontSize: '0.72rem', lineHeight: 1.4, display: 'list-item' }}
                  >
                    {line}
                  </Typography>
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </Box>
    </Tooltip>
  );
};

export default RecordHeaderScoreSummaryBlock;
