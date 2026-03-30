import React from 'react';
import { Stack, Button } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { EmploymentEntityKey, EmploymentEntityOverview } from './employmentV2Types';
import EmploymentEntityHeaderCard from './EmploymentEntityHeaderCard';
import EmploymentOnboardingPathCard from './EmploymentOnboardingPathCard';
import EmploymentBlockersCard from './EmploymentBlockersCard';
import EmploymentAssignmentsCard from './EmploymentAssignmentsCard';
import EmploymentSystemsSummaryCard from './EmploymentSystemsSummaryCard';
import EmploymentEmptyStateCard from './EmploymentEmptyStateCard';

export interface EmploymentEntityPanelProps {
  entityKey: EmploymentEntityKey;
  overview: EmploymentEntityOverview;
  onRefresh?: () => void;
}

const EmploymentEntityPanel: React.FC<EmploymentEntityPanelProps> = ({ entityKey, overview, onRefresh }) => {
  const showEmptyExplainer = !overview.entityEmployment && !overview.workerOnboarding;

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
      <EmploymentOnboardingPathCard groups={overview.onboardingPath} />
      <EmploymentBlockersCard blockers={overview.blockers} />
      <EmploymentAssignmentsCard assignments={overview.assignments} />
      <EmploymentSystemsSummaryCard overview={overview} />
      {showEmptyExplainer && <EmploymentEmptyStateCard entityKey={entityKey} />}
    </Stack>
  );
};

export default EmploymentEntityPanel;
