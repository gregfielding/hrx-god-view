/**
 * Worker readiness: derived status from employment, onboarding, compliance, payroll.
 * Consumes compliance expiration facts; does not change onboarding/employment/compliance data.
 * Modular: readiness consumes facts; no assignment gating in this module.
 *
 * When `canonicalPathRows` is provided (worker My Employment path loaded), onboarding completion
 * matches `employmentOnboardingPath.isOnboardingPathRowBlocker` — same truth as path rows.
 *
 * **Convergence note:** `ReadinessStatus` here is parallel to `EmploymentV2HeaderState` on the admin/overview side.
 * Next cleanup: optionally pass the same header-derived state (or shared inputs) so worker banners and chips do not
 * contradict `employmentHeaderState`; keep this module as the place for **compliance + payroll hard gates** even
 * after header convergence.
 */
import { isExpired, isExpiringSoon, DEFAULT_EXPIRING_SOON_DAYS } from './complianceExpiration';
import { isOnboardingPathRowBlocker } from './employmentOnboardingPath';
import { getComplianceTypeLabel, getComplianceTypeConfig } from '../types/compliance';
import type { WorkerComplianceItem } from '../types/compliance';
import type { EmploymentOnboardingRow } from '../pages/UserProfile/components/employment-v2/employmentV2Types';

export const READINESS_STATUS = ['not_ready', 'onboarding', 'ready', 'at_risk', 'blocked'] as const;
export type ReadinessStatus = (typeof READINESS_STATUS)[number];

/** Human-friendly label for readiness status (admin and worker UI). */
export function getReadinessStatusLabel(status: ReadinessStatus): string {
  const labels: Record<ReadinessStatus, string> = {
    ready: 'Ready',
    onboarding: 'Onboarding',
    at_risk: 'At risk',
    blocked: 'Blocked',
    not_ready: 'Not ready',
  };
  return labels[status] ?? status.replace(/_/g, ' ');
}

export interface WorkerReadinessResult {
  status: ReadinessStatus;
  reasons: string[];
}

export interface EmploymentForReadiness {
  id: string;
  status: string;
  entityKey?: string;
  onboardingPipelineId?: string | null;
}

export interface PayrollAccountForReadiness {
  payrollStatus: string;
  payrollProvider?: string;
}

export interface WorkerReadinessInput {
  employments: EmploymentForReadiness[];
  complianceItems: WorkerComplianceItem[];
  /** Keyed by workerPayrollAccountId (userId__entityKey) or similar */
  payrollByKey?: Record<string, PayrollAccountForReadiness>;
  /** For each pipeline id: { complete, total }. If total > 0 and complete === total, onboarding steps complete. */
  pipelineStepCounts?: Record<string, { complete: number; total: number }>;
  /**
   * When defined (including `[]`), single onboarding employment uses path blocker logic instead of
   * `pipelineStepCounts`. Same deduped rows as the worker canonical path UI.
   */
  canonicalPathRows?: EmploymentOnboardingRow[];
  /** Default 30 */
  expiringSoonDays?: number;
}

/**
 * Compute worker readiness from employment, compliance, and payroll.
 * Order: blocked (compliance expired / payroll blocked) > at_risk (expiring soon) > onboarding > not_ready > ready.
 */
export function getWorkerReadiness(input: WorkerReadinessInput): WorkerReadinessResult {
  const {
    employments,
    complianceItems,
    payrollByKey = {},
    pipelineStepCounts = {},
    canonicalPathRows,
    expiringSoonDays = DEFAULT_EXPIRING_SOON_DAYS,
  } = input;

  const reasons: string[] = [];
  const activeOrOnboarding = employments.filter((e) => e.status === 'active' || e.status === 'onboarding');

  // 1. No employment or none active/onboarding
  if (activeOrOnboarding.length === 0) {
    return {
      status: 'not_ready',
      reasons: employments.length === 0 ? ['No employment record'] : ['No active or onboarding employment'],
    };
  }

  const requiredItems = complianceItems.filter((i) => i.required === true);

  // 2. Blocked: any required compliance expired
  const expiredRequired = requiredItems.filter((i) => {
    const config = getComplianceTypeConfig(i.type);
    return config?.hasExpiration !== false && isExpired(i);
  });
  if (expiredRequired.length > 0) {
    expiredRequired.forEach((i) => reasons.push(`${getComplianceTypeLabel(i.type)} expired`));
    return { status: 'blocked', reasons };
  }

  // 3. Blocked: any payroll status blocked
  const blockedPayroll = Object.values(payrollByKey).filter((p) => p.payrollStatus === 'blocked');
  if (blockedPayroll.length > 0) {
    reasons.push('Payroll setup blocked');
    return { status: 'blocked', reasons };
  }

  // 4. At risk: any required compliance expiring soon
  const expiringRequired = requiredItems.filter((i) => {
    const config = getComplianceTypeConfig(i.type);
    return config?.hasExpiration === true && isExpiringSoon(i, expiringSoonDays);
  });
  if (expiringRequired.length > 0) {
    expiringRequired.forEach((i) => {
      const label = getComplianceTypeLabel(i.type);
      reasons.push(`${label} expires soon`);
    });
    return { status: 'at_risk', reasons };
  }

  // 5. Onboarding: any employment still onboarding (path blockers or coarse pipeline progress)
  const onboardingEmployments = activeOrOnboarding.filter((e) => e.status === 'onboarding');
  if (onboardingEmployments.length > 0) {
    const pathOnboardingComplete =
      canonicalPathRows !== undefined && onboardingEmployments.length === 1
        ? canonicalPathRows.length > 0 && !canonicalPathRows.some(isOnboardingPathRowBlocker)
        : null;

    const allOnboardingComplete = onboardingEmployments.every((e) => {
      if (pathOnboardingComplete !== null) {
        return pathOnboardingComplete;
      }
      const counts = e.onboardingPipelineId ? pipelineStepCounts[e.onboardingPipelineId] : null;
      if (!counts || counts.total === 0) return false;
      return counts.complete >= counts.total;
    });
    if (!allOnboardingComplete) {
      return { status: 'onboarding', reasons: ['Complete onboarding to start working'] };
    }
  }

  // 6. Not ready: any required compliance incomplete
  const incompleteStatuses = ['not_started', 'pending', 'submitted', 'in_review'];
  const incompleteRequired = requiredItems.filter((i) => incompleteStatuses.includes(i.status));
  if (incompleteRequired.length > 0) {
    incompleteRequired.forEach((i) => reasons.push(`${getComplianceTypeLabel(i.type)} incomplete`));
    return { status: 'not_ready', reasons };
  }

  // 7. Not ready: payroll required but incomplete (for active/onboarding employments with payroll)
  const payrollValues = Object.values(payrollByKey);
  const incompletePayroll = payrollValues.filter(
    (p) =>
      p.payrollStatus &&
      p.payrollStatus !== 'complete' &&
      p.payrollStatus !== 'inactive' &&
      ['not_started', 'invite_sent', 'account_created', 'in_progress', 'blocked'].includes(p.payrollStatus)
  );
  if (incompletePayroll.some((p) => p.payrollStatus === 'blocked')) {
    return { status: 'blocked', reasons: ['Payroll setup blocked'] };
  }
  if (incompletePayroll.length > 0 && payrollValues.some((p) => p.payrollProvider && p.payrollProvider !== 'manual')) {
    reasons.push('Payroll setup incomplete');
    return { status: 'not_ready', reasons };
  }

  return { status: 'ready', reasons: [] };
}
