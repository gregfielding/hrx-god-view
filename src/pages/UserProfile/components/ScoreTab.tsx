import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Divider,
  Stack,
  Typography,
  Chip,
  Button,
  Tooltip,
} from '@mui/material';
import InsightsIcon from '@mui/icons-material/Insights';
import AssessmentIcon from '@mui/icons-material/Assessment';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import StarIcon from '@mui/icons-material/Star';
import HistoryIcon from '@mui/icons-material/History';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../../../firebase';
import type { PrescreenCategoryEvidenceV1, PrescreenCategoryScoresV1 } from '../../../types/prescreenCategoryScores';
import {
  fetchLatestWorkerAiPrescreenCategorySnapshot,
  fetchRecentCategoryScoreEvents,
  formatCategoryScoreEventSummaryLine,
  summarizeRecentCategoryScoreEventDeltas,
  type CategoryScoreEventRow,
} from '../../../utils/categoryScoreEvolution';
import { RecruiterCategoryScoresPanel } from '../../../components/recruiter/RecruiterCategoryScoresReadOnly';
import { useCategoryScoresCurrent } from '../../../hooks/useCategoryScoresCurrent';
import type { ScoreSummary, ScoringDistribution } from '../../../utils/scoreSummary';
import { formatOneDecimal } from '../../../utils/scoreSummary';
import ReviewsTab from './ReviewsTab';

type Props = {
  uid: string;
  scoreSummary?: ScoreSummary;
  fallbackAiScore?: number;
  /** Profile-derived completeness (0–100) when scoreSummary.completenessScore is missing. */
  fallbackCompleteness?: number;
  /** Tenant distribution for relative AI score (0–100 vs pool). */
  scoringDistribution?: ScoringDistribution | null;
  onGoToInterview?: () => void;
};

type InterviewRow = {
  id: string;
  createdAt?: any;
  createdByName?: string;
  score10?: number;
};

const toDateLabel = (ts: any): string => {
  try {
    const d: Date | null = ts?.toDate?.() || (ts instanceof Date ? ts : null);
    if (!d) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
};

const toDateTimeLabel = (ts: unknown): string => {
  try {
    const t = ts as { toDate?: () => Date };
    const d = t?.toDate?.() ?? (ts instanceof Date ? ts : null);
    if (!d || !(d instanceof Date)) return '—';
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
};

const profileCategoryIntro = (
  <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
    These six scores are the primary worker-intelligence view on this profile (0–100 each). They represent how this
    worker is assessed right now and can change over time as interview results, profile signals, and recorded activity
    are reflected.
  </Typography>
);

const snapshotFallbackIntro = (
  <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
    Live profile category scores are not stored yet. Below is the latest worker AI pre-screen category snapshot (0–100)
    as a stand-in until evolving profile scores exist — same shape as interview data, not a separate scoring system.
  </Typography>
);

export default function ScoreTab({ uid, scoreSummary, fallbackAiScore, fallbackCompleteness, scoringDistribution, onGoToInterview }: Props) {
  const aiScore = scoreSummary?.aiScore ?? fallbackAiScore;

  const aiCalc = useMemo(() => {
    const w = scoreSummary?.aiWeights || { completeness: 0.45, responsiveness: 0.25, quality: 0.3 };
    const c =
      typeof scoreSummary?.completenessScore === 'number'
        ? scoreSummary!.completenessScore!
        : typeof fallbackCompleteness === 'number'
          ? fallbackCompleteness
          : 0;
    const r = typeof scoreSummary?.responsivenessScore === 'number' ? scoreSummary!.responsivenessScore! : 50;
    const q = typeof scoreSummary?.qualityScore === 'number' ? scoreSummary!.qualityScore! : 0;
    const hasAll = c !== null && r !== null && q !== null;
    const computed = hasAll ? Math.round(w.completeness * c + w.responsiveness * r + w.quality * q) : null;
    return {
      weights: w,
      completeness: c,
      responsiveness: r,
      quality: q,
      computedAi: computed,
      hasAll,
    };
  }, [scoreSummary, fallbackCompleteness]);

  const [recentInterviews, setRecentInterviews] = useState<InterviewRow[]>([]);
  const [scoreEvents, setScoreEvents] = useState<CategoryScoreEventRow[]>([]);
  const [scoreEventsLoading, setScoreEventsLoading] = useState(true);
  const [scoreEventsError, setScoreEventsError] = useState<string | null>(null);

  const { scores: categoryScoresCurrent, userDocReady } = useCategoryScoresCurrent(uid);
  const [interviewCategoryFallback, setInterviewCategoryFallback] = useState<{
    scores: PrescreenCategoryScoresV1;
    evidence: PrescreenCategoryEvidenceV1 | null;
  } | null>(null);
  const [interviewFallbackLoaded, setInterviewFallbackLoaded] = useState(false);

  useEffect(() => {
    if (!uid || !userDocReady) return;
    if (categoryScoresCurrent !== null) {
      setInterviewCategoryFallback(null);
      setInterviewFallbackLoaded(true);
      return;
    }
    let cancelled = false;
    setInterviewFallbackLoaded(false);
    (async () => {
      const parsed = await fetchLatestWorkerAiPrescreenCategorySnapshot(uid);
      if (cancelled) return;
      setInterviewFallbackLoaded(true);
      if (parsed.scores) {
        setInterviewCategoryFallback({ scores: parsed.scores, evidence: parsed.evidence });
      } else {
        setInterviewCategoryFallback(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, userDocReady, categoryScoresCurrent]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const ref = collection(db, 'users', uid, 'interviews');
        let snap;
        try {
          snap = await getDocs(query(ref, orderBy('createdAt', 'desc'), limit(5)));
        } catch {
          snap = await getDocs(query(ref, orderBy('timestamp', 'desc'), limit(5)));
        }
        const rows: InterviewRow[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            createdAt: data.createdAt ?? data.timestamp,
            createdByName: data.createdByName ?? data.submittedBy,
            score10: typeof data.score10 === 'number' ? data.score10 : typeof data.score === 'number' ? data.score : undefined,
          };
        });
        if (mounted) setRecentInterviews(rows);
      } catch {
        if (mounted) setRecentInterviews([]);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [uid]);

  useEffect(() => {
    let mounted = true;
    if (!uid) {
      setScoreEvents([]);
      setScoreEventsLoading(false);
      setScoreEventsError(null);
      return () => {
        mounted = false;
      };
    }
    setScoreEventsLoading(true);
    setScoreEventsError(null);
    (async () => {
      try {
        const rows = await fetchRecentCategoryScoreEvents(uid, 10);
        if (mounted) {
          setScoreEvents(rows);
          setScoreEventsError(null);
        }
      } catch (e) {
        if (mounted) {
          setScoreEvents([]);
          setScoreEventsError(e instanceof Error ? e.message : 'Could not load score history');
        }
      } finally {
        if (mounted) setScoreEventsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [uid]);

  const scoreEventsSummary = useMemo(() => summarizeRecentCategoryScoreEventDeltas(scoreEvents), [scoreEvents]);

  const interviewSummary = useMemo(() => {
    const avg = scoreSummary?.interviewAvg;
    const count = scoreSummary?.interviewCount;
    return {
      avg,
      count,
      lastAt: scoreSummary?.interviewLastAt,
    };
  }, [scoreSummary?.interviewAvg, scoreSummary?.interviewCount, scoreSummary?.interviewLastAt]);

  const reviewSummary = useMemo(() => {
    const avg = scoreSummary?.reviewAvg;
    const count = scoreSummary?.reviewCount;
    return {
      avg,
      count,
      lastAt: scoreSummary?.reviewLastAt,
    };
  }, [scoreSummary?.reviewAvg, scoreSummary?.reviewCount, scoreSummary?.reviewLastAt]);

  const currentCategoryDisplay = useMemo(() => {
    if (categoryScoresCurrent) {
      return {
        scores: categoryScoresCurrent,
        evidence: null as PrescreenCategoryEvidenceV1 | null,
        mode: 'profile' as const,
      };
    }
    if (interviewCategoryFallback) {
      return {
        scores: interviewCategoryFallback.scores,
        evidence: interviewCategoryFallback.evidence,
        mode: 'interview_snapshot' as const,
      };
    }
    return null;
  }, [categoryScoresCurrent, interviewCategoryFallback]);

  const categoryScoresLoading = !userDocReady || (!interviewFallbackLoaded && !categoryScoresCurrent);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* A — Current category scores (primary) */}
      <Card
        variant="outlined"
        sx={{
          borderColor: 'primary.light',
          boxShadow: (theme) => theme.shadows[1],
        }}
      >
        <CardHeader
          title="Category intelligence"
          subheader="Six dimensions (Reliability, Punctuality, Work ethic, Team fit, Job readiness, Stability) — the main worker-intelligence view on this tab."
          titleTypographyProps={{ variant: 'h6', fontWeight: 800 }}
          subheaderTypographyProps={{ variant: 'body2', color: 'text.secondary', sx: { mt: 0.5 } }}
          avatar={<AssessmentIcon color="primary" />}
        />
        <CardContent sx={{ pt: 0 }}>
          {categoryScoresLoading ? (
            <Typography variant="body2" color="text.secondary">
              Loading category scores…
            </Typography>
          ) : currentCategoryDisplay ? (
            <>
              {currentCategoryDisplay.mode === 'profile' ? profileCategoryIntro : snapshotFallbackIntro}
              <RecruiterCategoryScoresPanel
                scores={currentCategoryDisplay.scores}
                evidence={currentCategoryDisplay.evidence}
                showHeading={false}
                scoreKind={currentCategoryDisplay.mode === 'profile' ? 'profile_current' : 'interview_snapshot'}
                description={
                  currentCategoryDisplay.mode === 'profile' ? (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                      These are the live values on this worker profile. They differ from frozen interview snapshots
                      elsewhere; use <strong>Recent score changes</strong> below to see adjustments over time.
                    </Typography>
                  ) : (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                      Source: latest worker AI pre-screen that included category scores. When live profile scores exist,
                      they replace this view automatically.
                    </Typography>
                  )
                }
                footnote={
                  currentCategoryDisplay.mode === 'interview_snapshot'
                    ? 'Temporary stand-in from the pre-screen interview until evolving profile scores are stored.'
                    : undefined
                }
              />
            </>
          ) : (
            <Stack spacing={2} alignItems="flex-start">
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 640 }}>
                No category scores yet. This worker has not completed a worker AI pre-screen with category scores, and
                there are no live profile category scores stored. Category scores build from interview responses, profile
                signals, and recorded activity over time.
              </Typography>
              {onGoToInterview ? (
                <Button variant="contained" size="medium" onClick={onGoToInterview}>
                  Open Interview tab
                </Button>
              ) : null}
            </Stack>
          )}
        </CardContent>
      </Card>

      {/* B — Recent score changes */}
      <Card variant="outlined">
        <CardHeader
          title="Recent score changes"
          subheader="How this worker’s profile category scores have moved — read-only audit trail (not the interview snapshot)."
          titleTypographyProps={{ variant: 'h6', fontWeight: 800 }}
          subheaderTypographyProps={{ variant: 'body2', color: 'text.secondary', sx: { mt: 0.5 } }}
          avatar={<HistoryIcon />}
        />
        <CardContent sx={{ pt: 0 }}>
          {scoreEventsLoading ? (
            <Typography variant="body2" color="text.secondary">
              Loading recent score changes…
            </Typography>
          ) : scoreEventsError ? (
            <Typography variant="body2" color="text.secondary">
              Could not load score history ({scoreEventsError}).
            </Typography>
          ) : scoreEvents.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 640 }}>
              No score change events yet. When category scores update from interview, activity, shifts, or other
              sources, those adjustments will appear here with the category, amount, and source.
            </Typography>
          ) : (
            <>
              {scoreEventsSummary && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {scoreEventsSummary}
                </Typography>
              )}
              <Stack divider={<Divider flexItem />} spacing={0}>
                {scoreEvents.map((ev) => {
                  return (
                    <Box key={ev.id} sx={{ py: 1.5, pr: 0.5 }}>
                      <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between" gap={1}>
                        <Typography variant="body2" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}>
                          {formatCategoryScoreEventSummaryLine(ev)}
                        </Typography>
                        {ev.deltaClamped ? (
                          <Tooltip title="The requested delta was adjusted to stay within server limits.">
                            <Chip size="small" label="Clamped" variant="outlined" sx={{ height: 22, flexShrink: 0 }} />
                          </Tooltip>
                        ) : null}
                      </Stack>
                      <Stack direction="row" flexWrap="wrap" alignItems="center" columnGap={1.5} rowGap={0.5} sx={{ mt: 0.75 }}>
                        <Typography variant="caption" color="text.secondary">
                          {toDateTimeLabel(ev.createdAt)}
                        </Typography>
                        {ev.referenceId ? (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontFamily: 'monospace', wordBreak: 'break-all', maxWidth: '100%' }}
                          >
                            Ref: {ev.referenceId}
                          </Typography>
                        ) : null}
                      </Stack>
                      <Tooltip title="Firestore document id for support / audit">
                        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5, fontSize: 10 }}>
                          Event id: {ev.id}
                        </Typography>
                      </Tooltip>
                    </Box>
                  );
                })}
              </Stack>
            </>
          )}
        </CardContent>
      </Card>

      {/* C — AI Score (secondary) */}
      <Card
        variant="outlined"
        sx={{
          bgcolor: (theme) => theme.palette.action.hover,
          borderStyle: 'dashed',
        }}
      >
        <CardHeader
          title="AI Score"
          subheader="A single blended 0–100 summary from completeness, responsiveness, and quality. Secondary to category intelligence above; useful for quick comparison with legacy views."
          titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700, color: 'text.secondary' }}
          subheaderTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
          avatar={<InsightsIcon sx={{ color: 'text.secondary', opacity: 0.9 }} />}
        />
        <CardContent sx={{ pt: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 2 }}>
            {typeof aiScore === 'number' && !Number.isNaN(aiScore) ? (
              <Tooltip title={`Stored AI Score: ${Math.round(aiScore)} (same as header / users table when present)`}>
                <Chip color="default" variant="outlined" label={`AI Score: ${Math.round(aiScore)}`} size="small" />
              </Tooltip>
            ) : (
              <Chip variant="outlined" label="AI Score: N/A" size="small" />
            )}
          </Stack>

          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
            How this score is calculated
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            The value above is the stored score for this user. It is derived from three weighted components:
          </Typography>
          <Stack spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
              AI Score = (Completeness × <strong>{aiCalc.weights.completeness}</strong>) + (Responsiveness ×{' '}
              <strong>{aiCalc.weights.responsiveness}</strong>) + (Quality × <strong>{aiCalc.weights.quality}</strong>)
            </Typography>

            <Typography variant="body2" color="text.secondary">
              Completeness: <strong>{aiCalc.completeness !== null ? Math.round(aiCalc.completeness) : '—'}</strong>
              {aiCalc.completeness !== null && (
                <>
                  {' '}
                  → <strong>{Math.round(aiCalc.weights.completeness * aiCalc.completeness)}</strong>
                </>
              )}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Responsiveness: <strong>{aiCalc.responsiveness !== null ? Math.round(aiCalc.responsiveness) : '—'}</strong>
              {aiCalc.responsiveness !== null && (
                <>
                  {' '}
                  → <strong>{Math.round(aiCalc.weights.responsiveness * aiCalc.responsiveness)}</strong>
                </>
              )}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Quality: <strong>{aiCalc.quality !== null ? Math.round(aiCalc.quality) : '—'}</strong>
              {aiCalc.quality !== null && (
                <>
                  {' '}
                  → <strong>{Math.round(aiCalc.weights.quality * aiCalc.quality)}</strong>
                </>
              )}
            </Typography>

            {aiCalc.hasAll ? (
              <Typography variant="body2" color="text.secondary">
                Using the current components, the formula gives: <strong>{aiCalc.computedAi}</strong>.
                {typeof aiScore === 'number' && !Number.isNaN(aiScore) &&
                  (aiCalc.computedAi !== null && Math.round(aiScore) !== aiCalc.computedAi ? (
                    <>
                      {' '}
                      The stored AI Score is <strong>{Math.round(aiScore)}</strong>; it may have been saved earlier or with
                      different inputs.
                    </>
                  ) : (
                    <> The stored score matches this calculation.</>
                  ))}
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                Detailed components will populate as the system computes completeness, responsiveness, and quality.
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* D — Interviews + review summary */}
      <Card variant="outlined">
        <CardHeader
          title="Interviews & reviews (summary)"
          titleTypographyProps={{ variant: 'h6', fontWeight: 800 }}
          avatar={<AssignmentTurnedInIcon />}
          action={
            onGoToInterview ? (
              <Button onClick={onGoToInterview} variant="contained" size="small">
                Go to Interview
              </Button>
            ) : null
          }
        />
        <CardContent sx={{ pt: 0 }}>
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              Interview avg: <strong>{formatOneDecimal(interviewSummary.avg)}</strong>/10
              {interviewSummary.count ? ` (${interviewSummary.count})` : ''}
              {interviewSummary.lastAt ? ` · Last: ${toDateLabel(interviewSummary.lastAt)}` : ''}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <StarIcon sx={{ fontSize: 18, opacity: 0.8 }} />
              Reviews avg: <strong>{formatOneDecimal(reviewSummary.avg)}</strong>/5
              {reviewSummary.count ? ` (${reviewSummary.count})` : ''}
              {reviewSummary.lastAt ? ` · Last: ${toDateLabel(reviewSummary.lastAt)}` : ''}
            </Typography>
          </Stack>

          {recentInterviews.length > 0 && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.75 }}>
                Recent interviews
              </Typography>
              <Stack spacing={1}>
                {recentInterviews.map((r) => (
                  <Box key={r.id} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                    <Typography variant="body2" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.createdByName || 'Internal'} {r.createdAt ? `• ${toDateLabel(r.createdAt)}` : ''}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 800, flexShrink: 0 }}>
                      {r.score10 !== undefined ? `${formatOneDecimal(r.score10)}/10` : '—'}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </>
          )}
        </CardContent>
      </Card>

      <ReviewsTab uid={uid} />
    </Box>
  );
}
