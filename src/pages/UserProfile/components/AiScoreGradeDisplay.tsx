import React from 'react';
import { Box, Stack, Tooltip, Typography } from '@mui/material';
import {
  formatOneDecimal,
  getRelativeAiScore,
  type ScoreSummary,
  type ScoringDistribution,
} from '../../../utils/scoreSummary';
import { resolveRecruiterPrimaryDisplay } from '../../../utils/scoring/recruiterPrimaryDisplay';
import { getRecruiterScoreDisplayForAdminUi, RECRUITER_SNAPSHOT_MISSING_LABEL } from '../../../utils/scoring/recruiterScoreSnapshot';
import type { WorkerInterviewAiBlock } from '../../../types/workerAiPrescreenInterview';
import { recruiterTableLetterGrade } from '../../../utils/recruiterUsersReadinessDisplay';
import { recordHeaderTooltipComponentsProps } from './recordHeaderStyles';

export type AiScoreGradeDisplayProps = {
  scoreSummary: ScoreSummary | undefined;
  scoringDistribution: ScoringDistribution | null;
  /** When set (profile page), matches header / interview operational layer */
  latestPrescreenInterviewAi?: WorkerInterviewAiBlock | null;
  recruiterScoreSnapshot?: unknown;
  /** Internal recruiters — primary score from snapshot only (no legacy / relative fallback). */
  useRecruiterSnapshotOnly?: boolean;
};

/**
 * Letter grade + numeric score — same precedence as Users table, with optional latest interview `ai` for alignment.
 */
const AiScoreGradeDisplay: React.FC<AiScoreGradeDisplayProps> = ({
  scoreSummary,
  scoringDistribution,
  latestPrescreenInterviewAi,
  recruiterScoreSnapshot,
  useRecruiterSnapshotOnly = false,
}) => {
  const snapDisp = getRecruiterScoreDisplayForAdminUi(recruiterScoreSnapshot);
  if (useRecruiterSnapshotOnly) {
    if (!snapDisp.hasSnapshot || snapDisp.score100 == null || Number.isNaN(snapDisp.score100)) {
      return (
        <Tooltip title={RECRUITER_SNAPSHOT_MISSING_LABEL} componentsProps={recordHeaderTooltipComponentsProps}>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
            —
          </Typography>
        </Tooltip>
      );
    }
    const rawSnap = Math.round(snapDisp.score100);
    const gradeSnap = snapDisp.grade ?? recruiterTableLetterGrade(rawSnap);
    let scoreColor: 'success.main' | 'warning.main' | 'text.primary' = 'text.primary';
    if (rawSnap >= 80) scoreColor = 'success.main';
    else if (rawSnap >= 60) scoreColor = 'warning.main';
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
              Recruiter score snapshot
            </Typography>
            <Typography variant="caption" color="inherit" sx={{ display: 'block', mb: 0.5, opacity: 0.9 }}>
              Canonical score for all recruiter views — components listed for context only.
            </Typography>
            <Stack spacing={0.25}>
              <Typography variant="body2">
                Primary: <strong>{rawSnap}</strong> (grade {gradeSnap})
              </Typography>
              <Typography variant="caption" color="inherit" sx={{ opacity: 0.85 }}>
                Operational {snapDisp.operationalScore100 ?? '—'} · Composite {snapDisp.compositeScore100 ?? '—'} · Base{' '}
                {snapDisp.interviewScoreBase100 ?? '—'}
              </Typography>
            </Stack>
          </Box>
        }
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.25, flexShrink: 0 }}>
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
              {gradeSnap}
            </Typography>
            <Typography variant="body2" color="text.primary" sx={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.8125rem' }}>
              {rawSnap}
            </Typography>
          </Box>
        </Box>
      </Tooltip>
    );
  }

  const displayPack = resolveRecruiterPrimaryDisplay({
    scoreSummary,
    latestPrescreenInterviewAi: latestPrescreenInterviewAi ?? null,
  });
  const rawScore = displayPack.primaryScore100;
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

  const secondary = displayPack.secondaryProfileComposite100;

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
            Primary: operational prescreen score when present — not the legacy profile composite alone.
          </Typography>
          <Stack spacing={0.25}>
            <Typography variant="body2">
              Operational (primary): <strong>{Math.round(rawScore)}</strong>
              {showRelative ? ` (relative: ${displayScore})` : ''}
            </Typography>
            {secondary != null && secondary !== rawScore ? (
              <Typography variant="caption" color="inherit" sx={{ opacity: 0.85 }}>
                Legacy profile/composite (secondary): <strong>{Math.round(secondary)}</strong>
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
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.25, flexShrink: 0 }}>
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
          <Typography variant="body2" color="text.primary" sx={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.8125rem' }}>
            {displayScore}
          </Typography>
        </Box>
        {secondary != null && Math.round(secondary) !== Math.round(rawScore) ? (
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', lineHeight: 1.2 }}>
            Profile {Math.round(secondary)}
          </Typography>
        ) : null}
      </Box>
    </Tooltip>
  );
};

export default AiScoreGradeDisplay;
