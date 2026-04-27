import React, { useMemo } from 'react';
import { Card, CardContent, Chip, Stack, Typography } from '@mui/material';

export type JobOrderHiringAiDecisionsPanelProps = {
  decisionCounts: Record<string, number>;
  noShowBandCounts: Record<string, number>;
};

const DECISION_ORDER = ['advance', 'review', 'hold', 'reject', 'unknown'] as const;

const JobOrderHiringAiDecisionsPanel: React.FC<JobOrderHiringAiDecisionsPanelProps> = ({
  decisionCounts,
  noShowBandCounts,
}) => {
  const topBands = useMemo(() => {
    return Object.entries(noShowBandCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [noShowBandCounts]);

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
      <CardContent>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          AI decisions
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
          Aggregated from <code>aiAutomation.orchestratorV1</code> on applications (read-only).
        </Typography>
        <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.75 }}>
          Policy engine outcomes
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mb: 2 }}>
          {DECISION_ORDER.map((k) => {
            const n = decisionCounts[k] ?? 0;
            if (!n && k === 'unknown') return null;
            return (
              <Chip
                key={k}
                size="small"
                label={`${k}: ${n}`}
                color={k === 'advance' ? 'success' : k === 'reject' ? 'error' : 'default'}
                variant={n ? 'filled' : 'outlined'}
              />
            );
          })}
        </Stack>
        <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.75 }}>
          No-show risk bands (orchestrator inputs)
        </Typography>
        {topBands.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No band data yet.
          </Typography>
        ) : (
          <Stack spacing={0.5}>
            {topBands.map(([band, n]) => (
              <Stack key={band} direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2">{band}</Typography>
                <Chip size="small" label={String(n)} />
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};

export default JobOrderHiringAiDecisionsPanel;
