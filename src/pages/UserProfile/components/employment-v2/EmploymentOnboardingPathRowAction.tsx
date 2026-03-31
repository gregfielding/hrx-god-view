import React, { useCallback, useMemo, useState } from 'react';
import { Button, CircularProgress, Typography } from '@mui/material';
import { httpsCallable } from 'firebase/functions';
import { useNavigate, useLocation } from 'react-router-dom';
import { functions } from '../../../../firebase';
import { useAuth } from '../../../../contexts/AuthContext';
import { canManageEverifyFromClaims } from '../backgroundsComplianceModel';
import {
  resolveEmploymentV2PrimaryAction,
  interpolateEmploymentV2Route,
  type EmploymentV2ActionResolutionContext,
} from '../../../../utils/employmentBlockerActionMap';
import { isOnboardingPathRowBlocker, isOnboardingPathRowDone } from '../../../../utils/employmentOnboardingPath';
import type { EmploymentEntityKey, EmploymentOnboardingRow } from './employmentV2Types';

/** Initial rollout: only these primary actions (see employmentBlockerActionMap). */
const PHASE_1_ACTION_KEYS = new Set([
  'assignment.open_worker_package',
  'assignment.recruiter_open',
  'everify.select.check_eligibility',
  'everify.select.error_retry',
  'everify.select.in_progress',
  'payroll.recruiter_review',
  'background.recruiter_order',
  'background.vendor_in_progress',
  'background.error_recruiter',
]);

const everifyCheckEligibility = httpsCallable(functions, 'everifyCheckEligibility');
const everifyCreateCase = httpsCallable(functions, 'everifyCreateCase');
const everifyRetryCase = httpsCallable(functions, 'everifyRetryCase');

export interface EmploymentOnboardingPathRowActionProps {
  row: EmploymentOnboardingRow;
  entityKey: EmploymentEntityKey;
  ctx: EmploymentV2ActionResolutionContext;
  onComplete?: () => void;
  /** When true, render as a prominent primary button (non-debug path UI). */
  primaryCta?: boolean;
}

export const EmploymentOnboardingPathRowAction: React.FC<EmploymentOnboardingPathRowActionProps> = ({
  row,
  entityKey,
  ctx,
  onComplete,
  primaryCta = false,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isHRX, claimsRoles } = useAuth();
  const [loading, setLoading] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const resolved = useMemo(() => resolveEmploymentV2PrimaryAction(row, ctx), [row, ctx]);
  const phase1 = Boolean(resolved && PHASE_1_ACTION_KEYS.has(resolved.actionKey));

  const canEverify = canManageEverifyFromClaims(isHRX, ctx.tenantId, claimsRoles);

  const runNavigate = useCallback(
    (path: string) => {
      if (!path || path.includes(':/')) return;
      if (path.includes(':')) {
        setInlineError('Missing link data for this action (e.g. employment id).');
        return;
      }
      navigate(path);
    },
    [navigate]
  );

  const openBackgroundsTab = useCallback(() => {
    const params = new URLSearchParams(location.search);
    params.set('employmentFocus', 'Backgrounds');
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: false });
  }, [navigate, location.pathname, location.search]);

  const handleClick = useCallback(async () => {
    if (!resolved || !phase1) return;
    setInlineError(null);

    if (
      resolved.actionKey === 'background.recruiter_order' ||
      resolved.actionKey === 'background.vendor_in_progress' ||
      resolved.actionKey === 'background.error_recruiter'
    ) {
      openBackgroundsTab();
      return;
    }

    if (resolved.actionKey === 'everify.select.in_progress' || resolved.actionKey === 'payroll.recruiter_review') {
      const empParams = new URLSearchParams(location.search);
      empParams.set('employmentFocus', 'Employment');
      navigate({ pathname: location.pathname, search: empParams.toString() }, { replace: false });
      return;
    }

    if (resolved.actionKind === 'navigate' && resolved.target.routeTemplate) {
      const path = interpolateEmploymentV2Route(resolved.target.routeTemplate, {
        uid: ctx.userId,
        assignmentId: row.sourceRef?.assignmentId,
        employmentId: ctx.entityEmploymentFirestoreId || undefined,
        tenantSlug: ctx.tenantSlug,
      });
      runNavigate(path);
      return;
    }

    if (resolved.actionKind === 'callable' && resolved.actionKey.startsWith('everify.')) {
      if (!canEverify || entityKey !== 'select') return;

      const tid = ctx.tenantId;
      const eid = ctx.entityEmploymentFirestoreId || undefined;

      if (resolved.actionKey === 'everify.select.error_retry') {
        const caseId = row.sourceRef?.caseId;
        if (!caseId) {
          setInlineError('No E-Verify case id on this row. Open the Backgrounds tab.');
          return;
        }
        setLoading(true);
        try {
          await everifyRetryCase({ tenantId: tid, caseId, userEmploymentId: eid || undefined });
          onComplete?.();
        } catch (e: unknown) {
          const det =
            e && typeof e === 'object' && 'details' in e
              ? (e as { details?: { message?: string } }).details
              : undefined;
          setInlineError(det?.message || (e instanceof Error ? e.message : 'Retry failed'));
        } finally {
          setLoading(false);
        }
        return;
      }

      if (resolved.actionKey === 'everify.select.check_eligibility') {
        if (!eid) {
          setInlineError(
            ctx.everifyOnCallLaborPool
              ? 'Add or open a Select employment record for this worker before running E-Verify.'
              : 'Link a Select employment record before E-Verify.'
          );
          return;
        }
        setLoading(true);
        try {
          const check = (await everifyCheckEligibility({
            tenantId: tid,
            userEmploymentId: eid,
          })) as { data: { eligible?: boolean; blockingReasons?: string[] } };
          if (!check.data?.eligible) {
            setInlineError((check.data?.blockingReasons || ['Not eligible']).join('. '));
            return;
          }
          await everifyCreateCase({
            tenantId: tid,
            userEmploymentId: eid,
          });
          onComplete?.();
        } catch (e: unknown) {
          const det =
            e && typeof e === 'object' && 'details' in e
              ? (e as { details?: { blockingReasons?: string[] } }).details
              : undefined;
          setInlineError(
            (det?.blockingReasons || [e instanceof Error ? e.message : 'E-Verify failed']).join('. ')
          );
        } finally {
          setLoading(false);
        }
      }
    }
  }, [
    resolved,
    phase1,
    row.sourceRef,
    ctx,
    entityKey,
    canEverify,
    openBackgroundsTab,
    location.pathname,
    location.search,
    navigate,
    runNavigate,
    onComplete,
  ]);

  if (!resolved || !phase1) {
    return null;
  }

  const allowOpenWorkerPackage =
    resolved.actionKey === 'assignment.open_worker_package' && !isOnboardingPathRowDone(row.status);

  if (!isOnboardingPathRowBlocker(row) && !allowOpenWorkerPackage) {
    return null;
  }

  if (
    (resolved.actionKey === 'everify.select.check_eligibility' ||
      resolved.actionKey === 'everify.select.error_retry') &&
    (!canEverify || entityKey !== 'select')
  ) {
    return null;
  }

  const label =
    resolved.actionKey === 'everify.select.check_eligibility'
      ? ctx.everifyOnCallLaborPool
        ? 'Run E-Verify for employment'
        : 'Run E-Verify'
      : resolved.actionKey === 'everify.select.error_retry'
        ? 'Retry E-Verify'
        : resolved.actionKey === 'everify.select.in_progress'
          ? 'Open E-Verify status'
          : resolved.actionKey === 'payroll.recruiter_review'
            ? 'Review payroll setup'
            : resolved.actionKey.startsWith('background.')
          ? resolved.actionKey === 'background.recruiter_order'
            ? 'Order screening'
            : resolved.actionKey === 'background.error_recruiter'
              ? 'Review screening'
              : 'View screening'
          : resolved.actionLabel;

  const evDisabled =
    resolved.actionKey === 'everify.select.check_eligibility' && !ctx.entityEmploymentFirestoreId;
  const evRetryDisabled = resolved.actionKey === 'everify.select.error_retry' && !row.sourceRef?.caseId;

  return (
    <BoxActionFooter
      label={label}
      loading={loading}
      disabled={loading || evDisabled || evRetryDisabled}
      onClick={handleClick}
      inlineError={inlineError}
      primaryCta={primaryCta}
    />
  );
};

function BoxActionFooter(props: {
  label: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
  inlineError: string | null;
  primaryCta: boolean;
}) {
  const { label, loading, disabled, onClick, inlineError, primaryCta } = props;
  return (
    <div>
      <Button
        size="small"
        variant={primaryCta ? 'contained' : 'text'}
        color="primary"
        disabled={disabled}
        onClick={onClick}
        sx={{
          mt: 0.75,
          minWidth: 0,
          textTransform: 'none',
          fontWeight: 600,
          px: primaryCta ? 1.5 : 0.5,
        }}
      >
        {loading ? <CircularProgress size={primaryCta ? 18 : 14} color="inherit" /> : label}
      </Button>
      {inlineError && (
        <Typography variant="caption" color="error" display="block" sx={{ mt: 0.25, maxWidth: 320 }}>
          {inlineError}
        </Typography>
      )}
    </div>
  );
}
