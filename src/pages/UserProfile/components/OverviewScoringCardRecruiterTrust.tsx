/**
 * Condensed “recruiter trust” scoring panel for Overview — single Hiring Score, decision-first layout.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { ScoreSummary } from '../../../utils/scoreSummary';
import { formatOneDecimal } from '../../../utils/scoreSummary';
import { parseRecruiterScoreSnapshot } from '../../../utils/scoring/recruiterScoreSnapshot';
import type { RecruiterScoreSnapshot } from '../../../types/recruiterScoreSnapshot';
import type { WorkerInterviewAiBlock } from '../../../types/workerAiPrescreenInterview';
import { useCategoryScoresCurrent } from '../../../hooks/useCategoryScoresCurrent';
import type { PrescreenCategoryScoresV1 } from '../../../types/prescreenCategoryScores';
import {
  averageCategoryScore,
  categoryScoreBand,
} from '../../../utils/parseRecruiterCategoryScores';
import {
  fetchRecentCategoryScoreEvents,
  formatCategoryScoreEventSourceLabel,
  type CategoryScoreEventRow,
} from '../../../utils/categoryScoreEvolution';
import { deriveSystemDecisionConfidence } from '../../../utils/scoring/deriveSystemDecisionConfidence';
import { deriveWhyThisDecision, recruiterDecisionHeadline } from '../../../utils/scoring/deriveNextBestAction';
import { getRecruiterMasterDisplayForAdminUi } from '../../../utils/scoring/recruiterMasterScoreDisplay';
import {
  normalizeQualificationScores,
  normalizeQualificationSubScoreValue,
  qualificationBarDisplayPercent,
  qualificationSeverityBand,
  rawQualificationPointsToPercentages,
  QUALIFICATION_BREAKDOWN_RAW_MAX,
} from '../../../utils/scoring/normalizeQualificationScores';
import {
  QUALIFICATION_DISPLAY_LABEL,
  QUALIFICATION_DISPLAY_ORDER,
  qualificationNormalizedPercent,
} from '../../../utils/scoring/qualificationDisplayOrder';
import { normalizeRiskProfileFromUserDoc } from '../../../utils/workerRiskProfileDisplay';
import { riskBandLineWithIndex } from '../utils/recordHeaderScoreHelpers';
import { overviewBodyChipSx } from './overviewBodyChipSx';

export type OverviewScoringDecisionControls = {
  /** Shown in the Scoring card header (e.g. Review & rescore). Consumed by parent `OverviewScoringCard`. */
  reviewRescoreSlot?: React.ReactNode;
  /** Display name when snapshot was produced in manual review */
  manualOverrideLabel?: string | null;
};
const CATEGORY_ROWS: { key: keyof PrescreenCategoryScoresV1; label: string }[] = [
  { key: 'reliability', label: 'Reliability' },
  { key: 'punctuality', label: 'Punctuality' },
  { key: 'workEthic', label: 'Work ethic' },
  { key: 'teamFit', label: 'Team fit' },
  { key: 'jobReadiness', label: 'Job readiness' },
  { key: 'stability', label: 'Stability' },
];

function bandSx(band: 'high' | 'medium' | 'low'): { bgcolor: string } {
  if (band === 'high') return { bgcolor: 'success.main' };
  if (band === 'medium') return { bgcolor: 'warning.main' };
  return { bgcolor: 'error.main' };
}

function decisionHeadline(
  d: RecruiterScoreSnapshot['decision'],
  recommendation: RecruiterScoreSnapshot['recommendation'],
): string {
  if (d) {
    switch (d) {
      case 'advance':
        return 'ADVANCE';
      case 'review':
        return 'REVIEW';
      case 'reject':
        return 'REJECT';
      case 'hold':
        return 'HOLD';
      default:
        break;
    }
  }
  if (recommendation === 'proceed') return 'ADVANCE';
  if (recommendation === 'decline') return 'REJECT';
  return 'REVIEW';
}

/** Title case for compact summary lines (ADVANCE → Advance). */
function decisionHeadlineTitleCase(
  d: RecruiterScoreSnapshot['decision'],
  recommendation: RecruiterScoreSnapshot['recommendation'],
): string {
  const h = decisionHeadline(d, recommendation);
  return h.charAt(0) + h.slice(1).toLowerCase();
}

function recommendationLabel(r: RecruiterScoreSnapshot['recommendation']): string {
  switch (r) {
    case 'proceed':
      return 'Proceed';
    case 'review':
      return 'Review';
    case 'caution':
      return 'Caution';
    case 'decline':
      return 'Decline';
    default:
      return '—';
  }
}

function riskLabel(r: RecruiterScoreSnapshot['riskLevel']): string {
  if (!r) return '—';
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function mergeCategoryScores(
  profile: PrescreenCategoryScoresV1 | null,
  snap: RecruiterScoreSnapshot['categoryScores'] | undefined,
): PrescreenCategoryScoresV1 | null {
  if (profile) return profile;
  if (!snap || typeof snap !== 'object') return null;
  const nums = CATEGORY_ROWS.map(({ key }) => snap[key as keyof typeof snap]);
  if (nums.every((n) => n == null || !Number.isFinite(n as number))) return null;
  return {
    version: 1,
    reliability: Math.round(Number(snap.reliability ?? 0)),
    punctuality: Math.round(Number(snap.punctuality ?? 0)),
    workEthic: Math.round(Number(snap.workEthic ?? 0)),
    teamFit: Math.round(Number(snap.teamFit ?? 0)),
    jobReadiness: Math.round(Number(snap.jobReadiness ?? 0)),
    stability: Math.round(Number(snap.stability ?? 0)),
  };
}

/** Interview signal strip — bands from primary hiring score (0–100), not generic adjectives. */
function interviewSignalLabel(params: {
  hiringScore: number | null;
  recommendation: RecruiterScoreSnapshot['recommendation'];
}): string {
  const { hiringScore, recommendation } = params;
  if (recommendation === 'decline') return 'Needs review';
  if (recommendation === 'caution' || recommendation === 'review') return 'Needs review';
  if (hiringScore == null) return '—';
  if (hiringScore >= 80) return 'Strong';
  if (hiringScore >= 60) return 'Moderate';
  return 'Needs review';
}

function formatInterviewDate(scoreSummary: ScoreSummary | undefined, ai?: WorkerInterviewAiBlock | null): string {
  const ts = scoreSummary?.interviewLastAt as { toDate?: () => Date } | undefined;
  try {
    const d = ts?.toDate?.() ?? (scoreSummary?.interviewLastAt instanceof Date ? scoreSummary.interviewLastAt : null);
    if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
}

function eventSparklineValues(events: CategoryScoreEventRow[]): number[] {
  const deltas = events
    .slice(0, 8)
    .reverse()
    .map((e) => {
      const ad = e.appliedDelta;
      const d = e.delta;
      if (typeof ad === 'number' && Number.isFinite(ad)) return ad;
      if (typeof d === 'number' && Number.isFinite(d)) return d;
      return 0;
    });
  if (deltas.length === 0) return [];
  const max = Math.max(...deltas.map((x) => Math.abs(x)), 1);
  return deltas.map((x) => (Math.abs(x) / max) * 100);
}

function MiniSparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 22;
  const pad = 2;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - (v / 100) * (h - pad * 2);
    return `${x},${y}`;
  });
  return (
    <Box sx={{ mt: 0.25, opacity: 0.85 }} aria-hidden>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          points={pts.join(' ')}
          style={{ color: 'inherit' }}
        />
      </svg>
    </Box>
  );
}

export type OverviewScoringCardRecruiterTrustProps = {
  uid: string;
  scoreSummary: ScoreSummary | undefined;
  riskProfileRaw?: unknown;
  recruiterScoreSnapshotRaw: unknown;
  recruiterMasterScoreRaw?: unknown;
  latestPrescreenInterviewAi?: WorkerInterviewAiBlock | null;
  decisionControls?: OverviewScoringDecisionControls;
};

export function OverviewScoringCardRecruiterTrust({
  uid,
  scoreSummary,
  riskProfileRaw,
  recruiterScoreSnapshotRaw,
  recruiterMasterScoreRaw,
  latestPrescreenInterviewAi,
  decisionControls,
}: OverviewScoringCardRecruiterTrustProps) {
  const snap = parseRecruiterScoreSnapshot(recruiterScoreSnapshotRaw);
  const { scores: profileCategoryScores } = useCategoryScoresCurrent(uid);

  const masterDisp = useMemo(
    () =>
      getRecruiterMasterDisplayForAdminUi({
        recruiterMasterScoreRaw: recruiterMasterScoreRaw,
        recruiterScoreSnapshotRaw,
        userData: {
          scoreSummary,
          riskProfile: riskProfileRaw,
          ...(profileCategoryScores ? { categoryScoresCurrent: profileCategoryScores } : {}),
        },
        latestPrescreenInterviewAi: latestPrescreenInterviewAi ?? null,
      }),
    [
      recruiterMasterScoreRaw,
      recruiterScoreSnapshotRaw,
      scoreSummary,
      riskProfileRaw,
      profileCategoryScores,
      latestPrescreenInterviewAi,
    ],
  );

  const hiringScore = masterDisp.score100;
  const risk = normalizeRiskProfileFromUserDoc(riskProfileRaw);

  const decision =
    snap?.decision ??
    (latestPrescreenInterviewAi?.hiringDecision?.decision as RecruiterScoreSnapshot['decision'] | undefined) ??
    null;
  const recommendation =
    snap?.recommendation ?? latestPrescreenInterviewAi?.recommendation ?? null;

  const headline = recruiterDecisionHeadline(decision, recommendation);

  const mergedCats = useMemo(
    () => mergeCategoryScores(profileCategoryScores, snap?.categoryScores),
    [profileCategoryScores, snap?.categoryScores],
  );
  const categoryAvg = mergedCats ? averageCategoryScore(mergedCats) : null;
  const signalWord = interviewSignalLabel({
    hiringScore,
    recommendation: snap?.recommendation ?? null,
  });

  const interviewCount = scoreSummary?.interviewCount ?? 0;
  const lastInterviewLabel = formatInterviewDate(scoreSummary, latestPrescreenInterviewAi);

  const [historyEvents, setHistoryEvents] = useState<CategoryScoreEventRow[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchRecentCategoryScoreEvents(uid, 8);
        if (!cancelled) {
          setHistoryEvents(rows);
          setHistoryError(null);
        }
      } catch {
        if (!cancelled) {
          setHistoryEvents([]);
          setHistoryError('History requires permission to read score events.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const historyLines = useMemo(() => {
    return historyEvents.slice(0, 3).map((ev) => {
      const applied =
        typeof ev.appliedDelta === 'number' && Number.isFinite(ev.appliedDelta)
          ? ev.appliedDelta
          : typeof ev.delta === 'number'
            ? ev.delta
            : 0;
      const sign = applied > 0 ? '+' : '';
      const src = formatCategoryScoreEventSourceLabel(ev.source);
      let dateStr = '';
      try {
        const t = ev.createdAt as { toDate?: () => Date } | undefined;
        const d = t?.toDate?.();
        if (d instanceof Date && !Number.isNaN(d.getTime())) {
          dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
      } catch {
        /* ignore */
      }
      return `${sign}${applied} from ${src}${dateStr ? ` (${dateStr})` : ''}`;
    });
  }, [historyEvents]);

  const sparkVals = useMemo(() => eventSparklineValues(historyEvents), [historyEvents]);

  const strengths = useMemo(() => {
    const out: string[] = [];
    const adj = latestPrescreenInterviewAi?.scoreAdjustmentReasons;
    const dec = latestPrescreenInterviewAi?.decisionAdjustmentReasons;
    if (Array.isArray(adj)) out.push(...adj.map((s) => String(s).trim()).filter(Boolean));
    if (out.length < 5 && Array.isArray(dec)) out.push(...dec.map((s) => String(s).trim()).filter(Boolean));
    return [...new Set(out)].slice(0, 5);
  }, [latestPrescreenInterviewAi]);

  const risks = useMemo(() => {
    const out: string[] = [];
    const ai = latestPrescreenInterviewAi;
    if (ai?.hardBlocks?.length) out.push(...ai.hardBlocks.map(String));
    if (ai?.softBlocks?.length) out.push(...ai.softBlocks.slice(0, 2).map(String));
    const rs = ai?.riskSummary;
    if (rs?.drug?.reason) out.push(`Drug: ${rs.drug.reason}`);
    if (rs?.background?.reason) out.push(`Background: ${rs.background.reason}`);
    return [...new Set(out)].slice(0, 3);
  }, [latestPrescreenInterviewAi]);

  const passedChecks =
    !latestPrescreenInterviewAi?.hardBlocks?.length && latestPrescreenInterviewAi?.recommendation !== 'decline';

  const sub = latestPrescreenInterviewAi?.subScores;

  // Convert backend sub-score raw points (mixed maxes: experience 25, reliability 25,
  // transportation 20, risk 20, physical 10 — summing to 100) to comparable 0-100
  // percentages, then soft-cap physical for display. Mirrors `ScoreIntelligencePanel`.
  // Previously this used `normalizeQualificationSubScoreValue` which only up-scaled
  // values ≤10 (so physical 10 → 100, but experience 25 passed through as 25 and
  // rendered as a tiny 25% bar — exactly the complaint that prompted this fix).
  const qualificationSubNormalized = useMemo(() => {
    if (!sub) {
      return normalizeQualificationScores({
        experience: 0,
        reliability: 0,
        transport: 0,
        risk: 0,
        physical: 0,
      });
    }
    return normalizeQualificationScores(
      rawQualificationPointsToPercentages({
        experience: typeof sub.experience === 'number' ? sub.experience : 0,
        reliability: typeof sub.reliability === 'number' ? sub.reliability : 0,
        transportation: typeof sub.transportation === 'number' ? sub.transportation : 0,
        risk: typeof sub.risk === 'number' ? sub.risk : 0,
        physical: typeof sub.physical === 'number' ? sub.physical : 0,
      }),
    );
  }, [sub]);

  const overrideApplied =
    typeof scoreSummary?.overrideAdjustedScore === 'number' &&
    typeof scoreSummary?.overrideScoreDelta === 'number' &&
    scoreSummary.overrideScoreDelta !== 0;

  const systemOperationalAdjustment =
    (typeof latestPrescreenInterviewAi?.overrideAdjustedScore === 'number' &&
      typeof latestPrescreenInterviewAi?.baseInterviewScore === 'number' &&
      latestPrescreenInterviewAi.overrideAdjustedScore !== latestPrescreenInterviewAi.baseInterviewScore) ||
    overrideApplied;

  const snapshotGeneratedBy = snap?.generatedBy ?? null;
  const manualSnapshotOverride = snapshotGeneratedBy === 'manual_review';

  const systemConfidence = useMemo(
    () =>
      deriveSystemDecisionConfidence({
        hiringScore,
        riskLevel: snap?.riskLevel ?? null,
        decision,
        recommendation,
        hardBlockCount: latestPrescreenInterviewAi?.hardBlocks?.length ?? 0,
        overrideApplied,
        scoreConflictDetected: scoreSummary?.scoreConflictDetected === true,
      }),
    [hiringScore, snap?.riskLevel, decision, recommendation, latestPrescreenInterviewAi?.hardBlocks, overrideApplied, scoreSummary?.scoreConflictDetected],
  );

  const whyThisDecision = useMemo(
    () =>
      deriveWhyThisDecision({
        reasoningSummary: snap?.reasoningSummary ?? null,
        riskLevel: snap?.riskLevel ?? null,
        hardBlocks: latestPrescreenInterviewAi?.hardBlocks?.map(String) ?? [],
        strengths,
        risks,
      }),
    [snap?.reasoningSummary, snap?.riskLevel, latestPrescreenInterviewAi?.hardBlocks, strengths, risks],
  );

  let scoreColor: 'success.main' | 'warning.main' | 'text.primary' = 'text.primary';
  if (hiringScore != null) {
    if (hiringScore >= 80) scoreColor = 'success.main';
    else if (hiringScore >= 60) scoreColor = 'warning.main';
  }

  const confidenceLabel = masterDisp.confidence
    ? masterDisp.confidence.charAt(0).toUpperCase() + masterDisp.confidence.slice(1)
    : '—';
  const riskInline = riskBandLineWithIndex(
    masterDisp.riskLevel
      ? masterDisp.riskLevel.charAt(0).toUpperCase() + masterDisp.riskLevel.slice(1)
      : riskLabel(snap?.riskLevel ?? null),
    risk,
    riskProfileRaw,
  );

  return (
    <Stack spacing={1} alignItems="stretch">
      {systemOperationalAdjustment || manualSnapshotOverride ? (
        <Stack direction="row" flexWrap="wrap" useFlexGap gap={0.75} alignItems="center">
          {systemOperationalAdjustment ? (
            <Chip size="small" variant="outlined" label="Adjusted by system based on operational signals" sx={{ maxWidth: '100%' }} />
          ) : null}
          {manualSnapshotOverride ? (
            <Chip
              size="small"
              variant="outlined"
              color="info"
              label={
                decisionControls?.manualOverrideLabel
                  ? `Manually overridden by ${decisionControls.manualOverrideLabel}`
                  : 'Manually overridden (recruiter review)'
              }
              sx={{ maxWidth: '100%' }}
            />
          ) : null}
        </Stack>
      ) : null}

      <Box mb={1}>
        <Typography variant="subtitle2">Why this decision?</Typography>
        <Typography variant="body2" sx={{ mt: 0.25 }}>{whyThisDecision}</Typography>
      </Box>

      <Box mb={1}>
        <Typography variant="overline" color="text.secondary" display="block">
          Decision
        </Typography>
        <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: '0.04em', lineHeight: 1.2, mt: 0.25 }}>
          {headline}
        </Typography>
      </Box>

      <Box mb={1}>
        <Typography variant="overline" color="text.secondary" display="block">
          Master Recruiter Score
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: scoreColor, mt: 0.25, lineHeight: 1.15 }}>
          {hiringScore ?? '—'}
        </Typography>
      </Box>

      {masterDisp.master?.components && masterDisp.master.effectiveWeights ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          Category · Interview · Profile weighted
        </Typography>
      ) : null}

      <Typography variant="body2" color="text.secondary">
        Confidence: {confidenceLabel} • {riskInline}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        System confidence: {systemConfidence.message}
      </Typography>

      {/* Quick signal strip — same chip styling as Overview Qualifications skills (do not change sx) */}
      <Box display="flex" gap={1} flexWrap="wrap" mt={1}>
        <Chip size="small" variant="outlined" label={`Interview signal: ${signalWord}`} sx={overviewBodyChipSx} />
        {categoryAvg != null ? (
          <Chip size="small" variant="outlined" label={`Category avg ~${categoryAvg}`} sx={overviewBodyChipSx} />
        ) : (
          <Chip size="small" variant="outlined" label="Category avg —" sx={overviewBodyChipSx} />
        )}
        <Chip size="small" variant="outlined" label={`Interviews: ${interviewCount}`} sx={overviewBodyChipSx} />
        <Chip size="small" variant="outlined" label={`Last interview: ${lastInterviewLabel}`} sx={overviewBodyChipSx} />
      </Box>

      {/* Category + interview / qualification bars — single row */}
      <Box display="flex" flexDirection={{ xs: 'column', sm: 'row' }} gap={3} mt={2} alignItems="flex-start">
        <Box flex={1} minWidth={0}>
          <Typography variant="subtitle2">Category scores</Typography>
          {mergedCats ? (
            <Stack spacing={0.5} sx={{ mt: 0.5 }}>
              {CATEGORY_ROWS.map(({ key, label }) => {
                const v = mergedCats[key];
                const band = categoryScoreBand(v);
                return (
                  <Stack key={key} direction="row" alignItems="center" spacing={1}>
                    <Typography variant="caption" sx={{ width: 100, flexShrink: 0, color: 'text.secondary' }}>
                      {label}
                    </Typography>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <LinearProgress
                        variant="determinate"
                        value={Math.max(0, Math.min(100, v))}
                        sx={{
                          height: 6,
                          borderRadius: 3,
                          bgcolor: 'action.hover',
                          '& .MuiLinearProgress-bar': { ...bandSx(band), borderRadius: 3 },
                        }}
                      />
                    </Box>
                    <Typography variant="caption" sx={{ width: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {v}
                    </Typography>
                  </Stack>
                );
              })}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              No category profile scores yet.
            </Typography>
          )}
        </Box>

        <Box flex={1} minWidth={0}>
          <Typography variant="subtitle2">Interview / qualification scores</Typography>
          <Stack spacing={0.5} sx={{ mt: 0.5 }}>
            {QUALIFICATION_DISPLAY_ORDER.map((dim) => {
              const raw =
                sub == null
                  ? undefined
                  : dim === 'transportation'
                    ? sub.transportation
                    : sub[dim as keyof typeof sub];
              const n = normalizeQualificationSubScoreValue(raw);
              const rawPts = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
              const maxPts = QUALIFICATION_BREAKDOWN_RAW_MAX[dim];
              const displayPct = qualificationNormalizedPercent(qualificationSubNormalized, dim);
              const barValue = qualificationBarDisplayPercent(displayPct);
              const sev = qualificationSeverityBand(displayPct);
              const barSx =
                sev === 'strong'
                  ? {
                      height: 6,
                      borderRadius: 3,
                      bgcolor: 'action.hover',
                      '& .MuiLinearProgress-bar': { bgcolor: 'error.main', borderRadius: 3 },
                    }
                  : sev === 'mid'
                    ? {
                        height: 6,
                        borderRadius: 3,
                        bgcolor: 'action.hover',
                        '& .MuiLinearProgress-bar': { bgcolor: 'warning.main', borderRadius: 3 },
                      }
                    : {
                        height: 6,
                        borderRadius: 3,
                        bgcolor: 'action.hover',
                        '& .MuiLinearProgress-bar': { bgcolor: 'primary.main', borderRadius: 3 },
                      };

              return (
                <Stack key={dim} direction="row" alignItems="center" spacing={1}>
                  <Typography
                    variant="caption"
                    sx={{
                      width: 128,
                      flexShrink: 0,
                      color: dim === 'physical' ? 'text.disabled' : 'text.secondary',
                      fontWeight: dim === 'physical' ? 400 : 500,
                    }}
                  >
                    {QUALIFICATION_DISPLAY_LABEL[dim]}
                  </Typography>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    {n != null ? (
                      <LinearProgress variant="determinate" value={barValue} sx={barSx} />
                    ) : null}
                  </Box>
                  <Typography
                    variant="caption"
                    sx={{ width: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                    color={n == null ? 'text.disabled' : 'text.primary'}
                  >
                    {/*
                      Show raw points out of the per-category max (matches the
                      ScoreIntelligencePanel "Interview model sub-scores" card
                      and makes the scoring scale explicit — e.g. 22 / 25
                      instead of a bare "22" that looks like 22%).
                    */}
                    {rawPts != null ? `${Math.round(rawPts)} / ${maxPts}` : '—'}
                  </Typography>
                </Stack>
              );
            })}
          </Stack>
        </Box>
      </Box>

      <Box mt={2}>
        <Typography variant="subtitle2">Interview summary</Typography>
        <Typography variant="body2" sx={{ mt: 0.25 }}>
          Recommendation: {recommendationLabel(recommendation)} • Decision: {decisionHeadlineTitleCase(decision, recommendation)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {passedChecks ? 'No hard blocks' : 'Caution — review flags or blocks on the Interview tab.'}
        </Typography>
      </Box>

      {strengths.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="overline" color="text.secondary">
            Strengths
          </Typography>
          <Stack component="ul" sx={{ m: 0, pl: 2, mt: 0.25 }} spacing={0.25}>
            {strengths.map((s, i) => (
              <Typography key={i} component="li" variant="body2" color="text.secondary" sx={{ display: 'list-item' }}>
                {s}
              </Typography>
            ))}
          </Stack>
        </Box>
      )}
      {risks.length > 0 && (
        <Box sx={{ mt: 0.5 }}>
          <Typography variant="overline" color="error">
            Risks
          </Typography>
          <Stack component="ul" sx={{ m: 0, pl: 2, mt: 0.25 }} spacing={0.25}>
            {risks.map((s, i) => (
              <Typography key={i} component="li" variant="body2" color="text.secondary" sx={{ display: 'list-item' }}>
                {s}
              </Typography>
            ))}
          </Stack>
        </Box>
      )}

      {/* Score explanation (collapsed by default) */}
      <Accordion
        defaultExpanded={false}
        disableGutters
        elevation={0}
        sx={{ mt: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1, '&:before': { display: 'none' } }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />} sx={{ minHeight: 36, py: 0 }}>
          <Typography variant="subtitle2">How these scores relate</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0, pb: 1 }}>
          <Stack spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
              <strong>Hiring score</strong> is the recruiter-facing primary number (0–100) shown above.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <strong>Interview score (base)</strong> is the raw output from the interview scoring model before operational rules.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <strong>Operational score (adjusted)</strong> applies recruiter-trust and policy signals (e.g. compliance, reliability) to
              produce the hiring score when overrides are in play.
            </Typography>
            {overrideApplied ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                An <strong>override</strong> changed the operational score from the base interview score (see interview record for deltas).
              </Typography>
            ) : null}
            {typeof latestPrescreenInterviewAi?.overallScore === 'number' &&
            typeof hiringScore === 'number' &&
            Math.round(latestPrescreenInterviewAi.overallScore) !== hiringScore ? (
              <Typography variant="caption" color="text.secondary">
                <strong>Legacy composite score</strong> on the interview record may differ from the primary hiring score when older
                blending logic is present — use the hiring score for recruiter decisions.
              </Typography>
            ) : null}
            {typeof scoreSummary?.interviewAvg === 'number' && (
              <Typography variant="caption" color="text.secondary">
                Interview average ({formatOneDecimal(scoreSummary.interviewAvg)}/10) is informational context only, not a second hiring score.
              </Typography>
            )}
          </Stack>
        </AccordionDetails>
      </Accordion>

      <Box mt={2}>
        <Typography variant="subtitle2">Recent score changes</Typography>
        {historyError ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            Recent score history is unavailable for this viewer.
          </Typography>
        ) : historyLines.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            No recent category adjustments
          </Typography>
        ) : (
          <>
            <Stack spacing={0.5} sx={{ mt: 0.25 }}>
              {historyLines.map((line, i) => (
                <Typography key={i} variant="body2" color="text.secondary">
                  {line}
                </Typography>
              ))}
            </Stack>
            <MiniSparkline values={sparkVals} />
          </>
        )}
      </Box>
    </Stack>
  );
}
