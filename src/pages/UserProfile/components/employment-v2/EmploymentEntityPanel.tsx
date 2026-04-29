import React, { useMemo } from 'react';
import { Box, Card, CardContent, CardHeader, Stack } from '@mui/material';
import type { WorkAuthorizedStatus } from '../../../../utils/workAuthorizedDisplay';
import type { EmploymentEntityKey, EmploymentEntityOverview } from './employmentV2Types';
import type { EmploymentV2ActionResolutionContext } from '../../../../utils/employmentBlockerActionMap';
import EmploymentMinimalOnboardingChecklist from './EmploymentMinimalOnboardingChecklist';
import EmploymentEmptyStateCard from './EmploymentEmptyStateCard';
import EmploymentWorkerEmploymentHub from './EmploymentWorkerEmploymentHub';
import EvereeAdminSyncCard from '../../../../components/everee/EvereeAdminSyncCard';
import { EMPLOYMENT_V2_ANCHOR_ONBOARDING } from '../../../../utils/workerReadinessBannerModel';
import { workerEmploymentShouldShowScreeningPointerAlert } from '../../../../utils/workerEmploymentBackgroundsCrossLink';

export type EmploymentEntityPanelViewerKind = 'worker' | 'recruiter';

export interface EmploymentEntityPanelProps {
  entityKey: EmploymentEntityKey;
  overview: EmploymentEntityOverview;
  profileUserId: string;
  tenantId: string;
  tenantSlug?: string;
  /** Profile subject vs hiring team — drives payroll-system CTAs and post-onboarding hub. */
  viewerKind?: EmploymentEntityPanelViewerKind;
  /** When set, worker can jump to Backgrounds from Employment (screening pointer). */
  onNavigateToProfileTab?: (tabLabel: string) => void;
  onRefresh?: () => void;
  workerDisplayName?: string | null;
  workAuthorizedStatus: WorkAuthorizedStatus;
  workAuthorizationAttestedAt?: unknown | null;
  employmentI9SectionFlash?: boolean;
  onOpenWorkerNotificationComposer?: (args: {
    channel: 'sms' | 'email';
    body: string;
    subject?: string;
  }) => void;
  onSendWorkerNotificationDirect?: (args: {
    channel: 'sms' | 'email';
    body: string;
    subject?: string;
  }) => void | Promise<void>;
}

const EmploymentEntityPanel: React.FC<EmploymentEntityPanelProps> = ({
  entityKey,
  overview,
  profileUserId,
  tenantId,
  tenantSlug,
  viewerKind = 'recruiter',
  onNavigateToProfileTab,
  onRefresh,
  workerDisplayName,
  workAuthorizedStatus,
  workAuthorizationAttestedAt,
  employmentI9SectionFlash = false,
  onOpenWorkerNotificationComposer,
  onSendWorkerNotificationDirect,
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
      viewer: viewerKind,
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
  }, [profileUserId, tenantId, tenantSlug, overview, workerDisplayName, onCallPoolActive, viewerKind]);

  const showChecklist = overview.employmentHeaderState !== 'not_started';
  const showWorkerPostOnboardingHub =
    viewerKind === 'worker' && showChecklist && overview.onboardingComplete === true;
  const showScreeningToBackgroundsPointer =
    viewerKind === 'worker' &&
    Boolean(onNavigateToProfileTab) &&
    overview.hasOpenOnboardingDemand &&
    workerEmploymentShouldShowScreeningPointerAlert(overview);

  // Recruiter-only Everee sync surface. Server-side `requireEvereeEnabledEntity`
  // enforces the same gates; we mirror the visibility check here so the card
  // never appears for entities Everee isn't wired to.
  const showEvereeAdminSync =
    viewerKind === 'recruiter' &&
    Boolean(overview.entityEmployment?.entityId) &&
    overview.systems.payroll?.provider === 'everee' &&
    overview.systems.payroll?.evereeEnabled === true;

  return (
    <Stack spacing={0}>
      <Box id={EMPLOYMENT_V2_ANCHOR_ONBOARDING} sx={{ scrollMarginTop: 96 }}>
        {showChecklist ? (
          showWorkerPostOnboardingHub ? (
            <Box sx={{ mb: 2 }}>
              <EmploymentWorkerEmploymentHub
                entityKey={entityKey}
                overview={overview}
                tenantId={tenantId}
                profileUserId={profileUserId}
                onNavigateToProfileTab={onNavigateToProfileTab}
                onRefresh={onRefresh}
                onOpenWorkerNotificationComposer={onOpenWorkerNotificationComposer}
                onSendWorkerNotificationDirect={onSendWorkerNotificationDirect}
              />
            </Box>
          ) : (
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
                  onOpenWorkerNotificationComposer={onOpenWorkerNotificationComposer}
                  onSendWorkerNotificationDirect={onSendWorkerNotificationDirect}
                  showScreeningToBackgroundsPointer={showScreeningToBackgroundsPointer}
                  onNavigateToProfileTab={onNavigateToProfileTab}
                />
              </CardContent>
            </Card>
          )
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

        {showEvereeAdminSync ? (
          <EvereeAdminSyncCard
            tenantId={tenantId}
            entityId={overview.entityEmployment?.entityId ?? null}
            userId={profileUserId}
            workerType={overview.workerType === '1099' ? 'contractor' : 'employee'}
            onSynced={() => onRefresh?.()}
          />
        ) : null}
      </Box>
      {showEmptyExplainer && <EmploymentEmptyStateCard entityKey={entityKey} />}
    </Stack>
  );
};

export default EmploymentEntityPanel;
