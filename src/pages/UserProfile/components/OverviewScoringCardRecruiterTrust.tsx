/**
 * Condensed “recruiter trust” scoring panel for Overview — single Hiring Score, decision-first layout.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Divider,
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
import { deriveNextBestAction, deriveWhyThisDecision, type NextBestActionIntent } from '../../../utils/scoring/deriveNextBestAction';
import { getRecruiterMasterDisplayForAdminUi } from '../../../utils/scoring/recruiterMasterScoreDisplay';

export type OverviewScoringDecisionControls = {
  onViewInterview: () => void;
  /** If omitted, primary CTA falls back to onViewInterview / onOpenScoreTab-style behavior via handlers passed. */
  onPrimaryAction?: (intent: NextBestActionIntent) => void;
  reviewRescoreSlot?: React.ReactNode;
  onOverrideDecision?: () => void;
  showOverrideDecision?: boolean;
  /** From user doc — drives “verify phone” path when false */
  phoneVerified?: boolean | null;
  /** True when a screening / BG order is still in flight */
  backgroundCheckPending?: boolean;
  /** Display name when snapshot was produced in manual review */
  manualOverrideLabel?: string | null;
  onOpenScoreTab?: () => void;
};
const overviewProfileFieldValueSxLocal = {
  fontSize: '0.78rem',
  lineHeight: 1.45,
  color: 'text.secondary',
} as const;

const CATEGORY_ROWS: { key: keyof PrescreenCategoryScoresV1; label: string }[] = [
  { key: 'reliability', label: 'Reliability' },
  { key: 'punctuality', label: 'Punctuality' },
  { key: 'workEthic', label: 'Work ethic' },
  { key: 'teamFit', label: 'Team fit' },
  { key: 'jobReadiness', label: 'Job readiness' },
  { key: 'stability', label: 'Stability' },
];

const SUB_KEYS: { key: keyof NonNullable<WorkerInterviewAiBlock['subScores']>; label: string }[] = [
  { key: 'experience', label: 'Experience' },
  { key: 'reliability', label: 'Reliability' },
  { key: 'transportation', label: 'Transport' },
  { key: 'risk', label: 'Risk' },
  { key: 'physical', label: 'Physical' },
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
    <Box sx={{ mt: 0.5, opacity: 0.85 }} aria-hidden>
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

  const decision =
    snap?.decision ??
    (latestPrescreenInterviewAi?.hiringDecision?.decision as RecruiterScoreSnapshot['decision'] | undefined) ??
    null;
  const recommendation =
    snap?.recommendation ?? latestPrescreenInterviewAi?.recommendation ?? null;

  const headline = decisionHeadline(decision, recommendation);

  const mergedCats = useMemo(
    () => mergeCategoryScores(profileCategoryScores, snap?.categoryScores),
    [profileCategoryScores, snap?.categoryScores],
  );
  const categoryScoresFromSnapshotFallback = Boolean(!profileCategoryScores && snap?.categoryScores);

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

  const nextBest = useMemo(
    () =>
      deriveNextBestAction({
        hiringScore,
        decision,
        recommendation,
        riskLevel: snap?.riskLevel ?? null,
        interviewCount,
        hardBlocks: latestPrescreenInterviewAi?.hardBlocks?.map(String) ?? [],
        softBlocks: latestPrescreenInterviewAi?.softBlocks?.map(String) ?? [],
        autoAdvanceEligible: scoreSummary?.autoAdvanceEligible,
        assignmentReadiness: latestPrescreenInterviewAi?.assignmentReadiness,
        phoneVerified: decisionControls?.phoneVerified,
        backgroundCheckPending: decisionControls?.backgroundCheckPending === true,
      }),
    [
      hiringScore,
      decision,
      recommendation,
      snap?.riskLevel,
      interviewCount,
      latestPrescreenInterviewAi?.hardBlocks,
      latestPrescreenInterviewAi?.softBlocks,
      latestPrescreenInterviewAi?.assignmentReadiness,
      scoreSummary?.autoAdvanceEligible,
      decisionControls?.phoneVerified,
      decisionControls?.backgroundCheckPending,
    ],
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

  const handlePrimaryCta = () => {
    const intent = nextBest.intent;
    if (decisionControls?.onPrimaryAction) {
      decisionControls.onPrimaryAction(intent);
      return;
    }
    if (intent === 'review_decision') {
      decisionControls?.onOpenScoreTab?.();
      return;
    }
    decisionControls?.onViewInterview();
  };

  let scoreColor: 'success.main' | 'warning.main' | 'text.primary' = 'text.primary';
  if (hiringScore != null) {
    if (hiringScore >= 80) scoreColor = 'success.main';
    else if (hiringScore >= 60) scoreColor = 'warning.main';
  }

  const automationChipColor =
    nextBest.automationState === 'ready' ? 'success' : nextBest.automationState === 'blocked' ? 'error' : 'warning';
  const automationChipLabel =
    nextBest.automationState === 'ready' ? 'READY' : nextBest.automationState === 'blocked' ? 'BLOCKED' : 'NEEDS ACTION';

  return (
    <Stack spacing={1.25} alignItems="stretch">
      <Stack direction="row" flexWrap="wrap" useFlexGap gap={0.75} alignItems="center">
        <Chip size="small" color={automationChipColor} label={automationChipLabel} sx={{ fontWeight: 800, letterSpacing: '0.06em' }} />
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

      {decisionControls ? (
        <Box>
          <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.06em', color: 'text.secondary' }}>
            Next best action
          </Typography>
          <Typography variant="body2" sx={{ ...overviewProfileFieldValueSxLocal, mt: 0.35, fontWeight: 500, color: 'text.primary' }}>
            {nextBest.sentence}
          </Typography>
          <Button variant="contained" size="small" sx={{ mt: 1, alignSelf: 'flex-start', textTransform: 'none', fontWeight: 700 }} onClick={handlePrimaryCta}>
            {nextBest.primaryButtonLabel}
          </Button>
          <Stack direction="row" flexWrap="wrap" useFlexGap gap={0.75} sx={{ mt: 1.25 }} alignItems="center">
            <Button variant="outlined" size="small" sx={{ textTransform: 'none' }} onClick={decisionControls.onViewInterview}>
              View Interview
            </Button>
            {decisionControls.reviewRescoreSlot}
            {decisionControls.showOverrideDecision && decisionControls.onOverrideDecision ? (
              <Button variant="text" size="small" sx={{ textTransform: 'none' }} onClick={decisionControls.onOverrideDecision}>
                Override decision
              </Button>
            ) : null}
          </Stack>
        </Box>
      ) : null}

      <Box>
        <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.06em', color: 'text.secondary' }}>
          Why this decision?
        </Typography>
        <Typography variant="body2" sx={{ ...overviewProfileFieldValueSxLocal, mt: 0.35, color: 'text.primary', fontWeight: 500 }}>
          {whyThisDecision}
        </Typography>
      </Box>

      {/* Decision + primary hiring score + model confidence + risk + system confidence */}
      <Box>
        <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.08em', color: 'text.secondary' }}>
          Decision
        </Typography>
        <Typography
          variant="h6"
          sx={{ fontWeight: 800, letterSpacing: '0.06em', mt: 0.25, lineHeight: 1.2 }}
        >
          {headline}
        </Typography>
        <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.06em', color: 'text.secondary', mt: 1.25, display: 'block' }}>
          Master Recruiter Score
        </Typography>
        <Stack direction="row" alignItems="baseline" gap={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
          <Typography
            component="span"
            sx={{
              fontWeight: 800,
              fontSize: '2rem',
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
              color: scoreColor,
            }}
          >
            {hiringScore ?? '—'}
          </Typography>
        </Stack>
        {masterDisp.master?.components && masterDisp.master.effectiveWeights ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
            Category {masterDisp.master.components.categoryScore ?? '—'} × {Math.round(masterDisp.master.effectiveWeights.categoryScore * 100)}% ·
            Interview {masterDisp.master.components.interviewScore ?? '—'} × {Math.round(masterDisp.master.effectiveWeights.interviewScore * 100)}% ·
            Profile {masterDisp.master.components.profileScore ?? '—'} × {Math.round(masterDisp.master.effectiveWeights.profileScore * 100)}% →{' '}
            <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
              {hiringScore ?? '—'}
            </Box>
          </Typography>
        ) : null}
        <Typography variant="body2" sx={{ ...overviewProfileFieldValueSxLocal, mt: 0.75 }}>
          <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>Confidence: </Box>
          {masterDisp.confidence ? masterDisp.confidence.charAt(0).toUpperCase() + masterDisp.confidence.slice(1) : '—'}
        </Typography>
        <Typography variant="body2" sx={{ ...overviewProfileFieldValueSxLocal, mt: 0.25 }}>
          <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>Risk: </Box>
          {masterDisp.riskLevel
            ? masterDisp.riskLevel.charAt(0).toUpperCase() + masterDisp.riskLevel.slice(1)
            : riskLabel(snap?.riskLevel ?? null)}
        </Typography>
        <Typography variant="body2" sx={{ ...overviewProfileFieldValueSxLocal, mt: 0.5 }}>
          <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>System confidence: </Box>
          {systemConfidence.message}
        </Typography>
      </Box>

      {/* 2. Quick signal strip — words + one derived ~avg only as supporting chip */}
      <Stack direction="row" flexWrap="wrap" useFlexGap gap={0.75}>
        <Chip size="small" variant="outlined" label={`Interview signal: ${signalWord}`} sx={{ fontWeight: 600 }} />
        {categoryAvg != null ? (
          <Chip size="small" variant="outlined" label={`Category avg ~${categoryAvg}`} sx={{ fontWeight: 500 }} />
        ) : (
          <Chip size="small" variant="outlined" label="Category avg —" />
        )}
        <Chip size="small" variant="outlined" label={`Interviews: ${interviewCount}`} />
        <Chip size="small" variant="outlined" label={`Last interview: ${lastInterviewLabel}`} />
      </Stack>

      <Divider flexItem sx={{ my: 0.25 }} />

      {/* 3. Category scores */}
      <Box>
        <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'text.secondary' }}>
          Category scores
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35, fontSize: '0.72rem' }}>
          Live profile-level category scores
        </Typography>
        {categoryScoresFromSnapshotFallback ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, fontSize: '0.7rem', fontStyle: 'italic' }}>
            Using latest interview snapshot
          </Typography>
        ) : null}
        {mergedCats ? (
          <Stack spacing={0.35} sx={{ mt: 0.75 }}>
            {CATEGORY_ROWS.map(({ key, label }) => {
              const v = mergedCats[key];
              const band = categoryScoreBand(v);
              return (
                <Stack key={key} direction="row" alignItems="center" spacing={1}>
                  <Typography variant="caption" sx={{ width: 108, flexShrink: 0, color: 'text.secondary' }}>
                    {label}
                  </Typography>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <LinearProgress
                      variant="determinate"
                      value={Math.max(0, Math.min(100, v))}
                      sx={{
                        height: 6,
                        borderRadius: 1,
                        bgcolor: 'action.hover',
                        '& .MuiLinearProgress-bar': { ...bandSx(band), borderRadius: 1 },
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
          <Typography variant="body2" sx={{ ...overviewProfileFieldValueSxLocal, mt: 0.5 }}>
            No category profile scores yet.
          </Typography>
        )}
      </Box>

      <Divider flexItem sx={{ my: 0.25 }} />

      {/* 4. Interview summary (compact) */}
      <Box>
        <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'text.secondary' }}>
          Interview summary (latest)
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 0.75 }} alignItems="flex-start">
          <Stack spacing={0.35} sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={overviewProfileFieldValueSxLocal}>
              <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>Recommendation: </Box>
              {recommendationLabel(recommendation)}
            </Typography>
            <Typography variant="body2" sx={overviewProfileFieldValueSxLocal}>
              <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>Hiring decision: </Box>
              {decisionHeadline(decision, recommendation)}
            </Typography>
            <Typography variant="body2" sx={{ ...overviewProfileFieldValueSxLocal, fontStyle: 'italic' }}>
              {passedChecks ? 'No hard blocks on latest interview.' : 'Caution — review flags or blocks on the Interview tab.'}
            </Typography>
          </Stack>
          <Box sx={{ flex: 1, minWidth: 0, maxWidth: 280 }}>
            <Stack spacing={0.35}>
              {SUB_KEYS.map(({ key, label }) => {
                const raw = sub?.[key];
                let n: number | null =
                  typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
                if (n != null && n <= 10 && n >= 0) n = Math.round(n * 10);
                if (n != null) n = Math.max(0, Math.min(100, n));
                return (
                  <Stack key={key} direction="row" alignItems="center" spacing={0.75}>
                    <Typography variant="caption" sx={{ width: 72, flexShrink: 0, color: 'text.secondary', fontSize: '0.65rem' }}>
                      {label}
                    </Typography>
                    <Box sx={{ flex: 1 }}>
                      {n != null ? (
                        <LinearProgress
                          variant="determinate"
                          value={n}
                          sx={{
                            height: 5,
                            borderRadius: 1,
                            bgcolor: 'action.hover',
                            '& .MuiLinearProgress-bar': { bgcolor: 'primary.main', borderRadius: 1 },
                          }}
                        />
                      ) : (
                        <Typography variant="caption" color="text.disabled">
                          —
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                );
              })}
            </Stack>
          </Box>
        </Stack>
        {strengths.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              Strengths
            </Typography>
            <Stack component="ul" sx={{ m: 0, pl: 2, mt: 0.25 }} spacing={0.25}>
              {strengths.map((s, i) => (
                <Typography key={i} component="li" variant="body2" sx={{ ...overviewProfileFieldValueSxLocal, display: 'list-item' }}>
                  {s}
                </Typography>
              ))}
            </Stack>
          </Box>
        )}
        {risks.length > 0 && (
          <Box sx={{ mt: 0.75 }}>
            <Typography variant="caption" color="error.main" sx={{ fontWeight: 600 }}>
              Risks
            </Typography>
            <Stack component="ul" sx={{ m: 0, pl: 2, mt: 0.25 }} spacing={0.25}>
              {risks.map((s, i) => (
                <Typography key={i} component="li" variant="body2" sx={{ ...overviewProfileFieldValueSxLocal, display: 'list-item' }}>
                  {s}
                </Typography>
              ))}
            </Stack>
          </Box>
        )}
      </Box>

      {/* 5. Score explanation (collapsed by default) */}
      <Accordion
        defaultExpanded={false}
        disableGutters
        elevation={0}
        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, '&:before': { display: 'none' } }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />} sx={{ minHeight: 40, py: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.78rem' }}>
            How these scores relate
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <Stack spacing={0.75}>
            <Typography variant="body2" sx={overviewProfileFieldValueSxLocal}>
              <strong>Hiring score</strong> is the recruiter-facing primary number (0–100) shown above.
            </Typography>
            <Typography variant="body2" sx={overviewProfileFieldValueSxLocal}>
              <strong>Interview score (base)</strong> is the raw output from the interview scoring model before operational rules.
            </Typography>
            <Typography variant="body2" sx={overviewProfileFieldValueSxLocal}>
              <strong>Operational score (adjusted)</strong> applies recruiter-trust and policy signals (e.g. compliance, reliability) to
              produce the hiring score when overrides are in play.
            </Typography>
            {overrideApplied ? (
              <Typography variant="body2" sx={{ ...overviewProfileFieldValueSxLocal, fontStyle: 'italic' }}>
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

      {/* 6. Score history mini */}
      <Box>
        <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'text.secondary' }}>
          Recent score changes
        </Typography>
        {historyError ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Recent score history is unavailable for this viewer.
          </Typography>
        ) : historyLines.length === 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            No recent category adjustments recorded.
          </Typography>
        ) : (
          <>
            <Stack spacing={0.35} sx={{ mt: 0.5 }}>
              {historyLines.map((line, i) => (
                <Typography key={i} variant="body2" sx={{ ...overviewProfileFieldValueSxLocal, fontSize: '0.74rem' }}>
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
