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
import SmsIcon from '@mui/icons-material/Sms';
import EmailIcon from '@mui/icons-material/Email';
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
import EvereePayrollSetupEmbed from '../../../../components/everee/EvereePayrollSetupEmbed';
import EvereeMyPayPanel from '../../../../components/everee/EvereeMyPayPanel';
import type { ExternalOnboardingStepKey } from '../../../../types/externalOnboardingSteps';
import EmploymentI9SupportingDocumentsSubsection from '../../../../components/i9SupportingDocuments/EmploymentI9SupportingDocumentsSubsection';
import ProfileTabPointerAlert from '../../../../components/profile/ProfileTabPointerAlert';
import { workerWorkAuthorizationProfileAbsoluteUrl } from '../../../../utils/workerEmploymentWorkerSurface';
import { everifyHrxDisplayLabelForAudit } from '../../../../utils/everifyHrxStatusDisplay';

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

const setEntityEmploymentEverifyOutsideHrx = httpsCallable<
  { tenantId: string; employmentId: string; complete: boolean },
  { success?: boolean }
>(functions, 'setEntityEmploymentEverifyOutsideHrx');

const EV_STATUS_CHIP: Record<string, { label: string; color: 'default' | 'warning' | 'success' | 'error' | 'info' }> = {
  not_started: { label: 'Not started', color: 'default' },
  in_progress: { label: 'Pending', color: 'info' },
  completed: { label: 'Completed', color: 'success' },
  /** Neutral / closed-without-auth outcomes — label comes from `row.statusDisplay` / case line. */
  satisfied_by_existing_record: { label: 'Closed', color: 'info' },
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
  /** Worker self + screening open → one-line jump to Backgrounds (no duplicated checklist). */
  showScreeningToBackgroundsPointer?: boolean;
  onNavigateToProfileTab?: (tabLabel: string) => void;
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
  onOpenWorkerNotificationComposer,
  onSendWorkerNotificationDirect,
  showScreeningToBackgroundsPointer = false,
  onNavigateToProfileTab,
}) => {
  const theme = useTheme();
  const [payrollBusy, setPayrollBusy] = useState(false);
  const [payrollErr, setPayrollErr] = useState<string | null>(null);
  const [evereeEmbedOpen, setEvereeEmbedOpen] = useState(false);
  const [evereeMyPayOpen, setEvereeMyPayOpen] = useState(false);

  const { systems } = overview;
  const historical = !overview.hasOpenOnboardingDemand;
  const hiringEntityId = overview.entityEmployment?.entityId?.trim() || '';
  const payrollLinksConfigured = Boolean(
    systems.payroll?.entityOnboardingUrl || systems.payroll?.entityPortalUrl || systems.payroll?.portalUrl
  );
  const entityOnboardingComplete = overview.onboardingComplete === true;
  /**
   * Everee embed supersedes the static "Resend payroll setup" path once the
   * entity is flagged — surfaces a one-tap "Complete payroll setup" that opens
   * the Everee iframe with a fresh, ephemeral session.
   */
  const evereePayrollEnabled =
    systems.payroll?.evereeEnabled === true && systems.payroll?.provider === 'everee';
  const evereeWorkerType: 'employee' | 'contractor' =
    overview.workerType === '1099' ? 'contractor' : 'employee';
  const showEvereeEmbedLaunch =
    !historical &&
    !entityOnboardingComplete &&
    evereePayrollEnabled &&
    Boolean(hiringEntityId && tenantId && profileUserId);
  /**
   * "View my pay" is the peer of the onboarding embed — surfaces once the
   * worker's Everee onboarding is settled (mirrored onto the entity
   * `onboardingComplete` flag by the webhook), or historically when we're
   * viewing a past employment. We never require recruiter-level role here;
   * the backend callable enforces `canSelfOrManageEveree`.
   */
  const showEvereeMyPay =
    evereePayrollEnabled &&
    (entityOnboardingComplete || historical) &&
    Boolean(hiringEntityId && tenantId && profileUserId);
  const showPayrollResend =
    !historical &&
    !entityOnboardingComplete &&
    !evereePayrollEnabled &&
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
      setPayrollErr(formatFirebaseHttpsError(e) || 'Could not resend payroll invite');
    } finally {
      setPayrollBusy(false);
    }
  };

  const workAuthItem = buildWorkAuthorizationChecklistItem(workAuthorizedStatus, workAuthorizationAttestedAt);
  const [workAuthRemindBusy, setWorkAuthRemindBusy] = useState<false | 'sms' | 'email'>(false);
  const [workAuthRemindErr, setWorkAuthRemindErr] = useState<string | null>(null);

  const sendWorkAuthorizationReminder = useCallback(
    async (channel: 'sms' | 'email') => {
      if (!onSendWorkerNotificationDirect) return;
      setWorkAuthRemindErr(null);
      setWorkAuthRemindBusy(channel);
      try {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const url = workerWorkAuthorizationProfileAbsoluteUrl(origin);
        const label = (overview.headerEntityName || actionContext.entityDisplayName || '').trim();
        const prefix = label ? `${label}: ` : '';
        const body =
          channel === 'sms'
            ? `${prefix}Please complete your work authorization in your HRX profile (required for hiring): ${url}`
            : `${prefix}Please complete your work authorization in your HRX profile (required for hiring).\n\n${url}`;
        await onSendWorkerNotificationDirect({
          channel,
          body,
          subject: 'Reminder: complete your work authorization',
        });
      } catch (e: unknown) {
        setWorkAuthRemindErr(e instanceof Error ? e.message : 'Send failed.');
      } finally {
        setWorkAuthRemindBusy(false);
      }
    },
    [onSendWorkerNotificationDirect, overview.headerEntityName, actionContext.entityDisplayName],
  );

  const showWorkAuthRemindActions =
    actionContext.viewer === 'recruiter' && !workAuthItem.completed && Boolean(onSendWorkerNotificationDirect);

  const { i9, w4OrW9 } = buildTaxIdentityChecklistItems(overview);
  const { handbook, policies } = buildHandbookPoliciesItems(overview);
  const directDeposit = buildDirectDepositItem(overview);

  const showI9 = overview.workerType !== '1099';
  const taxExternalStepKey: ExternalOnboardingStepKey =
    overview.workerType === '1099' ? 'contractor_tax_form_w9' : 'tax_withholding_forms';
  /** Recruiter can mark externally linked HRIS steps complete (same gate for tax, handbook, policies, DD). */
  const showManualExternalStepVerify = actionContext.viewer === 'recruiter' && !historical;
  const showEverify =
    entityKey === 'select' &&
    overview.systems.everify?.applicable !== false &&
    overview.entityEmployment?.everifyRequired !== false;

  const everifyRow = showEverify ? findEverifyRow(overview.onboardingChecklistGroups) : null;
  const evChipBase = everifyRow
    ? EV_STATUS_CHIP[everifyRow.status] || { label: everifyRow.statusLabel || '—', color: 'default' as const }
    : null;
  /** Prefer the human E-Verify case line over generic row-status words like “Completed”. */
  const evChip =
    everifyRow && evChipBase
      ? {
          label: (everifyRow.statusLabel && everifyRow.statusLabel.trim()) || evChipBase.label,
          color: evChipBase.color,
        }
      : null;

  const eVerifyPipelineStep = (overview.workerOnboarding?.steps || []).find(
    (s) => String(s.id || '') === 'e_verify',
  );
  const eVerifyPipelineComplete = ['complete', 'completed'].includes(
    String(eVerifyPipelineStep?.status || '').toLowerCase(),
  );
  const pipelineId = `${profileUserId}__${entityKey}`;

  const entityEverifyStatus = String(overview.entityEmployment?.everifyStatus || '').toLowerCase();
  const employmentAuthorizedInHrx = entityEverifyStatus === 'employment_authorized';
  const manualOutsideHrx = entityEverifyStatus === 'manual_outside_hrx';
  const employmentIdForEverify = overview.entityEmployment?.id?.trim() || '';
  /**
   * Manual "E-Verify completed outside HRX" must not be tied to `showManualExternalStepVerify` / `historical`.
   * When `hasOpenOnboardingDemand` is false, `historical` is true and other external-verify rows hide — but recruiters
   * still need to mark E-Verify done outside the system (same as `setEntityEmploymentEverifyOutsideHrx` callable).
   */
  const showEverifyManualComplete =
    showEverify &&
    actionContext.viewer === 'recruiter' &&
    Boolean(employmentIdForEverify) &&
    !employmentAuthorizedInHrx;

  const [everifyManualBusy, setEverifyManualBusy] = useState(false);
  const [everifyManualErr, setEverifyManualErr] = useState<string | null>(null);
  /** Until parent refetch runs, keep checkbox aligned with the last user intent. */
  const [everifyOptimisticChecked, setEverifyOptimisticChecked] = useState<boolean | null>(null);

  useEffect(() => {
    setEverifyOptimisticChecked(null);
  }, [eVerifyPipelineComplete, manualOutsideHrx]);

  const eVerifyCheckboxChecked =
    everifyOptimisticChecked !== null
      ? everifyOptimisticChecked
      : eVerifyPipelineComplete || manualOutsideHrx;

  const handleEverifyManualToggle = useCallback(
    async (nextChecked: boolean) => {
      if (!tenantId || !showEverifyManualComplete) return;
      const eid = overview.entityEmployment?.id?.trim();
      if (!eid) return;
      if (!nextChecked) {
        const ok = window.confirm(
          overview.workerOnboarding
            ? 'Clear manual E-Verify completion? This removes the outside-HRX mark and resets the pipeline step to Not started.'
            : 'Clear manual E-Verify completion? This removes the outside-HRX mark from the employment record.',
        );
        if (!ok) return;
      }
      setEverifyOptimisticChecked(nextChecked);
      setEverifyManualBusy(true);
      setEverifyManualErr(null);
      try {
        if (overview.workerOnboarding) {
          await updateWorkerOnboardingStepStatus({
            tenantId,
            pipelineId,
            stepId: 'e_verify',
            status: nextChecked ? 'complete' : 'not_started',
          });
        } else {
          await setEntityEmploymentEverifyOutsideHrx({
            tenantId,
            employmentId: eid,
            complete: nextChecked,
          });
        }
        onRefresh?.();
      } catch (e: unknown) {
        setEverifyOptimisticChecked(null);
        setEverifyManualErr(formatFirebaseHttpsError(e) || 'Could not update E-Verify step.');
      } finally {
        setEverifyManualBusy(false);
      }
    },
    [tenantId, showEverifyManualComplete, pipelineId, onRefresh, overview.workerOnboarding, overview.entityEmployment?.id],
  );

  return (
    <Stack
      divider={<Divider flexItem sx={{ borderColor: 'divider', opacity: 0.9 }} />}
      spacing={2}
      sx={{ mt: 0 }}
    >
      <ChecklistSection title="Payroll setup">
        <Stack spacing={1.25}>
          {showEvereeEmbedLaunch ? (
            <Button
              variant="contained"
              size="small"
              onClick={() => setEvereeEmbedOpen(true)}
              sx={{ textTransform: 'none', alignSelf: 'flex-start' }}
            >
              Complete payroll setup
            </Button>
          ) : null}
          {showEvereeMyPay ? (
            <Button
              variant="outlined"
              size="small"
              onClick={() => setEvereeMyPayOpen(true)}
              sx={{ textTransform: 'none', alignSelf: 'flex-start' }}
            >
              View my pay
            </Button>
          ) : null}
          {showPayrollResend ? (
            <Button
              variant="contained"
              size="small"
              disabled={payrollBusy}
              onClick={() => void handlePayrollResend()}
              sx={{ textTransform: 'none', alignSelf: 'flex-start' }}
            >
              {payrollBusy ? 'Sending…' : 'Resend payroll setup'}
            </Button>
          ) : null}
          {payrollErr ? (
            <Typography variant="caption" color="error" display="block">
              {payrollErr}
            </Typography>
          ) : null}
          {!showEvereeEmbedLaunch ? (
            <Typography variant="caption" color="text.secondary" display="block">
              {lastInviteSent ? `Last sent: ${formatChecklistTimestamp(lastInviteSent)}` : 'Last sent: —'}
            </Typography>
          ) : null}
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
        {showScreeningToBackgroundsPointer && onNavigateToProfileTab ? (
          <Box sx={{ mb: 1.5 }}>
            <ProfileTabPointerAlert
              message="You have screening steps to complete. Go to Backgrounds & compliance."
              onNavigate={() => onNavigateToProfileTab('Backgrounds')}
            />
          </Box>
        ) : null}
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
          {showWorkAuthRemindActions ? (
            <Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                <Tooltip title="Sends an SMS to the phone number on the worker’s profile. Opens their Work authorization page when they tap the link.">
                  <span>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<SmsIcon />}
                      disabled={workAuthRemindBusy !== false}
                      onClick={() => void sendWorkAuthorizationReminder('sms')}
                    >
                      {workAuthRemindBusy === 'sms' ? 'Sending…' : 'Send reminder (SMS)'}
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title="Sends email to the address on the worker’s profile with the same link.">
                  <span>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<EmailIcon />}
                      disabled={workAuthRemindBusy !== false}
                      onClick={() => void sendWorkAuthorizationReminder('email')}
                    >
                      {workAuthRemindBusy === 'email' ? 'Sending…' : 'Send reminder (email)'}
                    </Button>
                  </span>
                </Tooltip>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block', lineHeight: 1.45 }}>
                SMS and email use the phone and address on the worker’s profile and include a link to Work authorization.
                One-off push from here is not wired — use SMS or email.
              </Typography>
              {workAuthRemindErr ? (
                <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>
                  {workAuthRemindErr}
                </Typography>
              ) : null}
            </Box>
          ) : null}
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
            employmentEntityKey={entityKey}
            workerEmploymentRecordId={overview.entityEmployment?.id?.trim() || null}
            hiringEntityDisplayName={overview.headerEntityName?.trim() || undefined}
            onRefresh={onRefresh}
            onOpenWorkerNotificationComposer={onOpenWorkerNotificationComposer}
            onSendWorkerNotificationDirect={onSendWorkerNotificationDirect}
            i9EmployeeSectionComplete={i9.completed}
            i9SupportingManualComplete={Boolean(overview.entityEmployment?.i9SupportingDocumentsManualCompleteAt)}
            showI9SupportingManualToggle={Boolean(showManualExternalStepVerify && !i9.completed)}
            employmentRecordId={overview.entityEmployment?.id?.trim() || null}
            onManualI9SupportingComplete={onRefresh}
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
          {showEverify && overview.everifyCaseBriefs.length > 0 ? (
            <Box
              sx={{
                mt: 1.25,
                pt: 1.25,
                borderTop: 1,
                borderColor: 'divider',
                width: '100%',
              }}
            >
              <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 0.75 }}>
                E-Verify case audit
              </Typography>
              <Stack spacing={1.5}>
                {overview.everifyCaseBriefs.map((b, idx) => (
                  <Box key={b.caseId}>
                    {idx > 0 ? <Divider sx={{ mb: 1.5 }} /> : null}
                    <Stack spacing={0.35}>
                      <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.4 }}>
                        {b.everifyCaseNumber ? `E-Verify case ${b.everifyCaseNumber}` : `Case record ${b.caseId}`}
                      </Typography>
                      {b.hrxStatus ? (
                        <Typography variant="caption" color="text.secondary" component="div">
                          HRX status: {everifyHrxDisplayLabelForAudit(b.hrxStatus)}
                        </Typography>
                      ) : null}
                      {b.statusDisplay ? (
                        <Typography variant="caption" color="text.secondary" component="div">
                          ICA response: {b.statusDisplay}
                        </Typography>
                      ) : null}
                      {b.submittedAt ? (
                        <Typography variant="caption" color="text.secondary" component="div">
                          Submitted {formatChecklistTimestamp(b.submittedAt)}
                        </Typography>
                      ) : null}
                      {b.lastCheckedAt ? (
                        <Typography variant="caption" color="text.secondary" component="div">
                          Last checked {formatChecklistTimestamp(b.lastCheckedAt)}
                        </Typography>
                      ) : null}
                      {!b.lastCheckedAt && b.updatedAt ? (
                        <Typography variant="caption" color="text.secondary" component="div">
                          Record updated {formatChecklistTimestamp(b.updatedAt)}
                        </Typography>
                      ) : null}
                      {b.eligibilityStatement ? (
                        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
                          Eligibility: {b.eligibilityStatement}
                        </Typography>
                      ) : null}
                      {b.rawSsaReferralStatus || b.rawDhsReferralStatus || b.rawDhsReferralDueDate ? (
                        <Typography variant="caption" color="text.secondary" component="div">
                          {[
                            b.rawSsaReferralStatus ? `SSA referral: ${b.rawSsaReferralStatus}` : null,
                            b.rawDhsReferralStatus ? `DHS referral: ${b.rawDhsReferralStatus}` : null,
                            b.rawDhsReferralDueDate ? `DHS due: ${b.rawDhsReferralDueDate}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Typography>
                      ) : null}
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </Box>
          ) : null}
          {showEverifyManualComplete ? (
            <Box sx={{ mt: 1.25, pt: 1.25, borderTop: 1, borderColor: 'divider' }}>
              <Stack direction="row" alignItems="center" gap={0.5} sx={{ mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  Manual confirmation
                </Typography>
                <Tooltip
                  title="Use when E-Verify was completed outside HRX (another system or vendor). Updates the employment record for reporting; when a worker onboarding pipeline exists, also marks the E-Verify step complete."
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
                        E-Verify completed outside HRX
                      </Box>
                    ) : (
                      'E-Verify completed outside HRX'
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

      {showEvereeEmbedLaunch ? (
        <EvereePayrollSetupEmbed
          open={evereeEmbedOpen}
          onClose={() => setEvereeEmbedOpen(false)}
          tenantId={tenantId}
          entityId={hiringEntityId}
          userId={profileUserId}
          workerType={evereeWorkerType}
          onComplete={onRefresh}
        />
      ) : null}
      {showEvereeMyPay ? (
        <EvereeMyPayPanel
          open={evereeMyPayOpen}
          onClose={() => setEvereeMyPayOpen(false)}
          tenantId={tenantId}
          entityId={hiringEntityId}
          userId={profileUserId}
        />
      ) : null}
    </Stack>
  );
};

export default EmploymentMinimalOnboardingChecklist;
