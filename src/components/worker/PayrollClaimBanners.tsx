/**
 * Payroll page banners for step 5 (2026-09-11):
 *  - PendingClaimBanner: the worker left a shift to finish setup ("Finish
 *    setup to claim") — once payroll is ready at that entity, "Back to your
 *    shift" reopens the claim sheet for it.
 *  - EventsAppliedBanner: just applied to a C1 Events posting
 *    (`?welcome=events&applicationId=`) — the C1 Events setup checklist
 *    (profile photo · direct deposit · 1099 tax form) with a button for what's
 *    left, "You're all set" once it's done; the interview stays optional.
 * Flutter twin: the payroll screen banners in c1_app.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CircularProgress, Stack, Typography } from '@mui/material';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { t } from '../../i18n';
import { useAuth } from '../../contexts/AuthContext';
import { useClaimReadiness } from '../../hooks/useClaimReadiness';
import { C1_EVENTS_ENTITY_ID } from '../../utils/claimShift/claimReadiness';
import { buildClaimReturnPath, clearPendingClaim, loadPendingClaim } from '../../utils/claimShift/pendingClaim';
import { SetupStepList, type SetupStep } from './ClaimSetupCard';

export const PendingClaimBanner: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pending] = useState(() => loadPendingClaim());
  const readiness = useClaimReadiness(pending?.tenantId, pending ? user?.uid : null, pending?.entityId);
  if (!pending || !user?.uid || readiness.loading) return null;
  if (!readiness.payrollReady) {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        {t('jobs.pendingClaimBannerSetup')}
      </Alert>
    );
  }
  return (
    <Alert
      severity="success"
      sx={{ mb: 2 }}
      action={
        <Button
          color="inherit"
          size="small"
          sx={{ fontWeight: 700 }}
          onClick={() => {
            clearPendingClaim();
            navigate(buildClaimReturnPath(pending));
          }}
        >
          {t('jobs.pendingClaimBackCta')}
        </Button>
      }
    >
      {t('jobs.pendingClaimBannerReady')}
    </Alert>
  );
};

export const EventsAppliedBanner: React.FC = () => {
  const { user, tenantId, tenantIds } = useAuth();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const applicationId = params.get('welcome') === 'events' ? params.get('applicationId') : null;
  const [interviewed, setInterviewed] = useState<boolean | null>(null);
  const on = Boolean(applicationId && user?.uid);
  const readiness = useClaimReadiness(
    on ? tenantId || tenantIds[0] : null,
    on ? user?.uid : null,
    on ? C1_EVENTS_ENTITY_ID : null,
  );

  useEffect(() => {
    if (!applicationId || !user?.uid) return;
    let cancelled = false;
    void import('../../utils/quickApplicationSubmit')
      .then(({ hasCompletedPrescreen }) => hasCompletedPrescreen(user.uid))
      .then((done) => {
        if (!cancelled) setInterviewed(done);
      })
      .catch(() => {
        if (!cancelled) setInterviewed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId, user?.uid]);

  if (!applicationId || !user?.uid || readiness.loading) return null;
  const steps: SetupStep[] = [
    { key: 'photo', label: t('jobs.claimSetupStepPhoto'), done: readiness.photoReady },
    { key: 'directDeposit', label: t('jobs.setupStepDirectDeposit'), done: readiness.directDepositReady },
    { key: 'taxForm', label: t('jobs.setupStepTaxForm'), done: readiness.taxFormReady },
  ];
  const allDone = steps.every((s) => s.done);
  const payrollLeft = !readiness.directDepositReady || !readiness.taxFormReady;
  return (
    <Card variant="outlined" sx={{ p: 2, mb: 2, borderColor: 'success.light' }}>
      <Typography variant="subtitle1" fontWeight={700}>
        {allDone ? t('jobs.eventsSetupAllSetTitle') : t('jobs.eventsAppliedPayrollTitle')}
      </Typography>
      {!allDone ? (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('jobs.eventsSetupBody')}
          </Typography>
          <SetupStepList steps={steps} />
        </>
      ) : null}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ mt: 1.5 }}>
        {allDone ? (
          <Button variant="contained" color="success" component={Link} to="/c1/jobs-board" sx={{ fontWeight: 700 }}>
            {t('jobs.eventsSetupFindShiftsCta')}
          </Button>
        ) : null}
        {!readiness.photoReady ? (
          <Button variant="contained" color="success" component={Link} to="/c1/workers/profile" sx={{ fontWeight: 700 }}>
            {t('jobs.eventsSetupPhotoCta')}
          </Button>
        ) : null}
        {payrollLeft && readiness.evereeTenantId ? (
          <Button
            variant={readiness.photoReady ? 'contained' : 'outlined'}
            color="success"
            component={Link}
            to={`/c1/workers/earnings/${encodeURIComponent(readiness.evereeTenantId)}`}
            sx={{ fontWeight: 700 }}
          >
            {t('jobs.eventsSetupPayrollCta')}
          </Button>
        ) : null}
        {payrollLeft && !readiness.evereeTenantId ? (
          // The apply just started C1 Events onboarding; the link lands in seconds.
          <Stack direction="row" spacing={1.5} alignItems="center">
            <CircularProgress size={18} />
            <Box>
              <Typography variant="body2">{t('jobs.eventsPayrollSettingUp')}</Typography>
              <Typography variant="caption" color="text.secondary">
                {t('jobs.eventsPayrollSettingUpHelper')}
              </Typography>
            </Box>
          </Stack>
        ) : null}
      </Stack>
      {interviewed === false ? (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mt: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            {t('jobs.eventsAppliedInterviewHint')}
          </Typography>
          <Button
            size="small"
            component={Link}
            to={`/c1/workers/prescreen?applicationId=${encodeURIComponent(applicationId)}&entry=post_apply_inline`}
          >
            {t('jobs.takeInterviewCta')}
          </Button>
        </Stack>
      ) : null}
    </Card>
  );
};
