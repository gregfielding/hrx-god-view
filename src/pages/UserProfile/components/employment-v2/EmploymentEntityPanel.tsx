import React, { useMemo, useState } from 'react';
import { Alert, Button, Collapse, Stack, Typography } from '@mui/material';
import PersonAddAlt1OutlinedIcon from '@mui/icons-material/PersonAddAlt1Outlined';
import type { EmploymentEntityKey, EmploymentEntityOverview } from './employmentV2Types';
import type { EmploymentV2ActionResolutionContext } from '../../../../utils/employmentBlockerActionMap';
import EmploymentEntityHeaderCard from './EmploymentEntityHeaderCard';
import EmploymentOnboardingPathCard from './EmploymentOnboardingPathCard';
import EmploymentActiveAssignmentRequirementsCard from './EmploymentActiveAssignmentRequirementsCard';
import EmploymentAssignmentsCard from './EmploymentAssignmentsCard';
import EmploymentSystemsSummaryCard from './EmploymentSystemsSummaryCard';
import EmploymentEmptyStateCard from './EmploymentEmptyStateCard';
import StartOnCallEmploymentDialog from './StartOnCallEmploymentDialog';

const ON_CALL_DETAIL_GUIDANCE = (
  <>
    Work Authorization rows often stay on &quot;waiting for TempWorks&quot; until data syncs into HRX or you use
    verification where the product exposes it — there is no separate button on this line. Payroll invites are logged
    under the profile <strong>Messages</strong> tab (use <strong>Resend invite</strong> on the row, or{' '}
    <strong>Resend payroll invite</strong> under Systems summary). If SMS shows failed, check the worker&apos;s phone
    number and carrier deliverability.
  </>
);

export interface EmploymentEntityPanelProps {
  entityKey: EmploymentEntityKey;
  overview: EmploymentEntityOverview;
  profileUserId: string;
  tenantId: string;
  tenantSlug?: string;
  onRefresh?: () => void;
  /** Admin UserProfile: worker’s display name for third-person onboarding copy. */
  workerDisplayName?: string | null;
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
  workerDisplayName,
}) => {
  const [onCallOpen, setOnCallOpen] = useState(false);
  const [onCallLearnMoreOpen, setOnCallLearnMoreOpen] = useState(false);
  const showEmptyExplainer = !overview.entityEmployment && !overview.workerOnboarding;
  const onCallPoolActive = overview.entityEmployment?.employmentEntryMode === 'on_call_pool';
  const showStartOnCallButton = Boolean(allowStartOnCallEmployment && !onCallPoolActive);

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

  return (
    <Stack spacing={0}>
      {allowStartOnCallEmployment && onCallPoolActive ? (
        <Alert severity="info" sx={{ mb: 1 }} variant="outlined">
          <Typography variant="body2" fontWeight={700} sx={{ mb: 0.75 }}>
            On-call onboarding is active. Complete checklist below.
          </Typography>
          <Button
            size="small"
            onClick={() => setOnCallLearnMoreOpen((o) => !o)}
            sx={{ textTransform: 'none', px: 0, minWidth: 0, mb: onCallLearnMoreOpen ? 0.5 : 0 }}
            aria-expanded={onCallLearnMoreOpen}
          >
            {onCallLearnMoreOpen ? 'Hide details' : 'Learn more'}
          </Button>
          <Collapse in={onCallLearnMoreOpen}>
            <Typography variant="body2" color="text.secondary" component="div" sx={{ lineHeight: 1.5, pt: 0.5 }}>
              {ON_CALL_DETAIL_GUIDANCE}
            </Typography>
          </Collapse>
        </Alert>
      ) : null}
      {showStartOnCallButton ? (
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
      <EmploymentSystemsSummaryCard
        overview={overview}
        tenantId={tenantId}
        profileUserId={profileUserId}
        onPayrollResendComplete={() => onRefresh?.()}
        defaultExpanded={!onCallPoolActive}
      />
      <EmploymentAssignmentsCard
        assignments={overview.assignments}
        hasOpenOnboardingDemand={overview.hasOpenOnboardingDemand}
        defaultListExpanded={!onCallPoolActive}
      />
      {showEmptyExplainer && <EmploymentEmptyStateCard entityKey={entityKey} />}
    </Stack>
  );
};

export default EmploymentEntityPanel;
