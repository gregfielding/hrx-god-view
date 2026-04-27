import React, { useMemo } from 'react';
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
  parseRecruiterScoreSnapshot,
  RECRUITER_SNAPSHOT_MISSING_LABEL,
} from '../../../utils/scoring/recruiterScoreSnapshot';
import type { RecruiterScoreSnapshot } from '../../../types/recruiterScoreSnapshot';
import {
  deriveWhyThisDecision,
  reasoningSummaryLinesForUi,
  recruiterDecisionHeadline,
} from '../../../utils/scoring/deriveNextBestAction';
import { getRecruiterMasterDisplayForAdminUi } from '../../../utils/scoring/recruiterMasterScoreDisplay';
import type { WorkerInterviewAiBlock } from '../../../types/workerAiPrescreenInterview';
import type { PrescreenCategoryScoresV1 } from '../../../types/prescreenCategoryScores';
import type { WorkerRiskProfileV1 } from '../../../types/workerRiskProfile';
import { recruiterTableLetterGrade } from '../../../utils/recruiterUsersReadinessDisplay';
import {
  recordHeaderBodyTextSx,
  recordHeaderColumnTitleSx,
  recordHeaderTooltipComponentsProps,
} from './recordHeaderStyles';
import {
  overallRiskBandLabel,
  riskBandLineWithIndex,
  riskSummaryLineAfterIndexConsolidation,
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
  recruiterMasterScore?: unknown;
  /** Recruiter record header — canonical snapshot only (no legacy primary fallback). */
  useRecruiterSnapshotOnly?: boolean;
};

/** "ADVANCE" → "Advance" for single-line recommendation label. */
function recruiterHeadlineToSentenceCase(headline: string): string {
  const t = headline.trim();
  if (!t) return '—';
  return t.charAt(0) + t.slice(1).toLowerCase();
}

/**
 * Score + risk band + top concern + hiring-score recommendations (record header column).
 */
const RecordHeaderScoreSummaryBlock: React.FC<RecordHeaderScoreSummaryBlockProps> = ({
  scoreSummary,
  scoringDistribution,
  categoryScores,
  riskProfile,
  interviewSummaryLine,
  latestPrescreenInterviewAi,
  recruiterScoreSnapshot,
  recruiterMasterScore,
  useRecruiterSnapshotOnly = false,
}) => {
  const snapDisp = getRecruiterScoreDisplayForAdminUi(recruiterScoreSnapshot);
  const masterDisp = getRecruiterMasterDisplayForAdminUi({
    recruiterMasterScoreRaw: recruiterMasterScore,
    recruiterScoreSnapshotRaw: recruiterScoreSnapshot,
    userData: {
      scoreSummary,
      riskProfile,
      ...(categoryScores ? { categoryScoresCurrent: categoryScores } : {}),
    },
    latestPrescreenInterviewAi: latestPrescreenInterviewAi ?? null,
  });

  const snapParsed = useMemo(() => parseRecruiterScoreSnapshot(recruiterScoreSnapshot), [recruiterScoreSnapshot]);

  const strengthsForWhy = useMemo(() => {
    const out: string[] = [];
    const adj = latestPrescreenInterviewAi?.scoreAdjustmentReasons;
    const dec = latestPrescreenInterviewAi?.decisionAdjustmentReasons;
    if (Array.isArray(adj)) out.push(...adj.map((s) => String(s).trim()).filter(Boolean));
    if (out.length < 5 && Array.isArray(dec)) out.push(...dec.map((s) => String(s).trim()).filter(Boolean));
    return [...new Set(out)].slice(0, 5);
  }, [latestPrescreenInterviewAi]);

  const risksForWhy = useMemo(() => {
    const out: string[] = [];
    const ai = latestPrescreenInterviewAi;
    if (ai?.hardBlocks?.length) out.push(...ai.hardBlocks.map(String));
    if (ai?.softBlocks?.length) out.push(...ai.softBlocks.slice(0, 2).map(String));
    const rs = ai?.riskSummary;
    if (rs?.drug?.reason) out.push(`Drug: ${rs.drug.reason}`);
    if (rs?.background?.reason) out.push(`Background: ${rs.background.reason}`);
    return [...new Set(out)].slice(0, 3);
  }, [latestPrescreenInterviewAi]);

  const decisionForHeader =
    snapParsed?.decision ??
    (latestPrescreenInterviewAi?.hiringDecision?.decision as RecruiterScoreSnapshot['decision'] | undefined) ??
    null;
  const recommendationForHeader = snapParsed?.recommendation ?? latestPrescreenInterviewAi?.recommendation ?? null;
  const decisionHeadlineText = recruiterDecisionHeadline(decisionForHeader, recommendationForHeader);

  const whyThisDecisionLine = useMemo(
    () =>
      deriveWhyThisDecision({
        reasoningSummary: snapParsed?.reasoningSummary ?? null,
        riskLevel: snapParsed?.riskLevel ?? null,
        hardBlocks: latestPrescreenInterviewAi?.hardBlocks?.map(String) ?? [],
        strengths: strengthsForWhy,
        risks: risksForWhy,
      }),
    [
      snapParsed?.reasoningSummary,
      snapParsed?.riskLevel,
      latestPrescreenInterviewAi?.hardBlocks,
      strengthsForWhy,
      risksForWhy,
    ],
  );

  const showMasterRecommendationBlock = useRecruiterSnapshotOnly && masterDisp.score100 != null;

  const displayPack = useRecruiterSnapshotOnly
    ? masterDisp.score100 != null
      ? {
          primaryScore100: masterDisp.score100,
          primaryGrade: masterDisp.grade ?? recruiterTableLetterGrade(Math.round(masterDisp.score100)),
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
      ? masterDisp.grade ?? recruiterTableLetterGrade(Math.round(rawScore!))
      : '—'
    : displayScore != null
      ? recruiterTableLetterGrade(displayScore)
      : '—';

  let scoreColor: 'success.main' | 'warning.main' | 'text.primary' = 'text.primary';
  if (displayScore != null) {
    if (displayScore >= 80) scoreColor = 'success.main';
    else if (displayScore >= 60) scoreColor = 'warning.main';
  }

  const riskBand =
    useRecruiterSnapshotOnly && masterDisp.score100 != null
      ? masterDisp.riskLevel
        ? masterDisp.riskLevel.charAt(0).toUpperCase() + masterDisp.riskLevel.slice(1)
        : '—'
      : overallRiskBandLabel(riskProfile);
  const topConcernLine =
    useRecruiterSnapshotOnly && masterDisp.score100 != null
      ? riskSummaryLineAfterIndexConsolidation(snapDisp.riskSummary)
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
  const masterSummary = masterDisp.master?.summary?.trim();
  const snapReasoningLinesForUi = reasoningSummaryLinesForUi(snapDisp.reasoningSummary);
  const recommendationLinesSnapshot =
    useRecruiterSnapshotOnly && masterDisp.score100 != null && masterSummary
      ? masterSummary.split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 4)
      : useRecruiterSnapshotOnly && snapDisp.hasSnapshot && snapReasoningLinesForUi.length > 0
        ? snapReasoningLinesForUi.slice(0, 4)
        : [];
  const recommendationLines =
    useRecruiterSnapshotOnly && masterDisp.score100 != null
      ? recommendationLinesSnapshot.length
        ? recommendationLinesSnapshot
        : recommendationLinesLegacy
      : useRecruiterSnapshotOnly && snapDisp.hasSnapshot
        ? recommendationLinesSnapshot
        : recommendationLinesLegacy;

  const m = masterDisp.master;
  const c = m?.components;
  const ew = m?.effectiveWeights;

  const tooltipTitle = useRecruiterSnapshotOnly && masterDisp.score100 != null ? (
    <Box sx={{ p: 0.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        Master Recruiter Score
      </Typography>
      <Stack spacing={0.25}>
        <Typography variant="body2">
          Master (0–100): <strong>{hasScore ? Math.round(rawScore!) : '—'}</strong>
        </Typography>
        {c && ew ? (
          <Typography variant="caption" color="inherit" sx={{ opacity: 0.9 }}>
            Category {c.categoryScore ?? '—'} × {Math.round(ew.categoryScore * 100)}% · Interview {c.interviewScore ?? '—'} ×{' '}
            {Math.round(ew.interviewScore * 100)}% · Profile {c.profileScore ?? '—'} × {Math.round(ew.profileScore * 100)}%
          </Typography>
        ) : null}
        {snapDisp.hasSnapshot ? (
          <Typography variant="caption" color="inherit" sx={{ opacity: 0.75, display: 'block', mt: 0.5 }}>
            Supporting: operational {snapDisp.operationalScore100 ?? '—'} · composite {snapDisp.compositeScore100 ?? '—'} · base{' '}
            {snapDisp.interviewScoreBase100 ?? '—'}
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

  if (useRecruiterSnapshotOnly && masterDisp.score100 == null) {
    return (
      <Box sx={{ width: '100%', minWidth: 0 }}>
        <Stack spacing={0.35} alignItems="flex-start">
          <Typography variant="body2" sx={recordHeaderBodyTextSx}>
            {RECRUITER_SNAPSHOT_MISSING_LABEL}
          </Typography>
          <Typography variant="body2" sx={recordHeaderBodyTextSx}>
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
              <Typography variant="body2" sx={{ ...recordHeaderBodyTextSx, maxWidth: 200 }}>
                Using operational interview score
              </Typography>
            ) : null}
          </Box>
          {!useRecruiterSnapshotOnly &&
          compositeScore != null &&
          hasScore &&
          Math.round(compositeScore) !== Math.round(rawScore!) ? (
            <Typography variant="body2" sx={recordHeaderBodyTextSx}>
              Profile {Math.round(compositeScore)} (secondary)
            </Typography>
          ) : null}
          <Typography
            variant="body2"
            sx={{
              ...recordHeaderBodyTextSx,
              ...(riskBand === 'High'
                ? { color: 'error.main' }
                : riskBand === 'Medium' || riskBand === 'Moderate'
                  ? { color: 'warning.dark' }
                  : {}),
            }}
          >
            {riskBandLineWithIndex(riskBand, riskProfile, riskProfile)}
          </Typography>
          {topConcernLine ? (
            <Typography variant="body2" sx={recordHeaderBodyTextSx}>
              {topConcernLine}
            </Typography>
          ) : null}
          {showMasterRecommendationBlock ? (
            <Box sx={{ pt: 0.25 }}>
              <Typography variant="body2" sx={recordHeaderBodyTextSx}>
                Recommendation: {recruiterHeadlineToSentenceCase(decisionHeadlineText)}
              </Typography>
              <Typography variant="body2" sx={{ ...recordHeaderBodyTextSx, display: 'block', mt: 0.5 }}>
                {whyThisDecisionLine}
              </Typography>
            </Box>
          ) : recommendationLines.length > 0 ? (
            <Box sx={{ pt: 0.25 }}>
              <Typography variant="body2" sx={{ ...recordHeaderColumnTitleSx, mb: 0.35 }}>
                Recommendations
              </Typography>
              <Stack spacing={0.35} component="ul" sx={{ m: 0, pl: 2 }}>
                {recommendationLines.map((line, i) => (
                  <Typography
                    key={i}
                    component="li"
                    variant="body2"
                    sx={{ ...recordHeaderBodyTextSx, display: 'list-item' }}
                  >
                    {line}
                  </Typography>
                ))}
              </Stack>
            </Box>
          ) : null}
          {interviewSummaryLine ? (
            <Box
              sx={{
                pt: '2px',
                mt: showMasterRecommendationBlock || recommendationLines.length > 0 ? 1.25 : 0.75,
                width: '100%',
              }}
            >
              <Typography variant="body2" sx={recordHeaderBodyTextSx}>
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
