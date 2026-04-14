import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, CircularProgress, Grid, Stack, Typography } from '@mui/material';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import type { JobOrder } from '../../types/recruiter/jobOrder';
import { JOB_ORDER_HIRING_AUTOMATION_ENABLED } from '../../constants/jobOrderHiringAutomationLaunch';
import { useJobOrderHiringControlPanelData } from '../../hooks/useJobOrderHiringControlPanelData';
import JobOrderHiringPipelineMetrics from './jobOrderHiring/JobOrderHiringPipelineMetrics';
import JobOrderHiringAiDecisionsPanel from './jobOrderHiring/JobOrderHiringAiDecisionsPanel';
import JobOrderHiringRecentDecisions from './jobOrderHiring/JobOrderHiringRecentDecisions';
import JobOrderHiringPolicySourceStrip from './jobOrderHiring/JobOrderHiringPolicySourceStrip';
import JobOrderHiringEffectivePolicyCard from './jobOrderHiring/JobOrderHiringEffectivePolicyCard';
import JobOrderHiringProgressAndBlockers from './jobOrderHiring/JobOrderHiringProgressAndBlockers';
import {
  resolveEffectiveJobOrderHiringPolicy,
  type EffectiveJobOrderHiringPolicy,
} from '../../utils/jobOrderEffectiveHiringPolicy';

type Props = {
  jobOrder: JobOrder | null;
  tenantId: string;
  onSaved?: () => void;
};

function computeTargetReady(
  jobOrder: JobOrder | null,
  effective: EffectiveJobOrderHiringPolicy | null,
): { targetReadyCount: number | null; targetReadyLabel: string } {
  const fromPolicy = effective?.resolvedAiHiring.targetReadyCount;
  if (typeof fromPolicy === 'number' && fromPolicy > 0) {
    return { targetReadyCount: fromPolicy, targetReadyLabel: 'target ready (policy)' };
  }
  if (typeof jobOrder?.headcountRequested === 'number' && jobOrder.headcountRequested > 0) {
    return { targetReadyCount: jobOrder.headcountRequested, targetReadyLabel: 'headcount requested' };
  }
  if (typeof jobOrder?.workersNeeded === 'number' && jobOrder.workersNeeded > 0) {
    return { targetReadyCount: jobOrder.workersNeeded, targetReadyLabel: 'workers needed (fallback)' };
  }
  return { targetReadyCount: null, targetReadyLabel: 'not set' };
}

/**
 * Job Order → Hiring: Zones 1–2 read-only (policy source, effective policy, progress & blockers, funnel links).
 * Configuration editor ships in a later phase.
 */
const JobOrderHiringTab: React.FC<Props> = ({ jobOrder, tenantId }) => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tenantData, setTenantData] = useState<Record<string, unknown> | null>(null);
  const [jobOrderRaw, setJobOrderRaw] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!jobOrder?.id || !tenantId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [jobSnap, tenantSnap] = await Promise.all([
          getDoc(doc(db, 'tenants', tenantId, 'job_orders', jobOrder.id)),
          getDoc(doc(db, 'tenants', tenantId)),
        ]);
        if (cancelled) return;
        setJobOrderRaw(jobSnap.exists() ? (jobSnap.data() as Record<string, unknown>) : {});
        setTenantData(tenantSnap.exists() ? (tenantSnap.data() as Record<string, unknown>) : {});
        setLoadError(null);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Failed to load policy');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobOrder?.id, tenantId]);

  const effectivePolicy = useMemo((): EffectiveJobOrderHiringPolicy | null => {
    if (!tenantData || !jobOrderRaw) return null;
    return resolveEffectiveJobOrderHiringPolicy(tenantData, jobOrderRaw);
  }, [tenantData, jobOrderRaw]);

  const workerAiPrescreenRequired = effectivePolicy?.resolvedInterview.workerAiPrescreenRequired ?? true;

  const panel = useJobOrderHiringControlPanelData(tenantId, jobOrder?.id ?? null, workerAiPrescreenRequired);

  const { targetReadyCount, targetReadyLabel } = computeTargetReady(jobOrder, effectivePolicy);

  const fillProgress = useMemo(() => {
    if (targetReadyCount == null || targetReadyCount <= 0) return null;
    return Math.min(1, panel.assigned / targetReadyCount);
  }, [panel.assigned, targetReadyCount]);

  const conversionRateInterviewedToReady = useMemo(() => {
    if (panel.interviewed <= 0) return null;
    return panel.ready / panel.interviewed;
  }, [panel.interviewed, panel.ready]);

  if (!jobOrder?.id) {
    return <Alert severity="info">Open a job order to view hiring progress.</Alert>;
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="h6">{jobOrder.jobOrderName || 'Job order'} — hiring</Typography>
      <Typography variant="body2" color="text.secondary">
        Policy and funnel summary for this job order. Applicant rows and actions live only on the Applications tab.
      </Typography>

      {loadError ? (
        <Alert severity="warning">
          {loadError} (effective policy may be incomplete until tenant and job order load.)
        </Alert>
      ) : null}

      {!JOB_ORDER_HIRING_AUTOMATION_ENABLED ? (
        <Alert severity="warning" sx={{ borderRadius: 1 }}>
          <strong>Hiring automation is paused at launch.</strong> Targets and thresholds below reflect saved policy, but
          auto-advance, phase 6 queueing, and gig fallback stay off until enabled.
        </Alert>
      ) : null}

      {panel.error ? (
        <Alert severity="warning">
          Live metrics: {panel.error} (counts may be incomplete until the query succeeds.)
        </Alert>
      ) : null}

      {effectivePolicy ? <JobOrderHiringPolicySourceStrip kind={effectivePolicy.policySource} /> : null}

      <Grid container spacing={2} alignItems="stretch">
        <Grid item xs={12} md={6}>
          {effectivePolicy ? (
            <JobOrderHiringEffectivePolicyCard
              effective={effectivePolicy}
              targetReadyLabel={targetReadyLabel}
              targetReadyCount={targetReadyCount}
            />
          ) : (
            <Alert severity="info">Could not resolve effective policy.</Alert>
          )}
        </Grid>
        <Grid item xs={12} md={6}>
          <JobOrderHiringProgressAndBlockers
            loading={panel.loading}
            totalApplicants={panel.totalApplicants}
            assigned={panel.assigned}
            targetReadyCount={targetReadyCount}
            targetReadyLabel={targetReadyLabel}
            fillProgress={fillProgress}
            lifecycleBucketCounts={panel.lifecycleBucketCounts}
            interviewPendingCount={panel.lifecycleBucketCounts.interview_pending}
            reviewCount={panel.lifecycleBucketCounts.review}
            profileIncompleteCount={panel.lifecycleBucketCounts.profile_incomplete}
            thresholdBlockerCount={panel.thresholdBlockerCount}
          />
        </Grid>
      </Grid>

      <Typography variant="subtitle2" color="text.secondary">
        Operational metrics (read-only)
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: -1 }}>
        Interviewed → ready conversion:{' '}
        {conversionRateInterviewedToReady != null
          ? `${Math.round(conversionRateInterviewedToReady * 100)}%`
          : '—'}
      </Typography>
      <Grid container spacing={2} alignItems="flex-start">
        <Grid item xs={12} md={6}>
          <JobOrderHiringPipelineMetrics
            totalApplicants={panel.totalApplicants}
            interviewed={panel.interviewed}
            ready={panel.ready}
            onboardingPipeline={panel.onboardingPipeline}
            assigned={panel.assigned}
            loading={panel.loading}
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <Stack spacing={2}>
            <JobOrderHiringAiDecisionsPanel
              decisionCounts={panel.decisionCounts}
              noShowBandCounts={panel.noShowBandCounts}
            />
            <JobOrderHiringRecentDecisions rows={panel.recentDecisions} />
          </Stack>
        </Grid>
      </Grid>
    </Stack>
  );
};

export default JobOrderHiringTab;
