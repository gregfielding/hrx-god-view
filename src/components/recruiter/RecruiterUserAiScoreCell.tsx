import React from 'react';
import { Box, Stack, Tooltip, Typography } from '@mui/material';
import type { PrescreenCategoryScoresV1 } from '../../types/prescreenCategoryScores';
import type { RecruiterUser } from '../../types/recruiterUserListRow';
import { formatOneDecimal } from '../../utils/scoreSummary';
import { getRecruiterMasterDisplayForAdminUi } from '../../utils/scoring/recruiterMasterScoreDisplay';
import { getRecruiterScoreDisplayForAdminUi } from '../../utils/scoring/recruiterScoreSnapshot';
import {
  formatCategoryScoresCompactPreview,
  formatCategoryScoresCompactPreviewFromPartial,
} from '../../utils/parseRecruiterCategoryScores';
import { recruiterTableLetterGrade } from '../../utils/recruiterUsersReadinessDisplay';

export interface RecruiterUserAiScoreCellProps {
  user: RecruiterUser;
  /** Parsed `users/{uid}.categoryScoresCurrent` when available */
  categoryScoresCurrent?: PrescreenCategoryScoresV1 | null;
}

/**
 * Score column cell matching recruiter Users table (master score + category preview lines).
 */
const RecruiterUserAiScoreCell: React.FC<RecruiterUserAiScoreCellProps> = ({ user, categoryScoresCurrent: cat }) => {
  const userData: Record<string, unknown> = {
    scoreSummary: user.scoreSummary,
    riskProfile: user.riskProfile,
    ...(cat ? { categoryScoresCurrent: cat } : {}),
  };
  const masterDisp = getRecruiterMasterDisplayForAdminUi({
    recruiterMasterScoreRaw: user.recruiterMasterScore,
    recruiterScoreSnapshotRaw: user.recruiterScoreSnapshot,
    userData,
    latestPrescreenInterviewAi: null,
  });
  const snapDisp = getRecruiterScoreDisplayForAdminUi(user.recruiterScoreSnapshot);
  const categoryPreview =
    cat != null
      ? formatCategoryScoresCompactPreview(cat)
      : snapDisp.hasSnapshot && Object.keys(snapDisp.categoryScores || {}).length > 0
        ? formatCategoryScoresCompactPreviewFromPartial(snapDisp.categoryScores)
        : [];
  const categoryLine1 = categoryPreview.slice(0, 3).join(' · ');
  const categoryLine2 = categoryPreview.slice(3).join(' · ');
  const rawScore = masterDisp.score100;
  const m = masterDisp.master;
  if (rawScore === null || Number.isNaN(rawScore)) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.25 }}>
        <Typography variant="body2" color="text.secondary">
          N/A
        </Typography>
        {categoryLine1.length > 0 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: '0.65rem', lineHeight: 1.25, display: 'block', opacity: 0.88 }}
          >
            {categoryLine1}
          </Typography>
        )}
        {categoryLine2.length > 0 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: '0.65rem', lineHeight: 1.25, display: 'block', opacity: 0.88 }}
          >
            {categoryLine2}
          </Typography>
        )}
      </Box>
    );
  }
  const displayScore = Math.round(rawScore);
  const grade = masterDisp.grade ?? recruiterTableLetterGrade(displayScore);

  let scoreColor: 'success.main' | 'warning.main' | 'text.primary' = 'text.primary';
  if (displayScore >= 80) scoreColor = 'success.main';
  else if (displayScore >= 60) scoreColor = 'warning.main';

  const c = m?.components;
  const ew = m?.effectiveWeights;

  return (
    <Tooltip
      arrow
      title={
        <Box sx={{ p: 0.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
            Master Recruiter Score
          </Typography>
          <Typography variant="caption" color="inherit" sx={{ display: 'block', mb: 0.5, opacity: 0.9 }}>
            Blended category (50%) · interview (35%) · profile Hiring Score (15%), renormalized when inputs are missing.
          </Typography>
          <Stack spacing={0.25}>
            <Typography variant="body2">
              Master: <strong>{displayScore}</strong> (grade {grade})
              {masterDisp.computedFallback ? ' · computed locally' : ''}
            </Typography>
            {c && ew ? (
              <Typography variant="caption" color="inherit" sx={{ opacity: 0.92 }}>
                Category {c.categoryScore ?? '—'} × {Math.round(ew.categoryScore * 100)}% · Interview {c.interviewScore ?? '—'} ×{' '}
                {Math.round(ew.interviewScore * 100)}% · Profile {c.profileScore ?? '—'} × {Math.round(ew.profileScore * 100)}%
              </Typography>
            ) : null}
            <Typography variant="body2">
              Interview avg: <strong>{formatOneDecimal(user.scoreSummary?.interviewAvg)}</strong>/10
              {user.scoreSummary?.interviewCount ? ` (${user.scoreSummary.interviewCount})` : ''}
            </Typography>
            <Typography variant="body2">
              Reviews: <strong>{formatOneDecimal(user.scoreSummary?.reviewAvg)}</strong>/5
              {user.scoreSummary?.reviewCount ? ` (${user.scoreSummary.reviewCount})` : ''}
            </Typography>
          </Stack>
        </Box>
      }
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
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
          <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {displayScore}
          </Typography>
        </Box>
        {categoryLine1.length > 0 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: '0.65rem', lineHeight: 1.25, display: 'block', opacity: 0.88 }}
          >
            {categoryLine1}
          </Typography>
        )}
        {categoryLine2.length > 0 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: '0.65rem', lineHeight: 1.25, display: 'block', opacity: 0.88 }}
          >
            {categoryLine2}
          </Typography>
        )}
      </Box>
    </Tooltip>
  );
};

export default RecruiterUserAiScoreCell;
