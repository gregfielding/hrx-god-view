import React, { useEffect, useMemo, useState } from 'react';
import { Box, Card, CardContent, CardHeader, Divider, Stack, Typography, Chip, Button } from '@mui/material';
import InsightsIcon from '@mui/icons-material/Insights';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import StarIcon from '@mui/icons-material/Star';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../../../firebase';
import type { ScoreSummary } from '../../../utils/scoreSummary';
import { formatOneDecimal } from '../../../utils/scoreSummary';
import ReviewsTab from './ReviewsTab';

type Props = {
  uid: string;
  scoreSummary?: ScoreSummary;
  fallbackAiScore?: number;
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

export default function ScoreTab({ uid, scoreSummary, fallbackAiScore, onGoToInterview }: Props) {
  const aiScore = scoreSummary?.aiScore ?? fallbackAiScore;

  const aiCalc = useMemo(() => {
    const w = scoreSummary?.aiWeights || { completeness: 0.45, responsiveness: 0.25, quality: 0.3 };
    // Ensure the 3 components always have usable values for display.
    // - completeness: fallback to profileScore (passed as fallbackAiScore today; will be wired explicitly later)
    // - responsiveness: if not computed yet, show a neutral default (50) so the math is visible
    // - quality: if not computed yet, default to 0 (conservative)
    const c =
      typeof scoreSummary?.completenessScore === 'number'
        ? scoreSummary!.completenessScore!
        : (typeof fallbackAiScore === 'number' ? fallbackAiScore : 0);
    const r = typeof scoreSummary?.responsivenessScore === 'number' ? scoreSummary!.responsivenessScore! : 50;
    const q = typeof scoreSummary?.qualityScore === 'number' ? scoreSummary!.qualityScore! : 0;
    const hasAll = c !== null && r !== null && q !== null;
    const computed = hasAll ? Math.round((w.completeness * c) + (w.responsiveness * r) + (w.quality * q)) : null;
    return {
      weights: w,
      completeness: c,
      responsiveness: r,
      quality: q,
      computedAi: computed,
      hasAll,
    };
  }, [scoreSummary]);

  const [recentInterviews, setRecentInterviews] = useState<InterviewRow[]>([]);

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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Card variant="outlined">
        <CardHeader
          title="Score"
          titleTypographyProps={{ variant: 'h6', fontWeight: 800 }}
          avatar={<InsightsIcon />}
        />
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            {typeof aiScore === 'number' && !Number.isNaN(aiScore) ? (
              <Chip color="primary" variant="outlined" label={`AI Score: ${Math.round(aiScore)}`} />
            ) : (
              <Chip variant="outlined" label="AI Score: N/A" />
            )}

            {interviewSummary.avg !== undefined && (
              <Chip
                icon={<AssignmentTurnedInIcon />}
                variant="outlined"
                label={`Interviews: ${formatOneDecimal(interviewSummary.avg)}/10${interviewSummary.count ? ` (${interviewSummary.count})` : ''}`}
              />
            )}

            {reviewSummary.avg !== undefined && (
              <Chip
                icon={<StarIcon />}
                variant="outlined"
                label={`Reviews: ${formatOneDecimal(reviewSummary.avg)}/5${reviewSummary.count ? ` (${reviewSummary.count})` : ''}`}
              />
            )}
          </Stack>

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.5 }}>
            Score details
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
                Computed AI Score: <strong>{aiCalc.computedAi}</strong>
                {typeof aiScore === 'number' && !Number.isNaN(aiScore) && (
                  <>
                    {' '}
                    (stored: <strong>{Math.round(aiScore)}</strong>)
                  </>
                )}
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                Detailed components will populate as the system computes completeness/responsiveness/quality.
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader
          title="Interviews"
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
        <CardContent>
          <Stack spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
              Avg: <strong>{formatOneDecimal(interviewSummary.avg)}</strong>/10
              {interviewSummary.count ? ` (${interviewSummary.count})` : ''}
              {interviewSummary.lastAt ? ` • Last: ${toDateLabel(interviewSummary.lastAt)}` : ''}
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

      {/* Reviews list + add review */}
      <ReviewsTab uid={uid} />
    </Box>
  );
}

