/**
 * Payroll page banners for step 5 (2026-09-11):
 *  - PendingClaimBanner: the worker left a shift to finish setup ("Finish
 *    setup to claim") — once payroll is ready at that entity, "Back to your
 *    shift" reopens the claim sheet for it.
 *  - EventsAppliedBanner: just applied to a C1 Events posting
 *    (`?welcome=events&applicationId=`) — payroll first, interview optional.
 * Flutter twin: the payroll screen banners in c1_app.
 */
import React, { useEffect, useState } from 'react';
import { Alert, AlertTitle, Button } from '@mui/material';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { t } from '../../i18n';
import { useAuth } from '../../contexts/AuthContext';
import { useClaimReadiness } from '../../hooks/useClaimReadiness';
import { buildClaimReturnPath, clearPendingClaim, loadPendingClaim } from '../../utils/claimShift/pendingClaim';

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
  const { user } = useAuth();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const applicationId = params.get('welcome') === 'events' ? params.get('applicationId') : null;
  const [interviewed, setInterviewed] = useState<boolean | null>(null);

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

  if (!applicationId || !user?.uid) return null;
  return (
    <Alert
      severity="success"
      sx={{ mb: 2 }}
      action={
        interviewed === false ? (
          <Button
            color="inherit"
            size="small"
            component={Link}
            to={`/c1/workers/prescreen?applicationId=${encodeURIComponent(applicationId)}&entry=post_apply_inline`}
          >
            {t('jobs.takeInterviewCta')}
          </Button>
        ) : undefined
      }
    >
      <AlertTitle sx={{ mb: interviewed === false ? 0.5 : 0 }}>{t('jobs.eventsAppliedPayrollTitle')}</AlertTitle>
      {interviewed === false ? t('jobs.eventsAppliedInterviewHint') : null}
    </Alert>
  );
};
