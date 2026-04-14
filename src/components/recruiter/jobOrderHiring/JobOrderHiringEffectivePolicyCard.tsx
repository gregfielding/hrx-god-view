import React from 'react';
import { Card, CardContent, Divider, Stack, Typography } from '@mui/material';
import type { EffectiveJobOrderHiringPolicy } from '../../../utils/jobOrderEffectiveHiringPolicy';
import { JOB_ORDER_HIRING_AUTOMATION_ENABLED } from '../../../constants/jobOrderHiringAutomationLaunch';

export type JobOrderHiringEffectivePolicyCardProps = {
  effective: EffectiveJobOrderHiringPolicy;
  /** Display label for staffing target provenance (headcount vs explicit target). */
  targetReadyLabel: string;
  targetReadyCount: number | null;
};

function fmtPct(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n}%`;
}

function fmtNum(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return String(n);
}

/**
 * Zone 1 — read-only summary of merged tenant + job order hiring automation (effective policy).
 */
const JobOrderHiringEffectivePolicyCard: React.FC<JobOrderHiringEffectivePolicyCardProps> = ({
  effective,
  targetReadyLabel,
  targetReadyCount,
}) => {
  const { resolvedAiHiring: r, resolvedInterview: iv, tenantMaxNoShowRiskToAdvance } = effective;
  const automationPaused =
    !JOB_ORDER_HIRING_AUTOMATION_ENABLED || !r.autoAdvanceEnabled || !r.allowGigFallback;

  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Effective policy (read-only)
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
          Resolved from tenant + this job order, including automation pause flags. Row-level detail stays on the
          Applications tab.
        </Typography>

        {!JOB_ORDER_HIRING_AUTOMATION_ENABLED ? (
          <Typography variant="body2" color="warning.main" sx={{ mb: 1.5 }}>
            Hiring automation is not launched for job orders yet—auto-advance and gig fallback are held off even when
            saved values would enable them.
          </Typography>
        ) : null}

        <Stack spacing={1.25} divider={<Divider flexItem />}>
          <Row
            label="AI prescreen"
            value={iv.workerAiPrescreenRequired ? 'Required' : 'Optional'}
            hint="Workers may proceed without a completed prescreen when optional."
          />
          <Row
            label="Interview score to advance"
            value={fmtNum(r.minimumScoreToAdvance)}
            hint="Minimum AI / prescreen score for auto-advance when enabled."
          />
          <Row
            label="Job-fit gate"
            value={
              r.minimumJobScoreGateEnabled
                ? `On · min ${fmtNum(r.minimumJobScoreToAdvance)} · ${r.jobFitFailAction ?? 'review'}`
                : 'Off'
            }
          />
          <Row
            label="Auto-advance"
            value={r.autoAdvanceEnabled ? 'On' : 'Off'}
            hint={automationPaused ? 'Suppressed by launch pause or job order pause.' : undefined}
          />
          <Row label="Top % to advance" value={fmtPct(r.topPercentToAdvance)} />
          <Row label="Max auto-advances (batch)" value={fmtNum(r.maximumAutoAdvances)} />
          <Row
            label="Staffing target (ready)"
            value={targetReadyCount != null && targetReadyCount > 0 ? String(targetReadyCount) : '—'}
            hint={targetReadyLabel}
          />
          <Row label="Onboarding target" value={fmtNum(r.targetOnboardingCount)} />
          <Row label="Stop when target reached" value={r.stopWhenTargetReached ? 'Yes' : 'No'} />
          <Row
            label="Gig fallback"
            value={r.allowGigFallback ? 'Allowed' : 'Off'}
            hint={!r.allowGigFallback ? 'Suppressed when automation is paused.' : undefined}
          />
          <Row
            label="Max no-show risk to advance"
            value={tenantMaxNoShowRiskToAdvance != null ? String(tenantMaxNoShowRiskToAdvance) : '—'}
            hint="From tenant quality settings when set."
          />
        </Stack>
      </CardContent>
    </Card>
  );
};

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <Typography variant="body2" fontWeight={600}>
        {label}
      </Typography>
      <Typography variant="body1">{value}</Typography>
      {hint ? (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      ) : null}
    </div>
  );
}

export default JobOrderHiringEffectivePolicyCard;
