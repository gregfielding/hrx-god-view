import React from 'react';
import { Box, Typography } from '@mui/material';
import WorkflowOverviewCard from '../../../components/settings/ai/WorkflowOverviewCard';
import TenantHiringExecutionSnapshotCard from '../../../components/settings/ai/TenantHiringExecutionSnapshotCard';
import { useAuth } from '../../../contexts/AuthContext';
import AutomatedHiringDefaultsPanel from './AutomatedHiringDefaultsPanel';

/**
 * Settings → AI interview & hiring: tenant-wide automated hiring + prescreen defaults.
 */
const AISignalsSettings: React.FC = () => {
  const { tenantId, activeTenant } = useAuth();
  const effectiveTenantId = activeTenant?.id || tenantId || '';

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 1.5, maxWidth: 960 }}>
      <Typography variant="h6" component="h2" fontWeight={600} sx={{ mb: 0.5 }}>
        AI interview &amp; hiring — tenant policy
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, maxWidth: 720 }}>
        Baseline prescreen, scores, automation, and capacity. Jobs and groups override where supported; use job tools
        for full funnel detail.
      </Typography>
      <WorkflowOverviewCard />
      <TenantHiringExecutionSnapshotCard tenantId={effectiveTenantId} />
      <AutomatedHiringDefaultsPanel tenantId={effectiveTenantId} />
    </Box>
  );
};

export default AISignalsSettings;
