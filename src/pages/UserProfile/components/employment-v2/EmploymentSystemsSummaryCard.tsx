import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Typography,
  Stack,
  Collapse,
  IconButton,
  Divider,
  Tooltip,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../../firebase';
import type { EmploymentEntityOverview } from './employmentV2Types';
import { assignmentRequirementsSystemsLine } from '../../../../utils/assignmentRequirementsViewModel';
import { useAuth } from '../../../../contexts/AuthContext';
import { canManageEverifyFromClaims } from '../backgroundsComplianceModel';
import { StartEverifySelectDialog, EVERIFY_SELECT_PERM_HINT } from '../StartEverifySelectDialog';

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

export interface EmploymentSystemsSummaryCardProps {
  overview: EmploymentEntityOverview;
  tenantId: string;
  profileUserId: string;
  onPayrollResendComplete?: () => void;
  /**
   * When false, operational detail starts collapsed (on-call pool — checklist first).
   * When true, body is expanded by default for assignment-based onboarding.
   */
  defaultExpanded?: boolean;
  /** Refetch employment overview after a successful E-Verify case create from this card. */
  onEverifyComplete?: () => void;
}

const EmploymentSystemsSummaryCard: React.FC<EmploymentSystemsSummaryCardProps> = ({
  overview,
  tenantId,
  profileUserId,
  onPayrollResendComplete,
  onEverifyComplete,
  defaultExpanded = true,
}) => {
  const [open, setOpen] = useState(defaultExpanded);
  const [everifyDialogOpen, setEverifyDialogOpen] = useState(false);
  const [payrollResendBusy, setPayrollResendBusy] = useState(false);
  const [payrollResendError, setPayrollResendError] = useState<string | null>(null);
  const { isHRX, claimsRoles } = useAuth();
  const canManageEverify = useMemo(
    () => canManageEverifyFromClaims(isHRX, tenantId, claimsRoles),
    [isHRX, tenantId, claimsRoles]
  );
  const { systems } = overview;
  const historical = !overview.hasOpenOnboardingDemand;
  const iaLine = assignmentRequirementsSystemsLine(overview.assignmentRequirementsViewModel);

  const hiringEntityId = overview.entityEmployment?.entityId?.trim() || '';
  const payrollLinksConfigured = Boolean(
    systems.payroll?.entityOnboardingUrl || systems.payroll?.entityPortalUrl || systems.payroll?.portalUrl
  );
  const showPayrollResend =
    !historical &&
    Boolean(systems.payroll && payrollLinksConfigured && hiringEntityId && tenantId && profileUserId);

  const firstAssignmentId = overview.assignments?.[0]?.assignmentId?.trim() || '';
  const resendContextLabel: string | null = firstAssignmentId
    ? null
    : overview.entityEmployment?.employmentEntryMode === 'on_call_pool'
      ? 'your on-call employment'
      : `your employment with ${overview.headerEntityName || 'this company'}`;

  const handlePayrollResend = async () => {
    if (!hiringEntityId || !tenantId || !profileUserId) return;
    setPayrollResendBusy(true);
    setPayrollResendError(null);
    try {
      await resendPayrollInvite({
        tenantId,
        userId: profileUserId,
        entityId: hiringEntityId,
        assignmentId: firstAssignmentId || null,
        contextLabel: resendContextLabel,
      });
      onPayrollResendComplete?.();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setPayrollResendError(err?.message || 'Could not resend payroll invite');
    } finally {
      setPayrollResendBusy(false);
    }
  };

  return (
    <Card sx={{ mb: 2, opacity: 0.95 }}>
      <CardHeader
        title={historical ? 'Systems record (context)' : 'Systems summary'}
        subheader={
          <span>
            {historical
              ? 'Historical context — figures may include completed or cancelled assignment activity; not framed as current required work.'
              : 'Operational detail — not the primary workflow surface.'}
            {iaLine ? (
              <>
                <br />
                <Typography component="span" variant="caption" color="text.secondary">
                  {historical ? 'Snapshot (may include history): ' : 'Job / screening snapshot: '}
                  {iaLine}
                </Typography>
              </>
            ) : null}
          </span>
        }
        titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }}
        action={
          <IconButton aria-label="expand" onClick={() => setOpen((v) => !v)} size="small">
            {open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        }
      />
      <Collapse in={open}>
        <CardContent sx={{ pt: 0 }}>
          <Stack spacing={1.5}>
            {systems.everify && systems.everify.applicable && (
              <Box
                sx={{
                  border: 1,
                  borderColor: 'primary.light',
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  p: 1.5,
                }}
              >
                <Typography variant="subtitle2" fontWeight={600}>
                  E-Verify (Select)
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {systems.everify.statusDisplay} · {systems.everify.caseCount} case(s)
                  {systems.everify.actionNeeded
                    ? historical
                      ? ' · Review if a new assignment starts (not framed as open work here)'
                      : ' · Action may be needed'
                    : ''}
                </Typography>
                <Tooltip title={!canManageEverify ? EVERIFY_SELECT_PERM_HINT : ''}>
                  <span>
                    <Button
                      variant="contained"
                      size="small"
                      disabled={!canManageEverify}
                      onClick={() => setEverifyDialogOpen(true)}
                      sx={{ textTransform: 'none', alignSelf: 'flex-start', mt: 1, display: 'inline-flex' }}
                    >
                      Run E-Verify for employment
                    </Button>
                  </span>
                </Tooltip>
                <StartEverifySelectDialog
                  open={everifyDialogOpen}
                  onClose={() => setEverifyDialogOpen(false)}
                  uid={profileUserId}
                  tenantId={tenantId}
                  onSuccess={() => void onEverifyComplete?.()}
                />
              </Box>
            )}
            {systems.payroll && (
              <>
                <Divider />
                <Box>
                  <Typography variant="subtitle2" fontWeight={600}>
                    Payroll
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {historical ? 'Context: ' : ''}
                    {systems.payroll.statusDisplay}
                    {systems.payroll.entityOnboardingUrl || systems.payroll.entityPortalUrl || systems.payroll.portalUrl
                      ? ' · Links configured'
                      : ''}
                  </Typography>
                  {(systems.payroll.entityOnboardingUrl || systems.payroll.entityPortalUrl) && (
                    <Stack component="ul" sx={{ m: 0, pl: 2, mt: 0.5 }} spacing={0.25}>
                      {systems.payroll.entityOnboardingUrl ? (
                        <Typography component="li" variant="caption" color="text.secondary">
                          Onboarding URL set (first-time setup)
                        </Typography>
                      ) : null}
                      {systems.payroll.entityPortalUrl ? (
                        <Typography component="li" variant="caption" color="text.secondary">
                          Portal URL set (login / pay history)
                        </Typography>
                      ) : null}
                    </Stack>
                  )}
                  {showPayrollResend ? (
                    <Stack spacing={0.5} sx={{ mt: 1 }}>
                      <Button
                        variant="outlined"
                        size="small"
                        disabled={payrollResendBusy}
                        onClick={() => void handlePayrollResend()}
                        sx={{ textTransform: 'none', alignSelf: 'flex-start' }}
                      >
                        {payrollResendBusy ? 'Sending…' : 'Resend payroll invite'}
                      </Button>
                      {payrollResendError ? (
                        <Typography variant="caption" color="error">
                          {payrollResendError}
                        </Typography>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          Same payroll message type and channel rules as automation. New sends appear under Messages and
                          in Employment timelines.
                        </Typography>
                      )}
                    </Stack>
                  ) : null}
                </Box>
              </>
            )}
            {systems.screenings && (
              <>
                <Divider />
                <Box>
                  <Typography variant="subtitle2" fontWeight={600}>
                    Screenings
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {historical ? 'Record: ' : ''}
                    {systems.screenings.statusDisplay}
                  </Typography>
                </Box>
              </>
            )}
            {systems.documents && systems.documents.applicable && (
              <>
                <Divider />
                <Box>
                  <Typography variant="subtitle2" fontWeight={600}>
                    Documents (e-sign)
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {historical ? 'On file: ' : ''}Signed {systems.documents.signedCount} · Pending{' '}
                    {systems.documents.pendingCount}
                  </Typography>
                </Box>
              </>
            )}
          </Stack>
        </CardContent>
      </Collapse>
    </Card>
  );
};

export default EmploymentSystemsSummaryCard;
