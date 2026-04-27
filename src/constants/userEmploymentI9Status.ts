/**
 * `tenants/{tenantId}/user_employments/{id}.i9Status` — same document field everywhere (E-Verify, triggers, onboarding sync).
 * Server checks use `.toLowerCase()`; E-Verify eligibility requires `completed`.
 */
export const USER_EMPLOYMENT_I9_STATUS_VALUES = [
  'pending',
  'not_started',
  'in_progress',
  'completed',
  'expired',
  'waived',
  'cancelled',
] as const;

export type UserEmploymentI9StatusValue = (typeof USER_EMPLOYMENT_I9_STATUS_VALUES)[number];

export const USER_EMPLOYMENT_I9_STATUS_LABELS: Record<UserEmploymentI9StatusValue, string> = {
  pending: 'Pending',
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  expired: 'Expired',
  waived: 'Waived',
  cancelled: 'Cancelled',
};
