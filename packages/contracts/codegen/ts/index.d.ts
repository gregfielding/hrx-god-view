// Auto-generated index file for HRX Contracts
// Generated on: 2025-08-27T18:45:11.181Z

export * from './messageThreads';
export * from './messages';
export * from './jobs_board_posts';
export * from './applications';
export * from './candidates';
export * from './features';

// Collection names (for type safety)
export const COLLECTIONS = {
  MESSAGE_THREADS: 'messageThreads',
  MESSAGES: 'messages',
  JOBS_BOARD_POSTS: 'jobs_board_posts',
  APPLICATIONS: 'applications',
  CANDIDATES: 'candidates',
  FEATURES: 'features',
} as const;

// Status enums (for type safety)
export const APPLICATION_STATUSES = [
  'new',
  'screened', 
  'advanced',
  'interview',
  'offer_pending',
  'hired',
  'rejected',
  'withdrawn'
] as const;

export const CANDIDATE_STATUSES = [
  'applicant',
  'active_employee',
  'inactive',
  'hired',
  'rejected',
  'terminated',
  'completed'
] as const;

export const PIPELINE_STAGES = [
  'applicant',
  'screened',
  'interview',
  'offer',
  'hired'
] as const;

export const POST_STATUSES = [
  'draft',
  'posted',
  'paused',
  'closed'
] as const;

export const POST_VISIBILITY = [
  'public',
  'private',
  'internal'
] as const;

export const MESSAGE_SENDER_TYPES = [
  'recruiter',
  'candidate',
  'ai',
  'system'
] as const;

export const MESSAGE_DELIVERY_STATUS = [
  'queued',
  'sent',
  'delivered',
  'read'
] as const;
