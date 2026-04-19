import React from 'react';
import { Box, Stack, Tooltip, Typography } from '@mui/material';
import {
  formatOneDecimal,
  getCanonicalStoredAiScore,
  getRelativeAiScore,
  type ScoreSummary,
  type ScoringDistribution,
} from '../../../utils/scoreSummary';
import { resolveRecruiterPrimaryDisplay } from '../../../utils/scoring/recruiterPrimaryDisplay';
import {
  getRecruiterScoreDisplayForAdminUi,
  RECRUITER_SNAPSHOT_MISSING_LABEL,
} from '../../../utils/scoring/recruiterScoreSnapshot';
import { formatCategoryScoresCompactPreviewFromPartial } from '../../../utils/parseRecruiterCategoryScores';
import type { WorkerInterviewAiBlock } from '../../../types/workerAiPrescreenInterview';
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
  /** e.g. "Interviewed Apr 17, 2026 · 7/10" — shown under Recommendations when admin Risk column is visible */
  interviewSummaryLine?: string | null;
  latestPrescreenInterviewAi?: WorkerInterviewAiBlock | null;
  recruiterScoreSnapshot?: unknown;
  /** Recruiter record header — canonical snapshot only (no legacy primary fallback). */
  useRecruiterSnapshotOnly?: boolean;
};

/**
 * Score + category strengths + risk band + top concern + hiring-score recommendations (record header column).
 */
const RecordHeaderScoreSummaryBlock: React.FC<RecordHeaderScoreSummaryBlockProps> = ({
  scoreSummary,
  scoringDistribution,
  categoryScores,
  riskProfile,
  interviewSummaryLine,
  latestPrescreenInterviewAi,
  recruiterScoreSnapshot,
  useRecruiterSnapshotOnly = false,
}) => {
  const snapDisp = getRecruiterScoreDisplayForAdminUi(recruiterScoreSnapshot);
  const displayPack = useRecruiterSnapshotOnly
    ? snapDisp.hasSnapshot && snapDisp.score100 != null
      ? {
          primaryScore100: snapDisp.score100,
          primaryGrade: snapDisp.grade ?? recruiterTableLetterGrade(Math.round(snapDisp.score100)),
          secondaryProfileComposite100: null as number | null,
          hasConflict: false,
          conflictHint: null as string | null,
        }
      : {
          primaryScore100: null as number | null,
          primaryGrade: '—',
          secondaryProfileComposite100: null as number | null,
          hasConflict: false,
          conflictHint: null as string | null,
        }
    : resolveRecruiterPrimaryDisplay({
        scoreSummary,
        latestPrescreenInterviewAi: latestPrescreenInterviewAi ?? null,
      });
  const rawScore = displayPack.primaryScore100;
  const compositeScore = useRecruiterSnapshotOnly ? null : getCanonicalStoredAiScore(scoreSummary);
  const hasScore = rawScore !== null && !Number.isNaN(rawScore);
  const relativeScore = hasScore && !useRecruiterSnapshotOnly ? getRelativeAiScore(rawScore!, scoringDistribution) : null;
  const displayScore = relativeScore != null ? relativeScore : hasScore ? Math.round(rawScore!) : null;
  const grade = useRecruiterSnapshotOnly
    ? hasScore
      ? snapDisp.grade ?? recruiterTableLetterGrade(Math.round(rawScore!))
      : '—'
    : displayScore != null
      ? recruiterTableLetterGrade(displayScore)
      : '—';

  let scoreColor: 'success.main' | 'warning.main' | 'text.primary' = 'text.primary';
  if (displayScore != null) {
    if (displayScore >= 80) scoreColor = 'success.main';
    else if (displayScore >= 60) scoreColor = 'warning.main';
  }

  const strengths = topCategoryLabelsForRecordHeader(categoryScores, 3);
  const snapPreview = formatCategoryScoresCompactPreviewFromPartial(snapDisp.categoryScores);
  const strengthsLine =
    useRecruiterSnapshotOnly && snapDisp.hasSnapshot && snapPreview.length > 0
      ? snapPreview.slice(0, 3).join(' · ')
      : strengths.length > 0
        ? strengths.join(' · ')
        : null;
  const riskBand =
    useRecruiterSnapshotOnly && snapDisp.hasSnapshot
      ? snapDisp.riskLevel
        ? snapDisp.riskLevel.charAt(0).toUpperCase() + snapDisp.riskLevel.slice(1)
        : '—'
      : overallRiskBandLabel(riskProfile);
  const topConcernLine =
    useRecruiterSnapshotOnly && snapDisp.hasSnapshot
      ? snapDisp.riskSummary?.trim() || null
      : workerRiskPrimaryLine(riskProfile);

  const nextActions = (scoreSummary?.explainability?.nextActions ?? [])
    .map((a) => String(a?.label || '').trim())
    .filter(Boolean)
    .slice(0, 2);
  const firstGap = scoreSummary?.explainability?.missingFields?.[0];
  const recommendationLinesLegacy: string[] = [...nextActions];
  if (recommendationLinesLegacy.length < 2 && firstGap) {
    recommendationLinesLegacy.push(`Profile: add ${firstGap}`);
  }
  const recommendationLinesSnapshot =
    useRecruiterSnapshotOnly && snapDisp.hasSnapshot && snapDisp.reasoningSummary?.trim()
      ? snapDisp.reasoningSummary
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 4)
      : [];
  const recommendationLines =
    useRecruiterSnapshotOnly && snapDisp.hasSnapshot ? recommendationLinesSnapshot : recommendationLinesLegacy;

  const tooltipTitle = useRecruiterSnapshotOnly && snapDisp.hasSnapshot ? (
    <Box sx={{ p: 0.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        Recruiter score snapshot
      </Typography>
      <Stack spacing={0.25}>
        <Typography variant="body2">
          Canonical score (0–100): <strong>{hasScore ? Math.round(rawScore!) : '—'}</strong>
        </Typography>
        <Typography variant="caption" color="inherit" sx={{ opacity: 0.9 }}>
          Components: operational {snapDisp.operationalScore100 ?? '—'} · composite {snapDisp.compositeScore100 ?? '—'} ·
          interview base {snapDisp.interviewScoreBase100 ?? '—'}
        </Typography>
        {snapDisp.reasoningSummary?.trim() ? (
          <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
            {snapDisp.reasoningSummary.trim()}
          </Typography>
        ) : null}
        {riskProfile && (
          <Typography variant="caption" color="inherit" sx={{ display: 'block', mt: 0.5, opacity: 0.9 }}>
            Risk index: {riskProfile.overallRiskScore}
          </Typography>
        )}
      </Stack>
    </Box>
  ) : (
    <Box sx={{ p: 0.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        Score summary
      </Typography>
      <Stack spacing={0.25}>
        {hasScore ? (
          <Typography variant="body2">
            Operational (primary): <strong>{Math.round(rawScore!)}</strong>
            {relativeScore != null && displayScore != null ? ` (relative ${displayScore})` : ''}
          </Typography>
        ) : (
          <Typography variant="body2">No stored score yet</Typography>
        )}
        {compositeScore != null && hasScore && compositeScore !== rawScore ? (
          <Typography variant="caption" color="inherit" sx={{ opacity: 0.9 }}>
            Legacy profile/composite (secondary): <strong>{Math.round(compositeScore)}</strong>
          </Typography>
        ) : null}
        <Typography variant="body2">
          Interview avg: <strong>{formatOneDecimal(scoreSummary?.interviewAvg)}</strong>/10
        </Typography>
        <Typography variant="body2">
          Reviews: <strong>{formatOneDecimal(scoreSummary?.reviewAvg)}</strong>/5
        </Typography>
        {typeof scoreSummary?.overrideAdjustedScore === 'number' && (
          <>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              Prescreen trust: <strong>{Math.round(scoreSummary.overrideAdjustedScore)}</strong>
              {typeof scoreSummary.baseInterviewScore === 'number' ? (
                <Typography component="span" variant="caption" display="block" color="inherit">
                  Base {Math.round(scoreSummary.baseInterviewScore)}
                  {typeof scoreSummary.overrideScoreDelta === 'number'
                    ? ` → Δ ${scoreSummary.overrideScoreDelta >= 0 ? '+' : ''}${scoreSummary.overrideScoreDelta}`
                    : ''}
                  {scoreSummary.recruiterTrustLevel ? ` · ${scoreSummary.recruiterTrustLevel}` : ''}
                </Typography>
              ) : null}
            </Typography>
            {typeof scoreSummary.autoAdvanceEligible === 'boolean' && (
              <Typography variant="caption" display="block" color="inherit">
                Auto-advance: {scoreSummary.autoAdvanceEligible ? 'Yes' : 'No'}
              </Typography>
            )}
          </>
        )}
        {riskProfile && (
          <Typography variant="caption" color="inherit" sx={{ display: 'block', mt: 0.5, opacity: 0.9 }}>
            Risk index: {riskProfile.overallRiskScore}
          </Typography>
        )}
      </Stack>
    </Box>
  );

  if (useRecruiterSnapshotOnly && !snapDisp.hasSnapshot) {
    return (
      <Box sx={{ width: '100%', minWidth: 0 }}>
        <Stack spacing={0.35} alignItems="flex-start">
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem', lineHeight: 1.35 }}>
            {RECRUITER_SNAPSHOT_MISSING_LABEL}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', lineHeight: 1.35 }}>
            Needs review/rescore or next interview / server refresh.
          </Typography>
        </Stack>
      </Box>
    );
  }

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
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
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
            {!useRecruiterSnapshotOnly && displayPack.hasConflict ? (
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', maxWidth: 200 }}>
                Using operational interview score
              </Typography>
            ) : null}
          </Box>
          {useRecruiterSnapshotOnly && snapDisp.hasSnapshot ? (
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.62rem', lineHeight: 1.35 }}>
              Recruiter score shown everywhere is based on this snapshot.
            </Typography>
          ) : null}
          {!useRecruiterSnapshotOnly &&
          compositeScore != null &&
          hasScore &&
          Math.round(compositeScore) !== Math.round(rawScore!) ? (
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem' }}>
              Profile {Math.round(compositeScore)} (secondary)
            </Typography>
          ) : null}
          {useRecruiterSnapshotOnly && snapDisp.hasSnapshot ? (
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', lineHeight: 1.4 }}>
              Components: operational {snapDisp.operationalScore100 ?? '—'} · composite {snapDisp.compositeScore100 ?? '—'}{' '}
              · interview base {snapDisp.interviewScoreBase100 ?? '—'}
            </Typography>
          ) : null}
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
          {interviewSummaryLine ? (
            <Box
              sx={{
                pt: '2px',
                mt: recommendationLines.length > 0 ? 1.25 : 0.75,
                width: '100%',
              }}
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  fontSize: '0.72rem',
                  lineHeight: 1.4,
                  fontWeight: 400,
                }}
              >
                {interviewSummaryLine}
              </Typography>
            </Box>
          ) : null}
        </Stack>
      </Box>
    </Tooltip>
  );
};

export default RecordHeaderScoreSummaryBlock;
