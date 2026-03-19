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

export function buildWorkerFindWorkUrl(): string {
  return `${getWorkerWebBaseUrl()}/c1/jobs-board`;
}

export function buildWorkerAssignmentsUrl(): string {
  return `${getWorkerWebBaseUrl()}/c1/workers/assignments`;
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
