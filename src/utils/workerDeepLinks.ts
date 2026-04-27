export type WorkerDeepLinkType =
  | 'assignmentDetail'
  | 'applicationDetail'
  | 'jobDetail'
  | 'jobPostDetail'
  | 'dashboard'
  | 'profile'
  | 'findWork'
  | 'assignments';

export interface WorkerDeepLinkDestination {
  type: WorkerDeepLinkType;
  id?: string;
  query?: Record<string, string>;
}

export const WORKER_CANONICAL_PATHS = {
  assignmentDetail: (assignmentId: string) => `/c1/workers/assignments/${assignmentId}`,
  applicationDetail: (applicationId: string) => `/c1/workers/applications/${applicationId}`,
  jobDetail: (jobId: string) => `/c1/jobs/${jobId}`,
  jobPostDetail: (jobPostId: string) => `/c1/jobs-board/${jobPostId}`,
  dashboard: () => '/c1/workers/dashboard',
  profile: () => '/c1/workers/profile',
  findWork: () => '/c1/jobs-board',
  assignments: () => '/c1/workers/assignments',
};

export function buildWorkerDeepLinkPath(destination: WorkerDeepLinkDestination): string {
  switch (destination.type) {
    case 'assignmentDetail':
      return destination.id ? WORKER_CANONICAL_PATHS.assignmentDetail(destination.id) : WORKER_CANONICAL_PATHS.assignments();
    case 'applicationDetail':
      return destination.id ? WORKER_CANONICAL_PATHS.applicationDetail(destination.id) : '/c1/workers/applications';
    case 'jobDetail':
      return destination.id ? WORKER_CANONICAL_PATHS.jobDetail(destination.id) : WORKER_CANONICAL_PATHS.findWork();
    case 'jobPostDetail':
      return destination.id ? WORKER_CANONICAL_PATHS.jobPostDetail(destination.id) : WORKER_CANONICAL_PATHS.findWork();
    case 'dashboard':
      return WORKER_CANONICAL_PATHS.dashboard();
    case 'profile':
      return WORKER_CANONICAL_PATHS.profile();
    case 'findWork':
      return WORKER_CANONICAL_PATHS.findWork();
    case 'assignments':
      return WORKER_CANONICAL_PATHS.assignments();
    default:
      return WORKER_CANONICAL_PATHS.dashboard();
  }
}
