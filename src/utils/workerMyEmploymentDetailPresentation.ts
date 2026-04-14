/**
 * UI-only helpers for worker My Employment detail — onboarding checklist + primary CTA derivation.
 * No backend or data shape changes.
 */
import type { EmploymentOnboardingRow } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { isOnboardingPathRowDone } from './employmentOnboardingPath';

export type ChecklistUiStatus = 'complete' | 'in_progress' | 'required' | 'pending';

export function rowToChecklistUiStatus(row: EmploymentOnboardingRow): ChecklistUiStatus {
  if (isOnboardingPathRowDone(row.status)) return 'complete';
  if (
    row.blocking &&
    (row.actionableBy === 'worker' || row.actionableBy === 'either') &&
    !isOnboardingPathRowDone(row.status)
  ) {
    return 'required';
  }
  if (row.status === 'in_progress' || row.status === 'error') return 'in_progress';
  return 'pending';
}

export type PrimaryCtaKind = 'external' | 'scroll' | 'none';

export interface DerivedPrimaryCta {
  kind: PrimaryCtaKind;
  label: string;
  href?: string;
  scrollElementId?: string;
}

export function derivePrimaryCta(args: {
  yourTasks: EmploymentOnboardingRow[];
  payrollComplete: boolean;
  pathCoversPayroll: boolean;
  payrollSignupUrl: string | null;
  payrollPortalLoginUrl: string | null;
  t: (key: string, params?: Record<string, string | number>) => string;
  stepLabel: (row: EmploymentOnboardingRow) => string;
}): DerivedPrimaryCta {
  const {
    yourTasks,
    payrollComplete,
    pathCoversPayroll,
    payrollSignupUrl,
    payrollPortalLoginUrl,
    t,
    stepLabel,
  } = args;

  const firstActionable = yourTasks.find(
    (r) =>
      !isOnboardingPathRowDone(r.status) &&
      (r.actionableBy === 'worker' || r.actionableBy === 'either'),
  );

  if (firstActionable) {
    const pid = firstActionable.sourceRef?.pipelineStepId;
    if (pid === 'everee' && !payrollComplete) {
      const href = (payrollSignupUrl || payrollPortalLoginUrl || '').trim();
      if (href) {
        return {
          kind: 'external',
          label: t('workerEmploymentDetail.ctaCompletePayroll'),
          href,
        };
      }
    }
    if (pid === 'i9' || firstActionable.groupId === 'work_authorization') {
      return {
        kind: 'scroll',
        label: t('workerEmploymentDetail.ctaUploadId'),
        scrollElementId: 'worker-employment-i9-anchor',
      };
    }
    return {
      kind: 'scroll',
      label: t('workerEmploymentDetail.ctaContinueStep', { step: stepLabel(firstActionable) }),
      scrollElementId: `employment-checklist-${firstActionable.rowId}`,
    };
  }

  if (!payrollComplete && pathCoversPayroll) {
    const href = (payrollSignupUrl || payrollPortalLoginUrl || '').trim();
    if (href) {
      return {
        kind: 'external',
        label: t('workerEmploymentDetail.ctaCompletePayroll'),
        href,
      };
    }
  }

  return {
    kind: 'scroll',
    label: t('workerEmploymentDetail.ctaContinueOnboarding'),
    scrollElementId: 'worker-employment-bridge-identity',
  };
}

/** Group path rows into bridge UI sections (no backend changes). */
export type BridgeSectionBucket = 'identity' | 'payroll' | 'screening';

export function partitionEmploymentRowsForBridge(
  rows: EmploymentOnboardingRow[],
): Record<BridgeSectionBucket, EmploymentOnboardingRow[]> {
  const out: Record<BridgeSectionBucket, EmploymentOnboardingRow[]> = {
    identity: [],
    payroll: [],
    screening: [],
  };
  for (const row of rows) {
    const pid = String(row.sourceRef?.pipelineStepId || '');
    const gid = String(row.groupId || '');
    const label = String(row.label || '');
    if (pid === 'everee' || gid === 'payroll') {
      out.payroll.push(row);
      continue;
    }
    if (
      gid === 'screenings' ||
      /screening|background/i.test(gid) ||
      /background check|drug screen|screening/i.test(label)
    ) {
      out.screening.push(row);
      continue;
    }
    out.identity.push(row);
  }
  return out;
}
