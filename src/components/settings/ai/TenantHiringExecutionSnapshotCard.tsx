import React from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { useTenantHiringLifecycleStageCounts } from '../../../hooks/useTenantHiringLifecycleStageCounts';
import { HIRING_LIFECYCLE_STAGE_LABELS } from '../../../constants/hiringLifecycle';
import type { HiringLifecycleStage } from '../../../types/applicationHiringLifecycle';

const BOTTLENECKS: ReadonlyArray<{ stage: HiringLifecycleStage; shortLabel: string }> = [
  { stage: 'profile_incomplete', shortLabel: 'Profile completion' },
  { stage: 'interview_pending', shortLabel: 'Interview' },
  { stage: 'review', shortLabel: 'Recruiter review' },
  { stage: 'waitlisted', shortLabel: 'Waitlisted (capacity)' },
];

type Props = {
  tenantId: string;
};

/**
 * Tenant-wide lifecycle snapshot: bottleneck-focused counts + compact “other” stage.
 * Uses the same Firestore count queries as before; additive, not full reporting.
 */
const TenantHiringExecutionSnapshotCard: React.FC<Props> = ({ tenantId }) => {
  const { loading, error, counts } = useTenantHiringLifecycleStageCounts(tenantId);

  if (!tenantId) return null;

  return (
    <Paper variant="outlined" sx={{ p: 1.75, mb: 2, borderRadius: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <HourglassEmptyIcon sx={{ fontSize: 20, color: 'text.secondary' }} aria-hidden />
        <Typography variant="subtitle1" component="h3" fontWeight={600}>
          Execution snapshot
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.25 }}>
        Tenant-wide counts where applications store lifecycle stage. No stage field means not counted. Job and group
        settings still affect individual rows.
      </Typography>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
          <CircularProgress size={24} />
        </Box>
      ) : error ? (
        <Alert severity="warning" sx={{ py: 0.5 }}>
          Could not load counts ({error}).
        </Alert>
      ) : (
        <Stack spacing={1.5}>
          <Box>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.04 }}>
              Where candidates may be waiting
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' },
                gap: 1,
                mt: 0.75,
              }}
            >
              {BOTTLENECKS.map(({ stage, shortLabel }) => (
                <Box
                  key={stage}
                  sx={{
                    px: 1,
                    py: 0.75,
                    borderRadius: 1,
                    border: 1,
                    borderColor: 'divider',
                    bgcolor: 'action.hover',
                  }}
                >
                  <Typography variant="h6" sx={{ m: 0, fontWeight: 700, lineHeight: 1.2 }}>
                    {counts[stage] ?? 0}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {shortLabel}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>

          <Divider flexItem />

          <Box>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.04 }}>
              Other stages (same data)
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 0.75 }}>
              {(['qualified'] as const).map((stage) => (
                <Box
                  key={stage}
                  sx={{
                    px: 1,
                    py: 0.5,
                    borderRadius: 1,
                    border: 1,
                    borderColor: 'divider',
                  }}
                >
                  <Typography variant="body2" component="span" fontWeight={600}>
                    {counts[stage] ?? 0}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
                    {HIRING_LIFECYCLE_STAGE_LABELS[stage]}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Box>
        </Stack>
      )}
    </Paper>
  );
};

export default TenantHiringExecutionSnapshotCard;
