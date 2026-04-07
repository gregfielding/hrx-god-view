import React, { useMemo } from 'react';
import { Box, Card, CardContent, CardHeader, Stack } from '@mui/material';
import type { WorkAuthorizedStatus } from '../../../../utils/workAuthorizedDisplay';
import type { EmploymentEntityKey, EmploymentEntityOverview } from './employmentV2Types';
import type { EmploymentV2ActionResolutionContext } from '../../../../utils/employmentBlockerActionMap';
import EmploymentMinimalOnboardingChecklist from './EmploymentMinimalOnboardingChecklist';
import EmploymentEmptyStateCard from './EmploymentEmptyStateCard';
import { EMPLOYMENT_V2_ANCHOR_ONBOARDING } from '../../../../utils/workerReadinessBannerModel';

export interface EmploymentEntityPanelProps {
  entityKey: EmploymentEntityKey;
  overview: EmploymentEntityOverview;
  profileUserId: string;
  tenantId: string;
  tenantSlug?: string;
  onRefresh?: () => void;
  workerDisplayName?: string | null;
  workAuthorizedStatus: WorkAuthorizedStatus;
  workAuthorizationAttestedAt?: unknown | null;
  employmentI9SectionFlash?: boolean;
  onNavigateToProfileTab?: (tabLabel: string) => void;
  onOpenWorkerNotificationComposer?: (args: {
    channel: 'sms' | 'email';
    body: string;
    subject?: string;
  }) => void;
}

const EmploymentEntityPanel: React.FC<EmploymentEntityPanelProps> = ({
  entityKey,
  overview,
  profileUserId,
  tenantId,
  tenantSlug,
  onRefresh,
  workerDisplayName,
  workAuthorizedStatus,
  workAuthorizationAttestedAt,
  employmentI9SectionFlash = false,
  onNavigateToProfileTab,
  onOpenWorkerNotificationComposer,
}) => {
  const showEmptyExplainer = !overview.entityEmployment && !overview.workerOnboarding;
  const onCallPoolActive = overview.entityEmployment?.employmentEntryMode === 'on_call_pool';

  const actionContext: EmploymentV2ActionResolutionContext = useMemo(() => {
    const entityDisplayName =
      overview.headerEntityName?.trim() ||
      overview.entityEmployment?.entityName?.trim() ||
      null;
    return {
      userId: profileUserId,
      tenantId,
      tenantSlug,
      viewer: 'recruiter',
      workerDisplayName: workerDisplayName?.trim() || null,
      entityDisplayName,
      entityEmploymentFirestoreId: overview.entityEmployment?.id ?? null,
      payrollPortalUrl:
        overview.systems.payroll?.entityOnboardingUrl ||
        overview.systems.payroll?.entityPortalUrl ||
        overview.systems.payroll?.portalUrl ||
        null,
      everifyOnCallLaborPool: onCallPoolActive,
    };
  }, [profileUserId, tenantId, tenantSlug, overview, workerDisplayName, onCallPoolActive]);

  const showChecklist = overview.employmentHeaderState !== 'not_started';

  return (
    <Stack spacing={0}>
      <Box id={EMPLOYMENT_V2_ANCHOR_ONBOARDING} sx={{ scrollMarginTop: 96 }}>
        {showChecklist ? (
          <Card variant="outlined" sx={{ mb: 2 }}>
            <CardHeader
              title="Onboarding checklist"
              titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }}
              sx={{ pb: 1 }}
            />
            <CardContent sx={{ pt: 0, '&:last-child': { pb: 2 } }}>
              <EmploymentMinimalOnboardingChecklist
                entityKey={entityKey}
                overview={overview}
                tenantId={tenantId}
                profileUserId={profileUserId}
                actionContext={actionContext}
                onRefresh={onRefresh}
                workAuthorizedStatus={workAuthorizedStatus}
                workAuthorizationAttestedAt={workAuthorizationAttestedAt}
                employmentI9SectionFlash={employmentI9SectionFlash}
                onNavigateToProfileTab={onNavigateToProfileTab}
                onOpenWorkerNotificationComposer={onOpenWorkerNotificationComposer}
              />
            </CardContent>
          </Card>
        ) : null}

        {/*
        <EmploymentSystemsSummaryCard
          overview={overview}
          tenantId={tenantId}
          profileUserId={profileUserId}
          onPayrollResendComplete={() => onRefresh?.()}
          defaultExpanded={false}
        />
        */}
      </Box>
      {showEmptyExplainer && <EmploymentEmptyStateCard entityKey={entityKey} />}
    </Stack>
  );
};

export default EmploymentEntityPanel;
