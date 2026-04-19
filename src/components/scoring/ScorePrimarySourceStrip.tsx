import React from 'react';
import { Alert, Box, Stack, Typography } from '@mui/material';
import type { ScoreSummary } from '../../utils/scoreSummary';
import type { WorkerInterviewAiBlock } from '../../types/workerAiPrescreenInterview';
import { resolveRecruiterPrimaryDisplay } from '../../utils/scoring/recruiterPrimaryDisplay';
import { getRecruiterScoreDisplayForAdminUi } from '../../utils/scoring/recruiterScoreSnapshot';

function formatFirestoreTime(ts: unknown): string {
  try {
    const t = ts as { toDate?: () => Date } | undefined;
    const d = t?.toDate?.() ?? (ts instanceof Date ? ts : null);
    if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
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
}

export type ScorePrimarySourceStripProps = {
  scoreSummary?: ScoreSummary;
  latestPrescreenInterviewAi?: WorkerInterviewAiBlock | null;
  scoreFreshnessMeta?: {
    userUpdatedAt?: unknown;
    categoryScoresCurrentUpdatedAt?: unknown;
    riskProfileLastUpdatedAt?: unknown;
    complianceTouchAt?: unknown;
  };
  /** Canonical recruiter snapshot on user doc — when `useRecruiterSnapshotOnly`, strip ignores legacy primary resolution. */
  recruiterScoreSnapshot?: unknown;
  useRecruiterSnapshotOnly?: boolean;
};

/**
 * Top-of-tab explanation: which number is the recruiter primary score and how it relates to legacy profile score.
 */
export default function ScorePrimarySourceStrip({
  scoreSummary,
  latestPrescreenInterviewAi,
  scoreFreshnessMeta,
  recruiterScoreSnapshot,
  useRecruiterSnapshotOnly = false,
}: ScorePrimarySourceStripProps) {
  const snap = getRecruiterScoreDisplayForAdminUi(recruiterScoreSnapshot);
  const d = resolveRecruiterPrimaryDisplay({ scoreSummary, latestPrescreenInterviewAi });
  if (useRecruiterSnapshotOnly) {
    const primary = snap.hasSnapshot && snap.score100 != null ? `${Math.round(snap.score100)}/100` : '—';
    const grade = snap.hasSnapshot && snap.grade ? snap.grade : '—';
    const lastUpdated =
      formatFirestoreTime(
        (recruiterScoreSnapshot as { updatedAt?: unknown } | null | undefined)?.updatedAt,
      ) !== '—'
        ? formatFirestoreTime((recruiterScoreSnapshot as { updatedAt?: unknown })?.updatedAt)
        : formatFirestoreTime(scoreFreshnessMeta?.userUpdatedAt);

    return (
      <Box
        sx={{
          p: 1.5,
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
          Recruiter score (canonical)
        </Typography>
        <Stack spacing={0.75}>
          <Typography variant="body2" color="text.primary">
            <strong>Primary score (shown everywhere):</strong> {primary} · grade {grade}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            Recruiter score shown everywhere is based on this snapshot. Supporting values below are components, not alternate
            primaries.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            <strong>Operational (component):</strong>{' '}
            {snap.operationalScore100 != null ? `${Math.round(snap.operationalScore100)}/100` : '—'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            <strong>Composite (component):</strong>{' '}
            {snap.compositeScore100 != null ? `${Math.round(snap.compositeScore100)}/100` : '—'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            <strong>Interview base (component):</strong>{' '}
            {snap.interviewScoreBase100 != null ? `${Math.round(snap.interviewScoreBase100)}/100` : '—'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            <strong>Last updated:</strong> {lastUpdated}
          </Typography>
          {!snap.hasSnapshot ? (
            <Alert severity="warning" sx={{ py: 0.5 }}>
              <Typography variant="body2">No snapshot on file yet — run backfill or Review &amp; rescore.</Typography>
            </Alert>
          ) : null}
        </Stack>
      </Box>
    );
  }

  const op = d.primaryScore100 != null ? `${Math.round(d.primaryScore100)}/100` : '—';
  const base = scoreSummary?.baseInterviewScore;
  const interviewBase =
    typeof base === 'number' && Number.isFinite(base) ? `${Math.round(base)}/100` : '—';
  const legacy =
    d.secondaryProfileComposite100 != null ? `${Math.round(d.secondaryProfileComposite100)}/100` : '—';

  let mismatchLine: string | null = null;
  if (d.hasConflict && latestPrescreenInterviewAi) {
    mismatchLine =
      'Recruiter views use the operational prescreen score because this worker has a recent AI interview. The lower profile/composite score is legacy or profile-based and is not the main hiring score.';
  } else if (d.hasConflict && d.primarySource !== 'legacy_composite') {
    mismatchLine =
      'The profile/composite score has not been fully re-aligned to the latest interview — operational prescreen score is primary.';
  }

  const lastUpdated =
    formatFirestoreTime(scoreSummary?.primaryRecruiterScoreUpdatedAt) !== '—'
      ? formatFirestoreTime(scoreSummary?.primaryRecruiterScoreUpdatedAt)
      : formatFirestoreTime(scoreSummary?.aiScoreUpdatedAt) !== '—'
        ? formatFirestoreTime(scoreSummary?.aiScoreUpdatedAt)
        : formatFirestoreTime(scoreFreshnessMeta?.userUpdatedAt);

  const debugVersionLine = [
    scoreSummary?.recruiterScoreSourceVersion && `recruiter summary: ${scoreSummary.recruiterScoreSourceVersion}`,
    scoreSummary?.overrideRulesVersion && `override rules: ${scoreSummary.overrideRulesVersion}`,
    scoreSummary?.scoreComputationVersion && `score computation: ${scoreSummary.scoreComputationVersion}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
        Primary score used (recruiter)
      </Typography>
      <Stack spacing={0.75}>
        <Typography variant="body2" color="text.primary">
          <strong>Primary recruiter score:</strong> Operational score ({op} · grade {d.primaryGrade})
        </Typography>
        <Typography variant="body2" color="text.secondary">
          <strong>Interview score (base):</strong> {interviewBase}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          <strong>Legacy profile / composite score (secondary):</strong> {legacy}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          <strong>Last updated:</strong> {lastUpdated}
        </Typography>
        {scoreSummary?.primaryRecruiterScoreSource ? (
          <Typography variant="caption" color="text.secondary">
            Stored source: {scoreSummary.primaryRecruiterScoreSource}
            {scoreSummary.recruiterScoreSourceVersion ? ` · ${scoreSummary.recruiterScoreSourceVersion}` : ''}
          </Typography>
        ) : null}
        {debugVersionLine ? (
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block' }}>
            {debugVersionLine}
          </Typography>
        ) : null}
        {mismatchLine ? (
          <Alert severity="info" sx={{ py: 0.5 }}>
            <Typography variant="body2">{mismatchLine}</Typography>
          </Alert>
        ) : null}
      </Stack>
    </Box>
  );
}
