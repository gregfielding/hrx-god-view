import React, { useCallback, useMemo, useState } from 'react';
import { Button, Typography } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../../../contexts/AuthContext';
import { canManageEverifyFromClaims } from '../backgroundsComplianceModel';
import { StartEverifySelectDialog } from '../StartEverifySelectDialog';
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
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [startEverifyDialogOpen, setStartEverifyDialogOpen] = useState(false);

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

  const openBackgroundsTab = useCallback(
    (backgroundCheckId?: string | null) => {
      const params = new URLSearchParams(location.search);
      params.set('employmentFocus', 'Backgrounds');
      const id = typeof backgroundCheckId === 'string' ? backgroundCheckId.trim() : '';
      if (id) {
        params.set('employmentScrollTo', 'background_check');
        params.set('employmentBackgroundCheckId', id);
      } else {
        params.delete('employmentScrollTo');
        params.delete('employmentBackgroundCheckId');
      }
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: false });
    },
    [navigate, location.pathname, location.search]
  );

  const handleClick = useCallback(async () => {
    if (!resolved || !phase1) return;
    setInlineError(null);

    if (
      resolved.actionKey === 'background.recruiter_order' ||
      resolved.actionKey === 'background.vendor_in_progress' ||
      resolved.actionKey === 'background.error_recruiter'
    ) {
      openBackgroundsTab(row.sourceRef?.backgroundCheckId ?? null);
      return;
    }

    if (resolved.actionKey === 'everify.select.in_progress' || resolved.actionKey === 'payroll.recruiter_review') {
      const empParams = new URLSearchParams(location.search);
      empParams.set('employmentFocus', 'Employment');
      if (resolved.actionKey === 'everify.select.in_progress') {
        empParams.set('employmentScrollTo', 'e_verify');
        empParams.set('employmentEntityKey', entityKey);
      }
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

  }, [resolved, phase1, row.sourceRef, ctx, entityKey, openBackgroundsTab, location.pathname, location.search, navigate, runNavigate]);

  const onRowClick = useCallback(() => {
    if (
      resolved?.actionKey === 'everify.select.check_eligibility' ||
      resolved?.actionKey === 'everify.select.error_retry'
    ) {
      setInlineError(null);
      setStartEverifyDialogOpen(true);
      return;
    }
    void handleClick();
  }, [resolved, handleClick]);

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
      ? 'Start E-Verify (Select)'
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

  const evRetryDisabled = resolved.actionKey === 'everify.select.error_retry' && !row.sourceRef?.caseId;

  return (
    <>
      <BoxActionFooter
        label={label}
        disabled={evRetryDisabled}
        onClick={onRowClick}
        inlineError={inlineError}
        primaryCta={primaryCta}
      />
      {(resolved.actionKey === 'everify.select.check_eligibility' || resolved.actionKey === 'everify.select.error_retry') &&
      ctx.tenantId ? (
        <StartEverifySelectDialog
          open={startEverifyDialogOpen}
          onClose={() => setStartEverifyDialogOpen(false)}
          uid={ctx.userId}
          tenantId={ctx.tenantId}
          dialogTitle={
            resolved.actionKey === 'everify.select.error_retry'
              ? 'Complete E-Verify (fix documents)'
              : undefined
          }
          prefillEverifyCaseId={
            resolved.actionKey === 'everify.select.error_retry' ? row.sourceRef?.caseId ?? null : null
          }
          onSuccess={() => {
            setStartEverifyDialogOpen(false);
            onComplete?.();
          }}
        />
      ) : null}
    </>
  );
};

function BoxActionFooter(props: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  inlineError: string | null;
  primaryCta: boolean;
}) {
  const { label, disabled, onClick, inlineError, primaryCta } = props;
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
        {label}
      </Button>
      {inlineError && (
        <Typography variant="caption" color="error" display="block" sx={{ mt: 0.25, maxWidth: 320 }}>
          {inlineError}
        </Typography>
      )}
    </div>
  );
}
