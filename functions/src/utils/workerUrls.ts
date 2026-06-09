const DEFAULT_WORKER_WEB_BASE_URL = 'https://hrxone.com';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getWorkerWebBaseUrl(): string {
  const configured =
    process.env.WORKER_WEB_BASE_URL ||
    process.env.WEB_BASE_URL ||
    process.env.PUBLIC_WEB_BASE_URL ||
    DEFAULT_WORKER_WEB_BASE_URL;
  return trimTrailingSlash(String(configured || DEFAULT_WORKER_WEB_BASE_URL));
}

export function buildWorkerDashboardUrl(): string {
  return `${getWorkerWebBaseUrl()}/c1/workers/dashboard`;
}

export function buildWorkerProfileUrl(): string {
  return `${getWorkerWebBaseUrl()}/c1/workers/profile`;
}

/** AI pre-screen questionnaire; pass application id from application doc. */
export function buildWorkerAiPrescreenUrl(applicationId: string): string {
  const id = String(applicationId || '').trim();
  const base = getWorkerWebBaseUrl();
  if (!id) {
    return `${base}/c1/workers/prescreen`;
  }
  return `${base}/c1/workers/prescreen?applicationId=${encodeURIComponent(id)}`;
}

export type WorkerAiPrescreenEntrySource =
  | 'sms_apply_wizard_invite'
  | 'sms_auto_new_user'
  /** Auto new-user SMS when the worker has no application — profile-first interview link. */
  | 'sms_profile_first_interview'
  | 'profile_first_chase_1'
  | 'profile_first_chase_2'
  | 'user_group_backfill'
  /** @deprecated Prefer user_group_ready_interview_invite — kept for older SMS links */
  | 'user_group_invite'
  | 'user_group_ready_interview_invite'
  | 'user_group_profile_gap_interview_invite'
  | 'scheduled_invite'
  | 'scheduled_gap_invite'
  | 'sms_application_first_touch'
  | 'sms_application_first_touch_gap'
  | 'recent_user_backfill'
  | 'followup_invite'
  | 'chase_1'
  | 'chase_2'
  /** Worker dashboard “complete interview” CTA (`workerAiPrescreenDashboardActions`). */
  | 'dashboard_cta'
  /** Recruiter user profile → Interview tab “Order Interview”. */
  | 'recruiter_profile_order_interview'
  | 'direct'
  | string;

/**
 * Interview deep link with `entry` for analytics / adaptive routing (client reads query params).
 * Preserves application context when `applicationId` is set.
 */
export function buildWorkerAiPrescreenInviteUrl(params: {
  applicationId?: string | null;
  entry: WorkerAiPrescreenEntrySource | string;
}): string {
  const base = getWorkerWebBaseUrl();
  const q = new URLSearchParams();
  const aid = String(params.applicationId ?? '').trim();
  if (aid) {
    q.set('applicationId', aid);
  }
  q.set('entry', String(params.entry || 'direct').trim() || 'direct');
  return `${base}/c1/workers/prescreen?${q.toString()}`;
}

/**
 * Worker entity employment onboarding hub. `employmentRecordId` is the `entity_employments` doc id
 * (same as `worker_onboarding` / pipeline id: `userId__entityKey`).
 */
export function buildWorkerEntityEmploymentUrl(employmentRecordId: string): string {
  const id = String(employmentRecordId || "").trim();
  if (!id) return "";
  return `${getWorkerWebBaseUrl()}/c1/workers/my-employment/${encodeURIComponent(id)}`;
}

export function buildWorkerFindWorkUrl(): string {
  return `${getWorkerWebBaseUrl()}/c1/jobs-board`;
}

export function buildWorkerAssignmentsUrl(): string {
  return `${getWorkerWebBaseUrl()}/c1/workers/assignments`;
}

/**
 * Worker payroll hub for a given Everee tenant id (multi-entity / multi–Everee-tenant).
 * Example: …/c1/workers/payroll/3138
 */
export function buildWorkerPayrollEvereeTenantUrl(evereeTenantId: string): string {
  const id = String(evereeTenantId || '').trim();
  if (!id) return '';
  return `${getWorkerWebBaseUrl()}/c1/workers/payroll/${encodeURIComponent(id)}`;
}

export function buildWorkerAssignmentUrl(assignmentId?: string): string {
  if (assignmentId) {
    return `${getWorkerWebBaseUrl()}/c1/workers/assignments/${assignmentId}`;
  }
  return buildWorkerAssignmentsUrl();
}

export function buildWorkerApplicationsUrl(applicationId?: string): string {
  if (applicationId) {
    return `${getWorkerWebBaseUrl()}/c1/workers/applications/${applicationId}`;
  }
  return `${getWorkerWebBaseUrl()}/c1/workers/applications`;
}

export function buildWorkerApplicationUrl(applicationId?: string): string {
  return buildWorkerApplicationsUrl(applicationId);
}

export function buildWorkerJobUrl(jobId?: string): string {
  if (jobId) {
    return `${getWorkerWebBaseUrl()}/c1/jobs/${jobId}`;
  }
  return buildWorkerFindWorkUrl();
}

export function buildWorkerJobPostUrl(jobPostId?: string): string {
  if (jobPostId) {
    return `${getWorkerWebBaseUrl()}/c1/jobs-board/${jobPostId}`;
  }
  return buildWorkerFindWorkUrl();
}

/** Deep link back into the apply wizard (job posting, C1 general, or C1 user-group signup). */
export function buildApplyWizardResumeUrl(snapshot: {
  path?: string;
  tenantSlug?: string | null;
  tenantId?: string | null;
  jobId?: string | null;
  signupGroupId?: string | null;
}): string {
  const base = getWorkerWebBaseUrl();
  const path = String(snapshot.path || '').trim();
  const slug = String(snapshot.tenantSlug || snapshot.tenantId || '').trim();
  const jobId = String(snapshot.jobId || '').trim();
  const groupId = String(snapshot.signupGroupId || '').trim();

  if (path === 'job' && slug && jobId) {
    return `${base}/apply/${encodeURIComponent(slug)}/${encodeURIComponent(jobId)}`;
  }
  if (path === 'c1_group' && groupId) {
    return `${base}/c1/apply/group/${encodeURIComponent(groupId)}`;
  }
  return `${base}/c1/apply`;
}

export function buildWorkerAssignmentResponseUrl(params: {
  jobPostId?: string;
  assignmentId?: string;
  shiftId?: string;
}): string {
  const { jobPostId, assignmentId, shiftId } = params;
  if (jobPostId && assignmentId) {
    const search = new URLSearchParams({
      assignmentId,
      intent: 'assignment_response',
      ...(shiftId ? { shiftId } : {}),
    });
    return `${buildWorkerJobPostUrl(jobPostId)}?${search.toString()}`;
  }
  if (assignmentId) {
    const search = new URLSearchParams({
      assignmentId,
      intent: 'assignment_response',
      ...(shiftId ? { shiftId } : {}),
    });
    return `${buildWorkerFindWorkUrl()}?${search.toString()}`;
  }
  return buildWorkerFindWorkUrl();
}

/**
 * One-click ACCEPT URL for assignment-offer SMS / email. Lands on the
 * JOBS-BOARD POSTING (same as DECLINE) with `intent=accept&assignmentId=…`
 * — that's where Confirm/Decline live (green Confirm opens the 3-checkbox
 * acknowledgement sheet). The posting detects the intent and opens the
 * confirmation sheet for the offered shift.
 *
 * Accepts either a plain assignmentId (legacy) or an object with the
 * jobPostId. Without a jobPostId we fall back to the assignment-details
 * page so the link still works, just without the posting context.
 */
export function buildWorkerAssignmentAcceptUrl(
  arg?: string | { assignmentId?: string; jobPostId?: string },
): string {
  const assignmentId = typeof arg === 'string' ? arg : arg?.assignmentId;
  const jobPostId = typeof arg === 'string' ? undefined : arg?.jobPostId;
  const aid = String(assignmentId || '').trim();
  const jpid = String(jobPostId || '').trim();
  if (!aid) return buildWorkerAssignmentsUrl();
  const search = new URLSearchParams({ intent: 'accept', assignmentId: aid });
  if (jpid) {
    return `${buildWorkerJobPostUrl(jpid)}?${search.toString()}`;
  }
  return `${buildWorkerWebBaseAssignmentPath(aid)}?intent=accept`;
}

/**
 * One-click DECLINE URL — lands on the job-post page (so they can
 * re-apply to another shift if they declined the wrong one) with
 * `intent=decline&assignmentId=...`. The page fires the decline on
 * mount and shows a confirmation banner with a CTA back to the shift
 * list. Falls back to the assignment details page if jobPostId is
 * missing (can still record the decline, just no reapply CTA).
 */
export function buildWorkerAssignmentDeclineUrl(params: {
  assignmentId?: string;
  jobPostId?: string;
}): string {
  const aid = String(params.assignmentId || '').trim();
  const jpid = String(params.jobPostId || '').trim();
  if (!aid) return buildWorkerAssignmentsUrl();
  const search = new URLSearchParams({ intent: 'decline', assignmentId: aid });
  if (jpid) {
    return `${buildWorkerJobPostUrl(jpid)}?${search.toString()}`;
  }
  return `${buildWorkerWebBaseAssignmentPath(aid)}?intent=decline`;
}

function buildWorkerWebBaseAssignmentPath(assignmentId: string): string {
  return `${getWorkerWebBaseUrl()}/c1/workers/assignments/${assignmentId}`;
}
