import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../../firebase';
import { formatFirebaseHttpsError } from '../../../../utils/firebaseHttpsErrors';
import type { EmploymentEntityKey, EmploymentEntityOverview, EmploymentOnboardingRow } from './employmentV2Types';
import type { EmploymentV2ActionResolutionContext } from '../../../../utils/employmentBlockerActionMap';
import { employmentOnboardingEverifyRowElementId } from '../../../../utils/employmentOnboardingPath';
import { EMPLOYMENT_I9_SECTION_ELEMENT_ID } from '../../../../utils/workerReadinessBannerModel';
import type { WorkAuthorizedStatus } from '../../../../utils/workAuthorizedDisplay';
import {
  buildDirectDepositItem,
  buildHandbookPoliciesItems,
  buildTaxIdentityChecklistItems,
  buildWorkAuthorizationChecklistItem,
  formatChecklistTimestamp,
  resolvePayrollInviteLastSentAt,
} from '../../../../utils/employmentMinimalChecklistModel';
import { EmploymentOnboardingPathRowAction } from './EmploymentOnboardingPathRowAction';
import ExternalOnboardingVerificationControls from './ExternalOnboardingVerificationControls';
import type { ExternalOnboardingStepKey } from '../../../../types/externalOnboardingSteps';
import EmploymentI9SupportingDocumentsSubsection from '../../../../components/i9SupportingDocuments/EmploymentI9SupportingDocumentsSubsection';

const resendPayrollInvite = httpsCallable<
  {
    tenantId: string;
    userId: string;
    entityId: string;
    assignmentId?: string | null;
    contextLabel?: string | null;
  },
  { ok: boolean; messageLogId?: string | null; correlationKey?: string }
>(functions, 'resendPayrollOnboardingInvite');

const updateWorkerOnboardingStepStatus = httpsCallable<
  { tenantId: string; pipelineId: string; stepId: string; status: string },
  { success?: boolean }
>(functions, 'updateWorkerOnboardingStepStatus');

const EV_STATUS_CHIP: Record<string, { label: string; color: 'default' | 'warning' | 'success' | 'error' | 'info' }> = {
  not_started: { label: 'Not started', color: 'default' },
  in_progress: { label: 'Pending', color: 'info' },
  completed: { label: 'Completed', color: 'success' },
  satisfied_by_existing_record: { label: 'Completed', color: 'success' },
  not_required: { label: 'N/A', color: 'default' },
  error: { label: 'Error', color: 'error' },
};

function findEverifyRow(groups: EmploymentEntityOverview['onboardingChecklistGroups']): EmploymentOnboardingRow | null {
  for (const g of groups) {
    for (const r of g.rows) {
      if (r.sourceType === 'everify') return r;
      if (typeof r.stepKey === 'string' && r.stepKey.startsWith('everify_')) return r;
    }
  }
  return null;
}

function ChecklistLine(props: {
  label: string;
  secondaryLine?: string;
  item: { completed: boolean; completedAt?: Date | null };
}) {
  const { label, secondaryLine, item } = props;
  const ts = item.completed && item.completedAt ? formatChecklistTimestamp(item.completedAt) : '';
  return (
    <FormControlLabel
      control={<Checkbox size="small" checked={item.completed} disabled disableRipple sx={{ py: 0 }} />}
      label={
        <Box sx={{ pt: 0.25 }}>
          <Typography
            variant="body2"
            component="span"
            sx={{ lineHeight: 1.4, fontWeight: secondaryLine ? 600 : 400 }}
          >
            {label}
          </Typography>
          {secondaryLine ? (
            <Typography variant="body2" component="div" sx={{ mt: 0.35, lineHeight: 1.45, fontWeight: 400 }}>
              {secondaryLine}
            </Typography>
          ) : null}
          {ts ? (
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.35, display: 'block' }}>
              {ts}
            </Typography>
          ) : null}
        </Box>
      }
      sx={{ alignItems: 'flex-start', ml: 0, mr: 0, my: 0, '& .MuiFormControlLabel-label': { pt: 0 } }}
    />
  );
}

function ChecklistSection(props: { title: React.ReactNode; children: React.ReactNode }) {
  const { title, children } = props;
  return (
    <Box component="section" sx={{ py: 0.25 }}>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, color: 'text.primary' }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

export interface EmploymentMinimalOnboardingChecklistProps {
  entityKey: EmploymentEntityKey;
  overview: EmploymentEntityOverview;
  tenantId: string;
  profileUserId: string;
  actionContext: EmploymentV2ActionResolutionContext;
  onRefresh?: () => void;
  /** From `users.{uid}` — same source as Overview → Work Eligibility. */
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

const EmploymentMinimalOnboardingChecklist: React.FC<EmploymentMinimalOnboardingChecklistProps> = ({
  entityKey,
  overview,
  tenantId,
  profileUserId,
  actionContext,
  onRefresh,
  workAuthorizedStatus,
  workAuthorizationAttestedAt,
  employmentI9SectionFlash = false,
  onNavigateToProfileTab,
  onOpenWorkerNotificationComposer,
}) => {
  const theme = useTheme();
  const [payrollBusy, setPayrollBusy] = useState(false);
  const [payrollErr, setPayrollErr] = useState<string | null>(null);

  const { systems } = overview;
  const historical = !overview.hasOpenOnboardingDemand;
  const hiringEntityId = overview.entityEmployment?.entityId?.trim() || '';
  const payrollLinksConfigured = Boolean(
    systems.payroll?.entityOnboardingUrl || systems.payroll?.entityPortalUrl || systems.payroll?.portalUrl
  );
  const entityOnboardingComplete = overview.onboardingComplete === true;
  const showPayrollResend =
    !historical &&
    !entityOnboardingComplete &&
    Boolean(systems.payroll && payrollLinksConfigured && hiringEntityId && tenantId && profileUserId);

  const firstAssignmentId = overview.assignments?.[0]?.assignmentId?.trim() || '';
  const resendContextLabel: string | null = firstAssignmentId
    ? null
    : overview.entityEmployment?.employmentEntryMode === 'on_call_pool'
      ? 'your on-call employment'
      : `your employment with ${overview.headerEntityName || 'this company'}`;

  const lastInviteSent = resolvePayrollInviteLastSentAt(overview);

  const handlePayrollResend = async () => {
    if (!hiringEntityId || !tenantId || !profileUserId) return;
    setPayrollBusy(true);
    setPayrollErr(null);
    try {
      await resendPayrollInvite({
        tenantId,
        userId: profileUserId,
        entityId: hiringEntityId,
        assignmentId: firstAssignmentId || null,
        contextLabel: resendContextLabel,
      });
      onRefresh?.();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setPayrollErr(err?.message || 'Could not resend payroll invite');
    } finally {
      setPayrollBusy(false);
    }
  };

  const workAuthItem = buildWorkAuthorizationChecklistItem(workAuthorizedStatus, workAuthorizationAttestedAt);
  const { i9, w4OrW9 } = buildTaxIdentityChecklistItems(overview);
  const { handbook, policies } = buildHandbookPoliciesItems(overview);
  const directDeposit = buildDirectDepositItem(overview);

  const showI9 = overview.workerType !== '1099';
  const taxExternalStepKey: ExternalOnboardingStepKey =
    overview.workerType === '1099' ? 'contractor_tax_form_w9' : 'tax_withholding_forms';
  /** Recruiter can mark TempWorks-linked external steps complete (same gate for tax, handbook, policies, DD). */
  const showManualExternalStepVerify = actionContext.viewer === 'recruiter' && !historical;
  const showEverify =
    entityKey === 'select' &&
    overview.systems.everify?.applicable !== false &&
    overview.entityEmployment?.everifyRequired !== false;

  const everifyRow = showEverify ? findEverifyRow(overview.onboardingChecklistGroups) : null;
  const evChip = everifyRow ? EV_STATUS_CHIP[everifyRow.status] || { label: everifyRow.statusLabel || '—', color: 'default' as const } : null;

  const eVerifyPipelineStep = (overview.workerOnboarding?.steps || []).find(
    (s) => String(s.id || '') === 'e_verify',
  );
  const eVerifyPipelineComplete = ['complete', 'completed'].includes(
    String(eVerifyPipelineStep?.status || '').toLowerCase(),
  );
  const pipelineId = `${profileUserId}__${entityKey}`;

  const entityEverifyEmploymentDone = ['employment_authorized', 'manual_outside_hrx'].includes(
    String(overview.entityEmployment?.everifyStatus || '').toLowerCase(),
  );
  const everifyRowStatus = String(everifyRow?.status || '').toLowerCase();
  const everifyRowShowsComplete = ['completed', 'satisfied_by_existing_record', 'not_required'].includes(
    everifyRowStatus,
  );
  /** Hide “C1 completed” manual control when E-Verify is already satisfied via case, pipeline, or employment record. */
  const everifyAlreadySatisfied = everifyRowShowsComplete || eVerifyPipelineComplete || entityEverifyEmploymentDone;

  const showEverifyManualComplete =
    showEverify && showManualExternalStepVerify && Boolean(overview.workerOnboarding) && !everifyAlreadySatisfied;

  const [everifyManualBusy, setEverifyManualBusy] = useState(false);
  const [everifyManualErr, setEverifyManualErr] = useState<string | null>(null);
  /** Until parent refetch runs, keep checkbox aligned with the last user intent. */
  const [everifyOptimisticChecked, setEverifyOptimisticChecked] = useState<boolean | null>(null);

  useEffect(() => {
    setEverifyOptimisticChecked(null);
  }, [eVerifyPipelineComplete]);

  const eVerifyCheckboxChecked =
    everifyOptimisticChecked !== null ? everifyOptimisticChecked : eVerifyPipelineComplete;

  const handleEverifyManualToggle = useCallback(
    async (nextChecked: boolean) => {
      if (!tenantId || !showEverifyManualComplete) return;
      if (!nextChecked) {
        const ok = window.confirm(
          'Clear manual E-Verify completion? This removes the “C1 completed” mark and resets the pipeline step to Not started.',
        );
        if (!ok) return;
      }
      setEverifyOptimisticChecked(nextChecked);
      setEverifyManualBusy(true);
      setEverifyManualErr(null);
      try {
        await updateWorkerOnboardingStepStatus({
          tenantId,
          pipelineId,
          stepId: 'e_verify',
          status: nextChecked ? 'complete' : 'not_started',
        });
        onRefresh?.();
      } catch (e: unknown) {
        setEverifyOptimisticChecked(null);
        setEverifyManualErr(formatFirebaseHttpsError(e) || 'Could not update E-Verify step.');
      } finally {
        setEverifyManualBusy(false);
      }
    },
    [tenantId, showEverifyManualComplete, pipelineId, onRefresh],
  );

  return (
    <Stack
      divider={<Divider flexItem sx={{ borderColor: 'divider', opacity: 0.9 }} />}
      spacing={2}
      sx={{ mt: 0 }}
    >
      <ChecklistSection title="Payroll setup">
        <Stack spacing={1}>
          {showPayrollResend ? (
            <Button
              variant="contained"
              size="small"
              disabled={payrollBusy}
              onClick={() => void handlePayrollResend()}
              sx={{ textTransform: 'none', alignSelf: 'flex-start' }}
            >
              {payrollBusy ? 'Sending…' : 'Resend payroll invite'}
            </Button>
          ) : null}
          {payrollErr ? (
            <Typography variant="caption" color="error" display="block">
              {payrollErr}
            </Typography>
          ) : null}
          <Typography variant="caption" color="text.secondary" display="block">
            {lastInviteSent ? `Last sent: ${formatChecklistTimestamp(lastInviteSent)}` : 'Last sent: —'}
          </Typography>
        </Stack>
      </ChecklistSection>

      <Box
        id={EMPLOYMENT_I9_SECTION_ELEMENT_ID}
        sx={{
          scrollMarginTop: 96,
          borderRadius: 1,
          px: 0.75,
          py: 0.5,
          mx: -0.75,
          my: -0.5,
          transition: 'background-color 0.45s ease',
          bgcolor: employmentI9SectionFlash
            ? alpha(theme.palette.primary.main, 0.12)
            : 'transparent',
        }}
      >
        <ChecklistSection title="Tax and identity">
        <Stack spacing={1.25}>
          {employmentI9SectionFlash && showI9 && !i9.completed ? (
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              I-9 (Required)
            </Typography>
          ) : null}
          <ChecklistLine
            label="Work Authorization"
            secondaryLine={workAuthItem.detailLine}
            item={{ completed: workAuthItem.completed, completedAt: workAuthItem.completedAt }}
          />
          {showI9 ? (
            showManualExternalStepVerify ? (
              <ExternalOnboardingVerificationControls
                ctx={actionContext}
                entityKey={entityKey}
                stepKey="i9_employee_section"
                workerOnboarding={overview.workerOnboarding ?? undefined}
                onComplete={onRefresh}
                suppress={false}
              />
            ) : (
              <ChecklistLine label="I-9 completed" item={i9} />
            )
          ) : null}
          {showManualExternalStepVerify ? (
            <ExternalOnboardingVerificationControls
              ctx={actionContext}
              entityKey={entityKey}
              stepKey={taxExternalStepKey}
              workerOnboarding={overview.workerOnboarding ?? undefined}
              onComplete={onRefresh}
              suppress={false}
            />
          ) : (
            <ChecklistLine label={`${w4OrW9.taxLabel} completed`} item={w4OrW9} />
          )}
        </Stack>
      </ChecklistSection>

        {showI9 ? (
          <EmploymentI9SupportingDocumentsSubsection
            tenantId={tenantId}
            profileUserId={profileUserId}
            requestedForEntityId={hiringEntityId || null}
            onRefresh={onRefresh}
            onOpenWorkerNotificationComposer={onOpenWorkerNotificationComposer}
            onNavigateToProfileTab={onNavigateToProfileTab}
          />
        ) : null}
      </Box>

      {showEverify ? (
        <ChecklistSection title="E-Verify">
          <Box
            id={employmentOnboardingEverifyRowElementId(entityKey)}
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              alignItems: { xs: 'flex-start', sm: 'center' },
              flexWrap: 'wrap',
              gap: 1.25,
              rowGap: 1,
            }}
          >
            <Chip
              size="small"
              label={
                everifyRow && evChip
                  ? evChip.label
                  : overview.systems.everify?.statusDisplay || 'Not started'
              }
              color={everifyRow && evChip ? evChip.color : 'default'}
              variant="outlined"
            />
            {everifyRow ? (
              <Box sx={{ flexShrink: 0 }}>
                <EmploymentOnboardingPathRowAction
                  row={everifyRow}
                  entityKey={entityKey}
                  ctx={actionContext}
                  onComplete={onRefresh}
                  primaryCta
                />
              </Box>
            ) : null}
          </Box>
          {showEverifyManualComplete ? (
            <Box sx={{ mt: 1.25, pt: 1.25, borderTop: 1, borderColor: 'divider' }}>
              <Stack direction="row" alignItems="center" gap={0.5} sx={{ mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  Manual confirmation
                </Typography>
                <Tooltip
                  title="Use when E-Verify was finished outside HRX (another system or vendor). Marks the pipeline step complete and updates the employment record for reporting."
                  placement="right"
                >
                  <InfoOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary', cursor: 'help' }} />
                </Tooltip>
              </Stack>
              <FormControlLabel
                sx={{ alignItems: 'flex-start', ml: 0, mr: 0 }}
                control={
                  <Checkbox
                    size="small"
                    checked={eVerifyCheckboxChecked}
                    disabled={everifyManualBusy}
                    color={eVerifyCheckboxChecked ? 'success' : 'primary'}
                    onChange={(_, checked) => {
                      void handleEverifyManualToggle(checked);
                    }}
                  />
                }
                label={
                  <Typography variant="body2" color="text.secondary" sx={{ pt: 0.35, lineHeight: 1.45 }}>
                    {eVerifyCheckboxChecked ? (
                      <Box component="span" sx={{ fontWeight: 600, color: 'success.main' }}>
                        C1 completed
                      </Box>
                    ) : (
                      'C1 completed'
                    )}
                  </Typography>
                }
              />
              {everifyManualErr ? (
                <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
                  {everifyManualErr}
                </Typography>
              ) : null}
            </Box>
          ) : null}
        </ChecklistSection>
      ) : null}

      <ChecklistSection title="Handbook and policies">
        <Stack spacing={1.25}>
          {showManualExternalStepVerify ? (
            <ExternalOnboardingVerificationControls
              ctx={actionContext}
              entityKey={entityKey}
              stepKey="handbook_acknowledgment"
              workerOnboarding={overview.workerOnboarding ?? undefined}
              onComplete={onRefresh}
              suppress={false}
            />
          ) : (
            <ChecklistLine label="Handbook signed" item={handbook} />
          )}
          {showManualExternalStepVerify ? (
            <ExternalOnboardingVerificationControls
              ctx={actionContext}
              entityKey={entityKey}
              stepKey="policies_acknowledgment"
              workerOnboarding={overview.workerOnboarding ?? undefined}
              onComplete={onRefresh}
              suppress={false}
            />
          ) : (
            <ChecklistLine label="Policies signed" item={policies} />
          )}
        </Stack>
      </ChecklistSection>

      <ChecklistSection title="Payroll">
        {showManualExternalStepVerify ? (
          <ExternalOnboardingVerificationControls
            ctx={actionContext}
            entityKey={entityKey}
            stepKey="direct_deposit"
            workerOnboarding={overview.workerOnboarding ?? undefined}
            onComplete={onRefresh}
            suppress={false}
          />
        ) : (
          <ChecklistLine label="Direct deposit completed" item={directDeposit} />
        )}
      </ChecklistSection>
    </Stack>
  );
};

export default EmploymentMinimalOnboardingChecklist;
