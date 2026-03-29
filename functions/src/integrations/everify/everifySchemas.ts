/**
 * E-Verify schemas and types.
 * HRX E-Verify Master Plan §2.5, §3.1
 */

import { z } from 'zod';

/** Normalized HRX E-Verify case status enum */
export const EverifyCaseStatus = z.enum([
  'draft',
  'ready',
  'submitted',
  'pending',
  'employment_authorized',
  'tnc',
  'dhs_verification_in_process',
  'further_action_required',
  'final_nonconfirmation',
  'closed',
  'error',
]);
export type EverifyCaseStatus = z.infer<typeof EverifyCaseStatus>;

/** E-Verify event type */
export const EverifyEventType = z.enum([
  'CASE_CREATED',
  'CASE_DRAFT_CREATED',
  'CASE_SUBMITTED',
  'STATUS_CHANGED',
  'TNC_NOTICE_GENERATED',
  'EMPLOYEE_NOTIFIED',
  'CONTESTED',
  'REFERRAL_INITIATED',
  'CASE_CLOSED_MANUAL',
  'TASK_RESOLVED',
  'CLOSED',
  'ERROR',
]);
export type EverifyEventType = z.infer<typeof EverifyEventType>;

/** TNC resolution actions (provider-agnostic; wire ICA endpoints later) */
export interface EverifyCaseActions {
  employeeNotifiedAt?: unknown;
  employeeContests?: boolean;
  referralInitiatedAt?: unknown;
  caseClosedAt?: unknown;
  notes?: string;
}

/** Everify case document (Firestore) */
export interface EverifyCase {
  tenantId: string;
  entityId: string | null;
  userId: string | null;
  jobOrderId: string | null;
  shiftId: string | null;
  assignmentId: string | null;
  userEmploymentId: string | null;
  onboardingInstanceId: string | null;
  environment: 'stage' | 'prod';
  everifyCompanyId?: string;
  everifyCaseNumber?: string;
  status: EverifyCaseStatus;
  providerStatus?: string;
  submittedAt?: unknown;
  lastCheckedAt?: unknown;
  closedAt?: unknown;
  deadlines?: {
    tncResponseDueAt?: unknown;
    referralDueAt?: unknown;
  };
  warnings?: string[];
  error?: {
    code?: string;
    message?: string;
    raw?: string;
  };
  requestHash?: string;
  raw?: Record<string, unknown>;
  /** TNC resolution workflow (admin-only) */
  everifyCaseActions?: EverifyCaseActions;
  /** Worker-visible summary; workers should only read this when allowed by rules */
  public?: {
    status?: EverifyCaseStatus;
    statusDisplay?: string;
    eligibilityStatement?: string;
    deadlines?: { tncResponseDueAt?: unknown; referralDueAt?: unknown };
  };
  createdAt: unknown;
  updatedAt: unknown;
}

/** Everify event document (subcollection) */
export interface EverifyCaseEvent {
  tenantId: string;
  entityId: string | null;
  userId: string | null;
  userEmploymentId: string | null;
  assignmentId: string | null;
  type: EverifyEventType;
  at: unknown;
  actor: 'system' | string;
  data?: Record<string, unknown>;
}

/** Employee block sent from admin UI; merged server-side (never persisted). Confirm codes against your ICA. */
export const EverifyI9EmployeePayload = z
  .object({
    first_name: z.string().min(1).max(120).trim(),
    last_name: z.string().min(1).max(120).trim(),
    date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    ssn: z.string().min(9).max(32).trim(),
    citizenship_status_code: z.string().min(1).max(8).trim(),
  })
  .strict();

/** Callable input for everifyCreateCase */
export const EverifyCreateCaseInput = z.object({
  tenantId: z.string().min(1),
  entityId: z.string().optional(),
  userEmploymentId: z.string().optional(),
  assignmentId: z.string().optional(),
  /** Required for real per-worker cases when env fixture is incomplete or must be overridden. */
  i9Employee: EverifyI9EmployeePayload.optional(),
});
export type EverifyCreateCaseInput = z.infer<typeof EverifyCreateCaseInput>;

/** Worker-readable high-level status (for Firestore rules / worker UI) */
export const WORKER_READABLE_STATUS_FIELDS = [
  'status',
  'lastCheckedAt',
  'everifyCaseNumber',
] as const;

/** Worker-visible fields: client should only display these for worker role. Use doc.public when present. */
export const WORKER_PUBLIC_FIELD_NAMES = [
  'public',
  'status',
  'lastCheckedAt',
  'everifyCaseNumber',
] as const;

/** ICA v31: i9_case_flat request payload. Do NOT log or persist. */
export type I9CaseFlat = Record<string, unknown>;

/** ICA v31: Create draft case response */
export interface CreateCaseDraftResponse {
  case_number: string;
  case_status?: string;
  case_status_display?: string;
}

/** ICA v31: Submit case response */
export interface SubmitCaseResponse {
  case_number?: string;
  case_status?: string;
  case_status_display?: string;
  case_eligibility_statement?: string;
  ssa_referral_status?: string;
  dhs_referral_status?: string;
  dhs_referral_due_date?: string;
}

/** ICA v31: Get case status/details response (whitelisted fields only). */
export interface CaseStatusResponse {
  case_number?: string;
  case_status?: string;
  case_status_display?: string;
  case_eligibility_statement?: string;
  ssa_referral_status?: string;
  dhs_referral_status?: string;
  dhs_referral_due_date?: string;
  dhs_referral_created_at?: string;
  dhs_referral_contact_by_date?: string;
  ev_star_referral_due_date?: string;
  ev_star_referral_created_at?: string;
  ev_star_referral_contact_by_date?: string;
}
