// Recruiter module exports
// Event Bus Functions
export {
  createEventFunction,
  processEventsScheduled,
  cleanupEventsScheduled,
  onEventCreated,
  processEventsManual,
  getEventsForEntity,
  getEventsByType,
} from './eventBus';

// Handoff Functions
export {
  onOpportunityHandoff,
  validateHandoffGuardrails,
  upsertCrmCompany,
  upsertRecruiterClient,
  createJobOrdersFromDeal,
  updateCompanyFromRecruiter,
  updateContactFromRecruiter,
  refreshRecruiterCaches,
} from './handoff';

// Jobs Functions
export {
  getJobOrders,
  updateJobOrder,
  createJobOrder,
} from './jobs';

// Candidates Functions
export {
  getCandidates,
  createCandidate,
  updateCandidate,
} from './candidates';

// Applications Functions
export {
  getApplications,
  createApplication,
  updateApplicationStatus,
} from './applications';

// Pipeline Functions
export {
  getPipelineBoard,
  updatePipelineStage,
} from './pipeline';

// AI Functions
export {
  scoreCandidateForJob,
  detectDuplicates,
  bulkDetectDuplicates,
} from './ai';

// Jobs Board Functions
export {
  getJobsBoardPosts,
  createJobsBoardPost,
  updateJobsBoardPost,
  applyToPost,
} from './jobsBoard';

// Workflows Functions
export {
  createInterview,
  submitInterviewScorecard,
  createOffer,
  updateOfferStatus,
  getOffers,
  getPlacements,
  updatePlacementStatus,
} from './workflows';

// Jobs Board Functions (will be added in Phase 5)
// export {
//   createJobsBoardPost,
//   updateJobsBoardPost,
//   applyToPost,
//   convertApplicationToCandidate,
// } from './jobsBoard';

// Workflow Functions (will be added in Phase 5)
// export {
//   createSubmittals,
//   scheduleInterview,
//   createOffer,
//   acceptOffer,
// } from './workflow';

// Utility Functions
export * from './utils/events';
