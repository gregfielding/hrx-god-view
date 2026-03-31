/**
 * Phase 2B: Payroll types (TempWorks-first). See docs/PAYROLL_DATA_MODEL_VALIDATION.md.
 */

export const PAYROLL_PROVIDER = ['tempworks', 'everee', 'manual'] as const;
export type PayrollProvider = (typeof PAYROLL_PROVIDER)[number];

export const PAYROLL_MODE = ['portal_link_only', 'manual_tracking', 'integrated'] as const;
export type PayrollMode = (typeof PAYROLL_MODE)[number];

export const PAYROLL_STATUS = [
  'not_started',
  'invite_sent',
  'account_created',
  'in_progress',
  'complete',
  'blocked',
  'inactive',
] as const;
export type PayrollStatus = (typeof PAYROLL_STATUS)[number];

export const PAYROLL_COMPLETION_SOURCE = ['manual', 'worker_confirmed', 'provider_sync'] as const;
export type PayrollCompletionSource = (typeof PAYROLL_COMPLETION_SOURCE)[number];

export const PAYROLL_INVITE_METHOD = ['manual', 'email_link', 'api'] as const;
export type PayrollInviteMethod = (typeof PAYROLL_INVITE_METHOD)[number];

export const PAYROLL_INVITE_AUTOMATION_STATUS = ['none', 'sent'] as const;
export type PayrollInviteAutomationStatus = (typeof PAYROLL_INVITE_AUTOMATION_STATUS)[number];

/**
 * Entity-level payroll configuration (TempWorks-first; supports Everee later).
 * Canonical worker-facing onboarding entry: `onboardingUrl` on `tenants/{tid}/entities/{entityId}`.
 * `portalUrl` is an optional fallback when no dedicated onboarding link exists.
 */
export interface PayrollSettings {
  provider: PayrollProvider;
  mode: PayrollMode;
  onboardingUrl: string | null;
  portalUrl: string | null;
  supportsEmbeddedFlow: boolean;
  inviteMethod: PayrollInviteMethod;
  notes: string | null;
  updatedAt?: unknown;
  updatedBy?: string | null;
}

/** Worker payroll account document: tenants/{tid}/worker_payroll_accounts/{userId}__{entityKey}. */
export interface WorkerPayrollAccount {
  tenantId: string;
  userId: string;
  entityId: string;
  entityKey: string;
  entityName?: string | null;
  employmentId?: string | null;
  workerType: 'w2' | '1099';
  payrollProvider: PayrollProvider;
  payrollMode: PayrollMode;
  payrollStatus: PayrollStatus;
  payrollAccountLink?: string | null;
  externalWorkerId?: string | null;
  payrollInviteSentAt?: unknown;
  /** Timestamp of the most recent successful payroll onboarding invite send (automation or resend). */
  inviteSentAt?: unknown;
  /** First successful invite only (optional mirror of payrollInviteSentAt for new writes). */
  inviteFirstSentAt?: unknown;
  /** Automation-facing invite flag; use with `inviteSentAt` / `lastInviteChannel`. */
  inviteStatus?: PayrollInviteAutomationStatus | string | null;
  /** Primary channel that succeeded for the last invite (`sms` | `email` | `push`). */
  lastInviteChannel?: string | null;
  payrollAccountCreatedAt?: unknown;
  payrollSetupCompletedAt?: unknown;
  completionSource?: PayrollCompletionSource | null;
  directDepositStatus?: string | null;
  taxFormStatus?: string | null;
  lastAdminVerifiedAt?: unknown;
  lastAdminVerifiedBy?: string | null;
  notes?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export function workerPayrollAccountId(userId: string, entityKey: string): string {
  return `${userId}__${entityKey}`;
}

/** Human-friendly payroll status label (admin and worker UI). */
export function getPayrollStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    not_started: 'Not started',
    invite_sent: 'Invite sent',
    account_created: 'Account created',
    in_progress: 'In progress',
    complete: 'Complete',
    blocked: 'Blocked',
    inactive: 'Inactive',
  };
  return labels[status] ?? status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
