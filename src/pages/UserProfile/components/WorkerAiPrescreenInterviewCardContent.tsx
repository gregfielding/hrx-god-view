/**
 * Latest Worker AI pre-screen snapshot on Interview tab — shared between collapsed (recruiter) and full layouts.
 */
import React from 'react';
import {
  Box,
  CardContent,
  CardHeader,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import type { WorkerInterviewAiBlock } from '../../../types/workerAiPrescreenInterview';
import {
  explanationLineForHiringDecision,
  formatHiringDecisionLabel,
  formatScoreRecommendationLabel,
  hiringDecisionChipColor,
  hiringDecisionChipVariant,
  labelForAiHiringReasonCode,
  labelForDynamicAnswerKey,
  labelForInterviewFlag,
  readDynamicAnswersFromAiContext,
  WORKER_AI_INTERVIEW_REC_VS_HIRING_DECISION_HELP,
} from '../../../utils/workerAiHiringDecisionDisplay';

export type WorkerAiPrescreenInterviewCardModel = {
  createdAt: Date;
  applicationId?: string | null;
  score10?: number;
  ai: WorkerInterviewAiBlock;
};

function recommendationChipColor(
  r: WorkerInterviewAiBlock['recommendation'],
): 'success' | 'warning' | 'error' {
  if (r === 'proceed') return 'success';
  if (r === 'caution' || r === 'decline') return 'error';
  return 'warning';
}

export function WorkerAiPrescreenInterviewCardContent({
  interview,
  demoted,
  formatDateFn,
}: {
  interview: WorkerAiPrescreenInterviewCardModel;
  demoted: boolean;
  formatDateFn: (d: Date) => string;
}) {
  const ai = interview.ai;
  const primaryNum =
    typeof ai.overrideAdjustedScore === 'number' ? ai.overrideAdjustedScore : ai.overallScore;
  const scoreLabel =
    typeof ai.overrideAdjustedScore === 'number'
      ? 'Operational score (adjusted)'
      : 'Interview score (base)';

  return (
    <>
      <CardHeader
        title={
          <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1}>
            <Typography
              component="span"
              variant={demoted ? 'subtitle1' : 'h6'}
              fontWeight={700}
              color={demoted ? 'text.primary' : undefined}
            >
              AI pre-screen
            </Typography>
            <Chip size="small" label="Worker AI" color="secondary" variant="outlined" />
            {interview.applicationId ? (
              <Chip size="small" label={`Application ${interview.applicationId}`} variant="outlined" />
            ) : null}
          </Stack>
        }
        subheader={demoted ? undefined : formatDateFn(interview.createdAt)}
      />
      <CardContent sx={{ pt: 0 }}>
        {!demoted ? (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
            {WORKER_AI_INTERVIEW_REC_VS_HIRING_DECISION_HELP}
          </Typography>
        ) : null}

        <Stack spacing={1.25} sx={{ mb: 1.5, opacity: demoted ? 0.92 : 1 }}>
          <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              {scoreLabel}
            </Typography>
            <Typography
              variant={demoted ? 'body2' : 'h6'}
              fontWeight={700}
              color={demoted ? 'text.primary' : 'primary'}
              sx={demoted ? { fontSize: '1.05rem', fontVariantNumeric: 'tabular-nums' } : undefined}
            >
              {primaryNum ?? '—'}/100
            </Typography>
            {interview.score10 !== undefined && (
              <Chip
                size="small"
                label={`${interview.score10}/10 (mapped)`}
                variant="outlined"
                sx={demoted ? { height: 22, '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } } : undefined}
              />
            )}
          </Stack>
          {typeof ai.overrideAdjustedScore === 'number' &&
          typeof ai.baseInterviewScore === 'number' &&
          ai.overrideAdjustedScore !== ai.baseInterviewScore ? (
            <Typography variant="caption" color="text.secondary" display="block">
              Interview score (base) {ai.baseInterviewScore} → Operational score (adjusted) {ai.overrideAdjustedScore}
              {typeof ai.overrideScoreDelta === 'number'
                ? ` (${ai.overrideScoreDelta >= 0 ? '+' : ''}${ai.overrideScoreDelta})`
                : ''}
              {ai.recruiterTrustLevel ? ` · Trust: ${ai.recruiterTrustLevel}` : ''}
            </Typography>
          ) : null}

          <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              Interview recommendation
            </Typography>
            <Chip
              size="small"
              label={formatScoreRecommendationLabel(ai.recommendation)}
              color={recommendationChipColor(ai.recommendation)}
            />
          </Stack>

          <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              Hiring decision
            </Typography>
            {ai.hiringDecision ? (
              <Chip
                size="small"
                label={formatHiringDecisionLabel(ai.hiringDecision.decision)}
                color={hiringDecisionChipColor(ai.hiringDecision.decision)}
                variant={hiringDecisionChipVariant(ai.hiringDecision.decision)}
              />
            ) : (
              <Chip size="small" label="Not evaluated" variant="outlined" />
            )}
            {ai.hiringDecision?.eligibleForAutoAdvance ? (
              <Chip size="small" label="Eligible for auto-advance (rules)" color="info" variant="outlined" />
            ) : null}
          </Stack>
        </Stack>

        {!demoted ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {ai.hiringDecision
              ? explanationLineForHiringDecision({
                  decision: ai.hiringDecision.decision,
                  reasonCodes: ai.hiringDecision.reasonCodes,
                })
              : 'Hiring decision has not been computed for this record yet.'}
          </Typography>
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            See Overview for the primary hiring summary. Details below are interview-record context.
          </Typography>
        )}

        {ai.hiringDecision && ai.hiringDecision.reasonCodes.length > 0 ? (
          <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mb: 1.5 }}>
            {ai.hiringDecision.reasonCodes.map((code) => (
              <Chip key={code} size="small" label={labelForAiHiringReasonCode(code)} variant="outlined" color="default" />
            ))}
          </Stack>
        ) : null}

        {ai.summary ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mb: 1.5,
              ...(demoted
                ? {
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical' as const,
                    overflow: 'hidden',
                  }
                : { whiteSpace: 'pre-wrap' }),
            }}
          >
            {ai.summary}
          </Typography>
        ) : null}

        {ai.flags.length > 0 ? (
          <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mb: 1 }}>
            {ai.flags.map((f) => (
              <Chip key={f} size="small" label={labelForInterviewFlag(f)} variant="outlined" />
            ))}
          </Stack>
        ) : (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            No risk flags
          </Typography>
        )}

        {(() => {
          const dyn = readDynamicAnswersFromAiContext(ai.aiInterviewContext);
          if (!dyn) return null;
          return (
            <Box sx={{ mb: 1 }}>
              <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.5 }}>
                Job-specific answers
              </Typography>
              <Stack spacing={0.25}>
                {Object.entries(dyn).map(([k, v]) => (
                  <Typography key={k} variant="caption" color="text.secondary">
                    {labelForDynamicAnswerKey(k)}: <strong>{v}</strong>
                  </Typography>
                ))}
              </Stack>
            </Box>
          );
        })()}

        {(ai.hiringDecision?.reasonCodes.includes('gig_path_eligible') || ai.alternatePaths?.gigEligible) && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Gig path may be available as an alternate path when the primary role is not a fit.
          </Typography>
        )}

        {interview.applicationId ? (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            Application ID: {interview.applicationId}
          </Typography>
        ) : null}
      </CardContent>
    </>
  );
}
