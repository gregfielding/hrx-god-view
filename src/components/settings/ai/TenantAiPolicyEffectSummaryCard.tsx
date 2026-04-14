import React from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import SummarizeIcon from '@mui/icons-material/Summarize';
import type { TenantAiHiringConfig, TenantAiPrescreenConfig, TenantHiringQualityDefaults } from '../../../types/tenantAutomatedHiringDefaults';

export type TenantAiPolicyEffectSummaryCardProps = {
  workerAiPrescreenRequired: boolean;
  prescreen: TenantAiPrescreenConfig;
  hiring: TenantAiHiringConfig;
  tenantQuality: TenantHiringQualityDefaults;
};

/**
 * Compact read-only card: effective tenant defaults for AI interview & hiring (matches controls below).
 */
const TenantAiPolicyEffectSummaryCard: React.FC<TenantAiPolicyEffectSummaryCardProps> = ({
  workerAiPrescreenRequired,
  prescreen,
  hiring,
  tenantQuality,
}) => {
  const interviewThreshold =
    hiring.minimumScoreToAdvance !== undefined && hiring.minimumScoreToAdvance !== null
      ? String(hiring.minimumScoreToAdvance)
      : 'Not set';
  const jobFitGate =
    hiring.minimumJobScoreGateEnabled === true
      ? `On (min job-fit ${hiring.minimumJobScoreToAdvance !== undefined && hiring.minimumJobScoreToAdvance !== null ? hiring.minimumJobScoreToAdvance : '—'})`
      : 'Off';
  const noShow =
    tenantQuality.maximumNoShowRiskToAdvance !== undefined && tenantQuality.maximumNoShowRiskToAdvance !== null
      ? String(tenantQuality.maximumNoShowRiskToAdvance)
      : 'Not set';
  const target =
    hiring.targetOnboardingCount !== undefined && hiring.targetOnboardingCount !== null
      ? String(hiring.targetOnboardingCount)
      : 'Not set';
  const maxAdv =
    hiring.maximumAutoAdvances !== undefined && hiring.maximumAutoAdvances !== null
      ? String(hiring.maximumAutoAdvances)
      : 'Not set';

  const queueParts: string[] = [];
  if (hiring.stopWhenTargetReached === true) {
    queueParts.push('Pause automation at onboarding target');
  } else if (hiring.stopWhenTargetReached === false) {
    queueParts.push('Do not stop solely at onboarding target');
  }
  if (hiring.maximumAutoAdvances !== undefined && hiring.maximumAutoAdvances !== null) {
    queueParts.push(`Cap: ${maxAdv} auto-advances`);
  }
  if (hiring.jobFitFailAction === 'hold') {
    queueParts.push('Job-fit fail → hold');
  } else {
    queueParts.push('Job-fit fail → review');
  }

  const elig = prescreen.eligibility;
  const eligSummary = [
    elig.requireResumeOrSkill && 'resume/skill',
    elig.requirePhone && 'phone',
    elig.requireLocation && 'location',
    elig.requireWorkAuthorization && 'work authorization',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.75,
        borderRadius: 2,
        borderColor: 'primary.light',
        bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(25, 118, 210, 0.08)' : 'rgba(25, 118, 210, 0.04)'),
      }}
    >
      <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ mb: 1.25 }}>
        <SummarizeIcon sx={{ fontSize: 20, color: 'primary.main', mt: 0.15 }} aria-hidden />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            Policy effect summary
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            Tenant defaults; groups and job orders can override.
          </Typography>
        </Box>
      </Stack>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
          gap: { xs: 1, sm: 1.25 },
        }}
      >
        <SummaryRow
          term="AI prescreen required"
          detail={workerAiPrescreenRequired ? 'Yes (unless job/group overrides)' : 'No by default'}
        />
        <SummaryRow term="Prescreen feature" detail={prescreen.enabled ? 'On' : 'Off'} />
        <SummaryRow term="Profile gates" detail={eligSummary ? eligSummary : 'None'} />
        <SummaryRow term="Interview score threshold" detail={interviewThreshold} />
        <SummaryRow term="Job-fit gate" detail={jobFitGate} />
        <SummaryRow term="Max no-show risk" detail={noShow} />
        <SummaryRow term="Auto-advance" detail={hiring.autoAdvanceEnabled ? 'On' : 'Off'} />
        <SummaryRow term="Target onboarding" detail={target} />
        <SummaryRow term="Queue / routing" detail={queueParts.join(' · ') || 'See controls'} />
      </Box>
    </Paper>
  );
};

function SummaryRow({ term, detail }: { term: string; detail: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600, lineHeight: 1.2 }}>
        {term}
      </Typography>
      <Typography variant="body2" sx={{ m: 0, lineHeight: 1.35 }}>
        {detail}
      </Typography>
    </Box>
  );
}

export default TenantAiPolicyEffectSummaryCard;
