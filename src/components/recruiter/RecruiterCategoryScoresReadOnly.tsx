import React, { useMemo } from 'react';
import {
  Box,
  Chip,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import type { PrescreenCategoryEvidenceV1, PrescreenCategoryScoresV1 } from '../../types/prescreenCategoryScores';
import {
  averageCategoryScore,
  categoryScoreBand,
  parsePrescreenCategoryScoresFromFirestore,
} from '../../utils/parseRecruiterCategoryScores';

const CATEGORY_ORDER: { key: keyof PrescreenCategoryScoresV1; label: string }[] = [
  { key: 'reliability', label: 'Reliability' },
  { key: 'punctuality', label: 'Punctuality' },
  { key: 'workEthic', label: 'Work ethic' },
  { key: 'teamFit', label: 'Team fit' },
  { key: 'jobReadiness', label: 'Job readiness' },
  { key: 'stability', label: 'Stability' },
];

function bandColor(band: 'high' | 'medium' | 'low'): 'success' | 'warning' | 'error' {
  if (band === 'high') return 'success';
  if (band === 'medium') return 'warning';
  return 'error';
}

function evidenceTooltipContent(
  ev: PrescreenCategoryEvidenceV1 | null,
  scoreContext: RecruiterCategoryScoreContext,
): React.ReactNode {
  if (scoreContext === 'profile_current' && !ev) {
    return 'Evolving profile scores do not show per-category evidence tags here (unlike interview snapshots).';
  }
  if (!ev) return 'No evidence tags stored for this snapshot.';
  const blocks = CATEGORY_ORDER.map(({ key, label }) => {
    const lines = ev[key];
    if (!lines?.length) return null;
    return (
      <Box key={key} sx={{ mb: 1 }}>
        <Typography variant="caption" fontWeight={700} display="block">
          {label}
        </Typography>
        <Typography variant="caption" component="div" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
          {lines.slice(0, 25).join('\n')}
          {lines.length > 25 ? `\n… +${lines.length - 25} more` : ''}
        </Typography>
      </Box>
    );
  }).filter(Boolean);
  if (!blocks.length) return 'No evidence tags stored for this snapshot.';
  return <Box sx={{ maxWidth: 420 }}>{blocks}</Box>;
}

export type RecruiterCategoryScoresCompactProps = {
  /** Application document or any object that may contain `aiAutomation` */
  applicationData?: Record<string, unknown> | null;
  scoreContext?: RecruiterCategoryScoreContext;
};

/** Recruiter-facing: distinguish evolving profile vs frozen interview/application snapshot. */
export type RecruiterCategoryScoreContext = 'interview_snapshot' | 'profile_current';

function tooltipHeadline(context: RecruiterCategoryScoreContext, avg: number): string {
  if (context === 'profile_current') {
    return `Category scores — current profile (evolving, 0–100) · avg ${avg}`;
  }
  return `Category scores — interview snapshot (historical, 0–100) · avg ${avg}`;
}

/**
 * Single compact chip (average + band color) with tooltip listing all six scores and evidence.
 */
const CategoryScoresTooltipBody: React.FC<{
  scores: PrescreenCategoryScoresV1;
  evidence: PrescreenCategoryEvidenceV1 | null;
  scoreContext: RecruiterCategoryScoreContext;
}> = ({ scores, evidence, scoreContext }) => {
  const avg = averageCategoryScore(scores);
  return (
    <Box>
      <Typography variant="caption" fontWeight={700} display="block" gutterBottom>
        {tooltipHeadline(scoreContext, avg)}
      </Typography>
      <Stack spacing={0.5} sx={{ mb: 1 }}>
        {CATEGORY_ORDER.map(({ key, label }) => (
          <Stack key={key} direction="row" justifyContent="space-between" alignItems="center" gap={1}>
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
            <Chip
              size="small"
              label={String(scores[key])}
              color={bandColor(categoryScoreBand(scores[key]))}
              variant="outlined"
              sx={{ height: 22, minWidth: 36, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }}
            />
          </Stack>
        ))}
      </Stack>
      <Typography variant="caption" fontWeight={700} display="block" sx={{ mt: 1 }}>
        Evidence tags
      </Typography>
      {evidenceTooltipContent(evidence, scoreContext)}
    </Box>
  );
};

export type RecruiterCategoryScoresInlineChipProps = {
  scores: PrescreenCategoryScoresV1;
  evidence: PrescreenCategoryEvidenceV1 | null;
  /** Default: historical snapshot from interview or application. */
  scoreContext?: RecruiterCategoryScoreContext;
};

/** Chip + tooltip when you already have parsed scores (e.g. interview `ai` block). */
export const RecruiterCategoryScoresInlineChip: React.FC<RecruiterCategoryScoresInlineChipProps> = ({
  scores,
  evidence,
  scoreContext = 'interview_snapshot',
}) => {
  const avg = averageCategoryScore(scores);
  const band = categoryScoreBand(avg);
  const label =
    scoreContext === 'profile_current' ? `Live ${avg}` : `Cat. ${avg}`;
  return (
    <Tooltip
      title={<CategoryScoresTooltipBody scores={scores} evidence={evidence} scoreContext={scoreContext} />}
      placement="top"
      enterTouchDelay={0}
    >
      <Chip
        size="small"
        label={label}
        color={bandColor(band)}
        variant={band === 'high' ? 'filled' : 'outlined'}
        sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }}
      />
    </Tooltip>
  );
};

export const RecruiterCategoryScoresCompact: React.FC<RecruiterCategoryScoresCompactProps> = ({
  applicationData,
  scoreContext = 'interview_snapshot',
}) => {
  const parsed = useMemo(
    () => parsePrescreenCategoryScoresFromFirestore(applicationData?.aiAutomation),
    [applicationData],
  );
  const { scores, evidence } = parsed;
  if (!scores) return null;

  const avg = averageCategoryScore(scores);
  const band = categoryScoreBand(avg);
  const label =
    scoreContext === 'profile_current' ? `Live ${avg}` : `Categories ${avg}`;

  return (
    <Tooltip
      title={<CategoryScoresTooltipBody scores={scores} evidence={evidence} scoreContext={scoreContext} />}
      placement="top"
      enterTouchDelay={0}
    >
      <Chip
        size="small"
        label={label}
        color={bandColor(band)}
        variant={band === 'high' ? 'filled' : 'outlined'}
        sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }}
      />
    </Tooltip>
  );
};

export type RecruiterCategoryScoresPanelProps = {
  scores: PrescreenCategoryScoresV1;
  evidence: PrescreenCategoryEvidenceV1 | null;
  /** Optional heading above the panel */
  title?: string;
  /** When false, the panel title line is omitted (e.g. parent card already has a heading). */
  showHeading?: boolean;
  /** Replaces the default explanatory caption; pass `null` to hide the caption row. */
  description?: React.ReactNode | null;
  /** Optional note below the bars / evidence (e.g. data source). */
  footnote?: React.ReactNode;
  /**
   * When `title` / `description` are omitted, sets recruiter-facing defaults for snapshot vs current profile.
   */
  scoreKind?: RecruiterCategoryScoreContext;
};

const defaultInterviewSnapshotCaption = (
  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
    Historical snapshot from the worker AI pre-screen (0–100 per category). Frozen at interview time — not the same as
    the single overall interview score. Compare to current profile scores where shown.
  </Typography>
);

const defaultProfileCurrentCaption = (
  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
    Evolving scores on the worker&apos;s profile (0–100 per category). Updated by trusted events over time — not a
    frozen interview record.
  </Typography>
);

/**
 * Full read-only panel: labeled bars + collapsible-style evidence block.
 */
export const RecruiterCategoryScoresPanel: React.FC<RecruiterCategoryScoresPanelProps> = ({
  scores,
  evidence,
  title,
  showHeading = true,
  description,
  footnote,
  scoreKind = 'interview_snapshot',
}) => {
  const defaultTitle =
    scoreKind === 'profile_current' ? 'Current category scores (worker profile)' : 'Interview category snapshot';
  const resolvedTitle = title ?? defaultTitle;
  const caption =
    description === undefined
      ? scoreKind === 'profile_current'
        ? defaultProfileCurrentCaption
        : defaultInterviewSnapshotCaption
      : description === null
        ? null
        : description;

  return (
    <Box>
      {showHeading ? (
        <Typography variant="subtitle2" fontWeight={600} gutterBottom>
          {resolvedTitle}
        </Typography>
      ) : null}
      {caption}
      <Stack spacing={1.25}>
        {CATEGORY_ORDER.map(({ key, label }) => {
          const v = scores[key];
          const band = categoryScoreBand(v);
          return (
            <Box key={key}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.25 }}>
                <Typography variant="caption" fontWeight={600}>
                  {label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {v}
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={v}
                color={band === 'high' ? 'success' : band === 'medium' ? 'warning' : 'error'}
                sx={{ height: 8, borderRadius: 1 }}
              />
            </Box>
          );
        })}
      </Stack>
      {evidence && CATEGORY_ORDER.some(({ key }) => (evidence[key]?.length ?? 0) > 0) ? (
        <Box sx={{ mt: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
          <Typography variant="caption" fontWeight={700} display="block" sx={{ mb: 1 }}>
            Evidence tags
          </Typography>
          {CATEGORY_ORDER.map(({ key, label }) => {
            const lines = evidence[key];
            if (!lines?.length) return null;
            return (
              <Box key={key} sx={{ mb: 1 }}>
                <Typography variant="caption" fontWeight={600} display="block" color="text.secondary">
                  {label}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>
                  {lines.join(' · ')}
                </Typography>
              </Box>
            );
          })}
        </Box>
      ) : (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          No evidence tags on this record.
        </Typography>
      )}
      {footnote ? (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
          {footnote}
        </Typography>
      ) : null}
    </Box>
  );
};
