import React, { useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CardHeader,
  Collapse,
  FormControlLabel,
  LinearProgress,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import PsychologyIcon from '@mui/icons-material/Psychology';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import TuneIcon from '@mui/icons-material/Tune';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import type { ScoreIntelligence } from '../../types/scoreIntelligence';
import {
  QUALIFICATION_BREAKDOWN_RAW_MAX,
  normalizeQualificationScores,
  qualificationBarDisplayPercent,
  qualificationSeverityBand,
  rawQualificationPointsToPercentages,
} from '../../utils/scoring/normalizeQualificationScores';
import {
  QUALIFICATION_DISPLAY_LABEL,
  QUALIFICATION_DISPLAY_ORDER,
  qualificationNormalizedPercent,
} from '../../utils/scoring/qualificationDisplayOrder';
import ScoreProvenanceSummary from './ScoreProvenanceSummary';

function decisionLabel(d: 'advance' | 'review' | 'reject' | null | undefined): string {
  switch (d) {
    case 'advance':
      return 'Advance';
    case 'review':
      return 'Review';
    case 'reject':
      return 'Reject';
    default:
      return '—';
  }
}

/** Maps internal panel codes back to interview recommendation vocabulary. */
function recommendationHuman(m: 'advance' | 'review' | 'reject' | null | undefined): string {
  if (m === 'advance') return 'Proceed';
  if (m === 'review') return 'Review';
  if (m === 'reject') return 'Decline';
  return '—';
}

function confidenceLabel(c: 'low' | 'medium' | 'high'): string {
  switch (c) {
    case 'low':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'high':
      return 'High';
    default:
      return c;
  }
}

function confidenceColor(c: 'low' | 'medium' | 'high'): 'error' | 'warning' | 'success' {
  if (c === 'low') return 'error';
  if (c === 'medium') return 'warning';
  return 'success';
}

export type ScoreIntelligencePanelProps = {
  intelligence: ScoreIntelligence | null;
  loading?: boolean;
  /** Shown when "Show raw scoring data" is enabled */
  rawDebugPayload?: unknown;
  /** From `classifyScoreFreshness` — e.g. Fresh / Possibly stale / Refresh recommended */
  freshnessHeadline?: string | null;
};

export default function ScoreIntelligencePanel({
  intelligence,
  loading,
  rawDebugPayload,
  freshnessHeadline,
}: ScoreIntelligencePanelProps) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <Card
      variant="outlined"
      sx={{
        borderColor: 'primary.main',
        borderWidth: 1,
        boxShadow: (t) => t.shadows[2],
      }}
    >
      <CardHeader
        title="Score intelligence"
        subheader="Interview score vs operational score vs current decision — plain language, no raw engine flags."
        titleTypographyProps={{ variant: 'h6', fontWeight: 800 }}
        subheaderTypographyProps={{ variant: 'body2', color: 'text.secondary', sx: { mt: 0.5 } }}
        avatar={<PsychologyIcon color="primary" />}
        action={
          <FormControlLabel
            control={<Switch size="small" checked={showRaw} onChange={(_, v) => setShowRaw(v)} />}
            label={<Typography variant="caption">Show raw scoring data</Typography>}
            sx={{ mr: 0, alignItems: 'center' }}
          />
        }
      />
      <CardContent sx={{ pt: 0 }}>
        {loading ? (
          <Typography variant="body2" color="text.secondary">
            Loading interview intelligence…
          </Typography>
        ) : !intelligence ? (
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 720 }}>
            No worker AI pre-screen interview on file yet. When this worker completes a pre-screen, a plain-language
            breakdown of strengths, risks, and next steps will appear here.
          </Typography>
        ) : (
          <Stack spacing={2.5}>
            <ScoreProvenanceSummary
              operationalScore100={intelligence.summary.operationalScore}
              interviewScore100={intelligence.summary.interviewScore}
              profileComposite100={intelligence.summary.compositeHiringScore100}
              showComposite={Boolean(intelligence.summary.compositeHiringScoreLabel)}
              decisionSourceLabel={intelligence.summary.decisionSourceLabel}
              lastUpdatedLabel={intelligence.summary.lastUpdatedLabel}
              correctionApplied={intelligence.summary.correctionAppliedDisplay}
            />
            {freshnessHeadline ? (
              <Typography variant="caption" color="text.secondary">
                Score freshness: <strong>{freshnessHeadline}</strong>
              </Typography>
            ) : null}
            {intelligence.summary.adjustmentSummaryLines.length > 0 ? (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.5 }}>
                  Adjustment summary
                </Typography>
                <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2 }}>
                  {intelligence.summary.adjustmentSummaryLines.map((line) => (
                    <Typography key={line} component="li" variant="body2" color="text.primary">
                      {line}
                    </Typography>
                  ))}
                </Stack>
              </Box>
            ) : null}
            {intelligence.summary.autoAdvanceEligible === false &&
            intelligence.summary.autoAdvanceBlockedReasons.length > 0 ? (
              <Alert severity="info" icon={false} sx={{ py: 0.75 }}>
                <Typography variant="caption" fontWeight={700} display="block" gutterBottom>
                  Why not auto-advance?
                </Typography>
                <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2 }}>
                  {intelligence.summary.autoAdvanceBlockedReasons.map((line) => (
                    <Typography key={line} component="li" variant="body2">
                      {line}
                    </Typography>
                  ))}
                </Stack>
              </Alert>
            ) : null}
            {/* 1 — At a glance: scores + decision */}
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
                At a glance
              </Typography>
              <Stack spacing={1}>
                <Stack direction="row" flexWrap="wrap" alignItems="baseline" gap={2}>
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Interview score (base)
                    </Typography>
                    <Typography variant="h5" component="p" sx={{ fontWeight: 800, m: 0 }}>
                      {intelligence.summary.interviewScore}
                      <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
                        / 100
                      </Typography>
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Operational score (trust)
                    </Typography>
                    <Typography variant="h5" component="p" sx={{ fontWeight: 800, m: 0, color: 'primary.main' }}>
                      {intelligence.summary.operationalScore}
                      <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
                        / 100
                      </Typography>
                    </Typography>
                  </Box>
                  {intelligence.summary.scoreDelta != null && intelligence.summary.scoreDelta !== 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'flex-end' }}>
                      Δ {intelligence.summary.scoreDelta >= 0 ? '+' : ''}
                      {intelligence.summary.scoreDelta}
                    </Typography>
                  ) : null}
                </Stack>

                <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    Recommendation: {recommendationHuman(intelligence.summary.recommendation)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    ·
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    Hiring decision: {decisionLabel(intelligence.summary.hiringDecision)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    · Auto-advance:{' '}
                    {intelligence.summary.autoAdvanceEligible === true
                      ? 'Yes'
                      : intelligence.summary.autoAdvanceEligible === false
                        ? 'No'
                        : '—'}
                  </Typography>
                </Stack>

                <Typography variant="body2" color="text.secondary">
                  Panel decision emphasis:{' '}
                  <Typography component="span" fontWeight={700} color="text.primary">
                    {decisionLabel(intelligence.summary.decision)}
                  </Typography>
                  {' · '}
                  Confidence:{' '}
                  <Typography
                    component="span"
                    color={`${confidenceColor(intelligence.summary.confidence)}.main`}
                    fontWeight={700}
                  >
                    {confidenceLabel(intelligence.summary.confidence)}
                  </Typography>
                </Typography>
              </Stack>

              {intelligence.summary.operationalCorrectionApplied ? (
                <Alert severity="info" sx={{ mt: 1.5 }}>
                  <strong>Operational correction applied</strong>
                  {intelligence.summary.operationalCorrectionLines.length > 0 ? (
                    <Stack component="ul" spacing={0.25} sx={{ m: 0, mt: 0.5, pl: 2 }}>
                      {intelligence.summary.operationalCorrectionLines.map((line) => (
                        <Typography key={line} component="li" variant="body2">
                          {line}
                        </Typography>
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="body2" sx={{ mt: 0.5 }}>
                      Adjusted for operations — prefer operational score over raw interview score for next steps.
                    </Typography>
                  )}
                </Alert>
              ) : intelligence.summary.overrideSuggested ? (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  <strong>Manual review suggested:</strong> fundamentals (transportation, attendance, physical fit) look workable
                  and there is no explicit hard-stop screening failure. Consider{' '}
                  <strong>{decisionLabel(intelligence.summary.suggestedDecision ?? 'review')}</strong> instead of an
                  automatic reject.
                </Alert>
              ) : null}
            </Box>

            <Typography variant="overline" color="text.secondary" sx={{ display: 'block' }}>
              Recruiter interpretation
            </Typography>
            {/* 2 — Strengths */}
            <Box>
              <Stack direction="row" alignItems="center" gap={0.75} sx={{ mb: 0.75 }}>
                <CheckCircleOutlineIcon color="success" fontSize="small" />
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                  Strengths
                </Typography>
              </Stack>
              {intelligence.strengths.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No clear strengths extracted from structured answers.
                </Typography>
              ) : (
                <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.25 }}>
                  {intelligence.strengths.map((s) => (
                    <Typography key={s} component="li" variant="body2" color="text.primary">
                      {s}
                    </Typography>
                  ))}
                </Stack>
              )}
            </Box>

            {/* 3 — Risks */}
            <Box>
              <Stack direction="row" alignItems="center" gap={0.75} sx={{ mb: 0.75 }}>
                <WarningAmberIcon color="warning" fontSize="small" />
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                  Risks &amp; soft signals
                </Typography>
              </Stack>
              {intelligence.risks.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No notable risk flags on this interview.
                </Typography>
              ) : (
                <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.25 }}>
                  {intelligence.risks.map((r) => (
                    <Typography key={r} component="li" variant="body2" color="text.primary">
                      {r}
                    </Typography>
                  ))}
                </Stack>
              )}
            </Box>

            {/* 4 — Breakdown bars (display-only normalization: risk first, capped bar width, severity bands) */}
            <Box>
              <Stack direction="row" alignItems="center" gap={0.75} sx={{ mb: 1 }}>
                <TuneIcon color="action" fontSize="small" />
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                  Interview model sub-scores (how answers were scored)
                </Typography>
              </Stack>
              <Stack spacing={1.25}>
                {(() => {
                  const normalized = normalizeQualificationScores(
                    rawQualificationPointsToPercentages(intelligence.breakdown),
                  );
                  return QUALIFICATION_DISPLAY_ORDER.map((dim) => {
                    const max = QUALIFICATION_BREAKDOWN_RAW_MAX[dim];
                    const v = intelligence.breakdown[dim];
                    const displayPct = qualificationNormalizedPercent(normalized, dim);
                    const barValue = qualificationBarDisplayPercent(displayPct);
                    const lowBand = qualificationSeverityBand(displayPct);
                    const barSx =
                      lowBand === 'strong'
                        ? {
                            height: 8,
                            borderRadius: 1,
                            bgcolor: 'action.hover',
                            '& .MuiLinearProgress-bar': {
                              bgcolor: 'error.main',
                            },
                          }
                        : lowBand === 'mid'
                          ? {
                              height: 8,
                              borderRadius: 1,
                              bgcolor: 'action.hover',
                              '& .MuiLinearProgress-bar': {
                                bgcolor: 'warning.main',
                              },
                            }
                          : { height: 8, borderRadius: 1 };

                    return (
                      <Box key={dim}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.35 }}>
                          <Typography
                            variant="caption"
                            color={dim === 'physical' ? 'text.disabled' : 'text.secondary'}
                            sx={{ fontWeight: dim === 'physical' ? 500 : 600 }}
                          >
                            {QUALIFICATION_DISPLAY_LABEL[dim]}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {Math.round(v)} / {max}
                          </Typography>
                        </Stack>
                        <LinearProgress variant="determinate" value={barValue} sx={barSx} />
                      </Box>
                    );
                  });
                })()}
              </Stack>
            </Box>

            {/* 5 — Reasoning */}
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.75 }}>
                How to read this score
              </Typography>
              <Stack component="ol" spacing={0.5} sx={{ m: 0, pl: 2.25 }}>
                {intelligence.reasoning.map((r) => (
                  <Typography key={r} component="li" variant="body2" color="text.primary">
                    {r}
                  </Typography>
                ))}
              </Stack>
            </Box>

            {/* 6 — Improvements */}
            {intelligence.improvements.length > 0 ? (
              <Box>
                <Stack direction="row" alignItems="center" gap={0.75} sx={{ mb: 0.75 }}>
                  <LightbulbOutlinedIcon color="info" fontSize="small" />
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                    Suggested next steps
                  </Typography>
                </Stack>
                <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.25 }}>
                  {intelligence.improvements.map((x) => (
                    <Typography key={x} component="li" variant="body2">
                      {x}
                    </Typography>
                  ))}
                </Stack>
              </Box>
            ) : null}
          </Stack>
        )}

        <Collapse in={showRaw}>
          <Box
            sx={{
              mt: 2,
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'action.hover',
              border: '1px solid',
              borderColor: 'divider',
              maxHeight: 360,
              overflow: 'auto',
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Raw debug (support / QA only)
            </Typography>
            <Typography
              component="pre"
              variant="caption"
              sx={{
                m: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'ui-monospace, monospace',
                fontSize: 11,
              }}
            >
              {rawDebugPayload !== undefined ? JSON.stringify(rawDebugPayload, null, 2) : '—'}
            </Typography>
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
}
