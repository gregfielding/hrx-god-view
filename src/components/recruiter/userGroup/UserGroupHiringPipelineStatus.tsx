import React, { useMemo } from 'react';
import { Box, Card, CardContent, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import { getUserGroupHiringUxDisplay, type GroupHiringPipelineMetrics } from '../../../utils/userGroupHiringPipeline';
import type { UserGroupHiringConfigV1 } from '../../../types/userGroupHiringConfig';

export type UserGroupHiringPipelineStatusProps = {
  cfg: UserGroupHiringConfigV1;
  metrics: GroupHiringPipelineMetrics;
  loading: boolean;
  /** Same count as applications in the policy-impact table (group-scoped query). */
  applicationCount?: number;
};

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <Box
      sx={{
        px: 1.5,
        py: 0.75,
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        minWidth: 96,
      }}
    >
      <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.2 }}>
        {label}
      </Typography>
      <Typography variant="subtitle1" fontWeight={700}>
        {value}
      </Typography>
    </Box>
  );
}

export const UserGroupHiringPipelineStatus: React.FC<UserGroupHiringPipelineStatusProps> = ({
  cfg,
  metrics,
  loading,
  applicationCount,
}) => {
  const tgt = cfg.targets?.targetOnboardingCount;
  const target = typeof tgt === 'number' && Number.isFinite(tgt) && tgt >= 1 ? tgt : null;
  const current = metrics.currentOnboardingForTarget;
  const remaining = target != null ? Math.max(0, target - current) : '—';
  const progress = target != null && target > 0 ? Math.min(1, current / target) : 0;

  const display = useMemo(() => getUserGroupHiringUxDisplay(cfg, metrics), [cfg, metrics]);

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'primary.light' }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 1.5 }}>
          <Typography variant="subtitle1" fontWeight={800}>
            Hiring pipeline status
          </Typography>
          <Chip size="small" color={display.color} label={display.label} />
        </Stack>

        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 1.5 }}>
          <StatChip label="Target onboarding" value={target ?? '—'} />
          <StatChip label="In onboarding flow" value={loading ? '…' : current} />
          <StatChip label="Remaining slots" value={loading ? '…' : remaining} />
        </Stack>

        {target != null ? (
          <Box sx={{ mb: 1.5 }}>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Onboarding progress
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {current} / {target}
              </Typography>
            </Stack>
            <LinearProgress variant={loading ? 'indeterminate' : 'determinate'} value={progress * 100} sx={{ height: 8, borderRadius: 1 }} />
          </Box>
        ) : null}

        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
          Funnel (group-scoped applications)
          {applicationCount !== undefined && !loading ? (
            <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
              Same {applicationCount} application record{applicationCount === 1 ? '' : 's'} as in &quot;Candidates
              affected by current policy&quot; below.
            </Box>
          ) : null}
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={1}>
          <StatChip label="Interviewed" value={loading ? '…' : metrics.interviewed} />
          <StatChip label="Qualified" value={loading ? '…' : metrics.qualified} />
          <StatChip label="Auto-advanced" value={loading ? '…' : metrics.autoAdvanced} />
          <StatChip
            label="Onboarding"
            value={loading ? '…' : metrics.onboardingAccepted + metrics.onboardingInFlow}
          />
          <StatChip label="Queued" value={loading ? '…' : metrics.queued} />
        </Stack>
      </CardContent>
    </Card>
  );
};

export default UserGroupHiringPipelineStatus;
