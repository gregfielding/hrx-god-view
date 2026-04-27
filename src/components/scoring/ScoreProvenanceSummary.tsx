import React from 'react';
import { Box, Stack, Typography } from '@mui/material';

export type ScoreProvenanceSummaryProps = {
  operationalScore100: number | null;
  interviewScore100: number | null;
  profileComposite100: number | null;
  showComposite: boolean;
  decisionSourceLabel: string;
  lastUpdatedLabel: string;
  correctionApplied: boolean;
  compact?: boolean;
};

/**
 * Compact recruiter-audit strip: what scores mean and where they came from.
 */
export default function ScoreProvenanceSummary({
  operationalScore100,
  interviewScore100,
  profileComposite100,
  showComposite,
  decisionSourceLabel,
  lastUpdatedLabel,
  correctionApplied,
  compact,
}: ScoreProvenanceSummaryProps) {
  const op = operationalScore100 != null ? `${Math.round(operationalScore100)}/100` : '—';
  const iv = interviewScore100 != null ? `${Math.round(interviewScore100)}/100` : '—';
  const comp =
    showComposite && profileComposite100 != null ? `${Math.round(profileComposite100)}/100` : null;

  return (
    <Box
      sx={{
        py: compact ? 0.75 : 1,
        px: compact ? 1 : 1.25,
        borderRadius: 1,
        bgcolor: 'action.hover',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Stack direction="row" flexWrap="wrap" alignItems="baseline" gap={1.25} columnGap={2} rowGap={0.5}>
        <Typography variant="caption" component="span" color="text.secondary">
          <strong>Operational score</strong> {op}
        </Typography>
        <Typography variant="caption" component="span" color="text.secondary">
          <strong>Interview score</strong> {iv}
        </Typography>
        {comp ? (
          <Typography variant="caption" component="span" color="text.secondary">
            <strong>Legacy profile score (secondary)</strong> {comp}
          </Typography>
        ) : null}
        <Typography variant="caption" component="span" color="text.secondary">
          <strong>Decision source</strong> {decisionSourceLabel}
        </Typography>
        <Typography variant="caption" component="span" color="text.secondary">
          <strong>Last updated</strong> {lastUpdatedLabel}
        </Typography>
        <Typography variant="caption" component="span" color="text.secondary">
          <strong>Correction applied</strong> {correctionApplied ? 'Yes' : 'No'}
        </Typography>
      </Stack>
    </Box>
  );
}
