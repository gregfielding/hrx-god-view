import React, { useMemo, useState } from 'react';
import { Button, Stack } from '@mui/material';
import PersonAddAlt1OutlinedIcon from '@mui/icons-material/PersonAddAlt1Outlined';
import type { EmploymentEntityKey, EmploymentEntityOverview } from './employmentV2Types';
import type { EmploymentV2ActionResolutionContext } from '../../../../utils/employmentBlockerActionMap';
import EmploymentEntityHeaderCard from './EmploymentEntityHeaderCard';
import EmploymentOnboardingPathCard from './EmploymentOnboardingPathCard';
import EmploymentActiveAssignmentRequirementsCard from './EmploymentActiveAssignmentRequirementsCard';
import EmploymentBlockersCard from './EmploymentBlockersCard';
import EmploymentAssignmentsCard from './EmploymentAssignmentsCard';
import EmploymentSystemsSummaryCard from './EmploymentSystemsSummaryCard';
import EmploymentEmptyStateCard from './EmploymentEmptyStateCard';
import StartOnCallEmploymentDialog from './StartOnCallEmploymentDialog';

export interface EmploymentEntityPanelProps {
  entityKey: EmploymentEntityKey;
  overview: EmploymentEntityOverview;
  profileUserId: string;
  tenantId: string;
  tenantSlug?: string;
  onRefresh?: () => void;
  /** Recruiter/admin: show “Start on-call employment” for the active entity tab. */
  allowStartOnCallEmployment?: boolean;
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
  allowStartOnCallEmployment,
}) => {
  const [onCallOpen, setOnCallOpen] = useState(false);
  const showEmptyExplainer = !overview.entityEmployment && !overview.workerOnboarding;

  const actionContext: EmploymentV2ActionResolutionContext = useMemo(() => {
    const firstAssign = overview.assignments?.[0]?.assignmentId ?? null;
    return {
      userId: profileUserId,
      tenantId,
      tenantSlug,
      viewer: 'recruiter',
      entityEmploymentFirestoreId: overview.entityEmployment?.id ?? null,
      payrollPortalUrl:
        overview.systems.payroll?.entityOnboardingUrl ||
        overview.systems.payroll?.entityPortalUrl ||
        overview.systems.payroll?.portalUrl ||
        null,
      everifyAssignmentId: firstAssign,
    };
  }, [profileUserId, tenantId, tenantSlug, overview]);

  return (
    <Stack spacing={0}>
      {allowStartOnCallEmployment ? (
        <>
          <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<PersonAddAlt1OutlinedIcon />}
              onClick={() => setOnCallOpen(true)}
            >
              Start on-call employment
            </Button>
          </Stack>
          <StartOnCallEmploymentDialog
            open={onCallOpen}
            onClose={() => setOnCallOpen(false)}
            tenantId={tenantId}
            profileUserId={profileUserId}
            entityKey={entityKey}
            onSuccess={() => onRefresh?.()}
          />
        </>
      ) : null}
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
