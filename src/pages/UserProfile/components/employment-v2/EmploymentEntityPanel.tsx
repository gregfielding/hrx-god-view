import React, { useMemo } from 'react';
import { Stack, Button } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { EmploymentEntityKey, EmploymentEntityOverview } from './employmentV2Types';
import type { EmploymentV2ActionResolutionContext } from '../../../../utils/employmentBlockerActionMap';
import EmploymentEntityHeaderCard from './EmploymentEntityHeaderCard';
import EmploymentOnboardingPathCard from './EmploymentOnboardingPathCard';
import EmploymentActiveAssignmentRequirementsCard from './EmploymentActiveAssignmentRequirementsCard';
import EmploymentBlockersCard from './EmploymentBlockersCard';
import EmploymentAssignmentsCard from './EmploymentAssignmentsCard';
import EmploymentSystemsSummaryCard from './EmploymentSystemsSummaryCard';
import EmploymentEmptyStateCard from './EmploymentEmptyStateCard';

export interface EmploymentEntityPanelProps {
  entityKey: EmploymentEntityKey;
  overview: EmploymentEntityOverview;
  profileUserId: string;
  tenantId: string;
  tenantSlug?: string;
  onRefresh?: () => void;
  /** Forwarded to onboarding path card; see `resolveEmploymentOnboardingPathDebugMode`. */
  onboardingPathDebugMode?: boolean;
}

const EmploymentEntityPanel: React.FC<EmploymentEntityPanelProps> = ({
  entityKey,
  overview,
  profileUserId,
  tenantId,
  tenantSlug,
  onRefresh,
  onboardingPathDebugMode,
}) => {
  const showEmptyExplainer = !overview.entityEmployment && !overview.workerOnboarding;

  const actionContext: EmploymentV2ActionResolutionContext = useMemo(() => {
    const firstAssign = overview.assignments?.[0]?.assignmentId ?? null;
    return {
      userId: profileUserId,
      tenantId,
      tenantSlug,
      viewer: 'recruiter',
      entityEmploymentFirestoreId: overview.entityEmployment?.id ?? null,
      payrollPortalUrl: overview.systems.payroll?.portalUrl ?? null,
      everifyAssignmentId: firstAssign,
    };
  }, [profileUserId, tenantId, tenantSlug, overview]);

  return (
    <Stack spacing={0}>
      {onRefresh && (
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
          <Button size="small" startIcon={<RefreshIcon />} onClick={onRefresh}>
            Refresh
          </Button>
        </Stack>
      )}
      <EmploymentEntityHeaderCard overview={overview} />
      <EmploymentOnboardingPathCard
        groups={overview.onboardingPath}
        entityKey={entityKey}
        actionContext={actionContext}
        onActionComplete={onRefresh}
        debugMode={onboardingPathDebugMode}
        suppressCurrentDemandBlockers={!overview.hasOpenOnboardingDemand}
        workerOnboarding={overview.workerOnboarding}
      />
      <EmploymentActiveAssignmentRequirementsCard
        overview={overview}
        entityKey={entityKey}
        actionContext={actionContext}
        onActionComplete={onRefresh}
      />
      <EmploymentSystemsSummaryCard overview={overview} />
      <EmploymentBlockersCard
        blockers={overview.hasOpenOnboardingDemand ? overview.blockers : []}
      />
      <EmploymentAssignmentsCard
        assignments={overview.assignments}
        hasOpenOnboardingDemand={overview.hasOpenOnboardingDemand}
      />
      {showEmptyExplainer && <EmploymentEmptyStateCard entityKey={entityKey} />}
    </Stack>
  );
};

export default EmploymentEntityPanel;
