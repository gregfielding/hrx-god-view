// Base interfaces for HRX Recruiter module
// All entities require tenantId for multi-tenant isolation

export interface BaseEntity {
  tenantId: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
  searchKeywords: string[];
  status?: string;
}

// Event Bus Interfaces
export interface Event extends BaseEntity {
  type: string;
  entityType: string;
  entityId: string;
  payload: Record<string, any>;
  source: string;
  dedupeKey: string;
  processed: boolean;
  processedAt?: number;
  error?: string;
  retryCount: number;
}

// Canonical Data Strategy - CRM References
export interface RecruiterClientExtension extends BaseEntity {
  crmCompanyId: string; // REQUIRED reference to canonical CRM company
  clientTier: 'bronze' | 'silver' | 'gold' | 'platinum';
  fulfillmentSLA: {
    days: number;
    description: string;
  };
  submittalSLA: {
    hours: number;
    description: string;
  };
  preferredChannels: ('SMS' | 'email' | 'app')[];
  safetyRequirements: string[];
  onboardingPacketId?: string;
  docTemplates: string[]; // I-9, W-4, NDA templates
  eeoTracking: boolean;
  worksiteIds: string[];
  jobOrderIds: string[];
  contactIds: string[];
}

// Job Orders
export interface JobOrder extends BaseEntity {
  crmCompanyId: string; // Reference to canonical CRM company
  crmDealId?: string; // Reference to CRM deal if from handoff
  worksiteId?: string;
  title: string;
  roleCategory?: string;
  openings: number;
  remainingOpenings: number;
  startDate: string;
  endDate?: string;
  shifts: Shift[];
  payRate: number;
  billRate?: number;
  markup?: number;
  otRules: OTRules;
  backgroundCheck: BackgroundCheck;
  drugTest: DrugTest;
  language: string[];
  minExperience?: number;
  certifications: string[];
  dressCode?: string;
  notes?: string;
  priority: 'low' | 'medium' | 'high';
  urgencyScore: number; // 0-100
  targetFillDate?: string;
  recruiterOwnerId: string;
  teamIds: string[];
  autoPostToJobsBoard: boolean;
  submittalLimit: number;
  internalOnly: boolean;
  allowOverfill: boolean;
  metrics: JobOrderMetrics;
  status: JobOrderStatus;
}

// Supporting Interfaces
export interface Shift {
  label: string;
  start: string;
  end: string;
  days: number[]; // 0-6 (Sunday-Saturday)
}

export interface OTRules {
  enabled: boolean;
  rate: number;
  threshold: number; // hours per week
}

export interface BackgroundCheck {
  required: boolean;
  package?: string;
}

export interface DrugTest {
  required: boolean;
  panel?: string;
}

export interface JobOrderMetrics {
  submittals: number;
  interviews: number;
  offers: number;
  placements: number;
  timeToFirstSubmittalHrs?: number;
  timeToFillDays?: number;
  jobAgingDays?: number;
}

export type JobOrderStatus = 
  | 'draft' 
  | 'open' 
  | 'interviewing' 
  | 'offer' 
  | 'partially_filled' 
  | 'filled' 
  | 'closed' 
  | 'canceled';

// Jobs Board Posts
export interface JobsBoardPost extends BaseEntity {
  mode: 'linked' | 'evergreen';
  jobOrderId?: string; // For linked posts
  talentPoolKey?: string; // For evergreen posts
  title: string;
  description: string;
  location: string;
  geo?: {
    lat: number;
    lng: number;
  };
  payRange?: {
    min: number;
    max: number;
  };
  shifts: string[];
  benefits?: string;
  visibility: 'public' | 'private' | 'internal';
  channels: ('Companion' | 'PublicURL' | 'QR')[];
  screeningQuestions: ScreeningQuestion[];
  autoReplyTemplateId?: string;
  requireResume: boolean;
  requireCerts: string[];
  eeoDisclosure: boolean;
  status: 'draft' | 'posted' | 'paused' | 'closed';
}

export interface ScreeningQuestion {
  id: string;
  question: string;
  type: 'text' | 'yesno' | 'multiselect' | 'number';
  required: boolean;
  options?: string[]; // For multiselect
}

// Applications (from Jobs Board)
export interface Application extends BaseEntity {
  mode: 'jobOrder' | 'evergreen';
  jobOrderId?: string;
  postId: string;
  candidateId?: string; // If converted to candidate
  externalApplicant?: {
    name: string;
    email: string;
    phone: string;
  };
  resumeUrl?: string;
  workAuth: string;
  answers: ApplicationAnswer[];
  source: 'QR' | 'URL' | 'referral' | 'Companion';
  utm?: Record<string, string>;
  consents: string[];
  referralCode?: string;
  tags: string[];
  status: 'new' | 'screened' | 'rejected' | 'advanced' | 'hired' | 'withdrawn' | 'duplicate';
}

export interface ApplicationAnswer {
  questionId: string;
  answer: string | string[] | number;
}

// Candidates (unified applicants/employees)
export interface Candidate extends BaseEntity {
  // Person Information
  name: string;
  dob?: string;
  phones: string[];
  emails: string[];
  address?: string;
  geo?: {
    lat: number;
    lng: number;
  };
  workAuth: string;
  languages: string[];
  rightToWorkDocs: string[];
  emergencyContact?: {
    name: string;
    relationship: string;
    phone: string;
  };
  
  // Profile Information
  resumeUrl?: string;
  parsedSkills: string[];
  certifications: string[];
  licenses: string[];
  equipment: string[]; // e.g., forklift types
  preferences: {
    shift: string[];
    travel: boolean;
    minPay: number;
  };
  traits: string[];
  notes?: string;
  
  // Status
  status: 'applicant' | 'active_employee' | 'inactive' | 'do_not_hire';
  
  // Compliance
  i9Status: 'pending' | 'complete' | 'expired';
  bgcStatus: 'pending' | 'pass' | 'fail' | 'expired';
  drugStatus: 'pending' | 'pass' | 'fail' | 'expired';
  docExpirations: DocumentExpiration[];
  trainingCompleted: string[];
  
  // HRX App Integration
  companionUserId?: string;
  notificationPrefs: {
    email: boolean;
    sms: boolean;
    push: boolean;
  };
}

export interface DocumentExpiration {
  type: string;
  expirationDate: string;
  documentUrl?: string;
}

// Submittals (candidate → client submission)
export interface Submittal extends BaseEntity {
  jobOrderId: string;
  candidateId: string;
  resumeSnapshotUrl?: string;
  summary: string;
  payExpectation: number;
  availability: string;
  notesToClient: string;
  attachments: string[];
  submittedBy: string;
  submittedAt: number;
  clientFeedback?: {
    status: 'review' | 'declined' | 'interview_request' | 'offer';
    rating?: number;
    comments?: string;
  };
}

// Interviews
export interface Interview extends BaseEntity {
  jobOrderId: string;
  candidateId: string;
  clientContactId: string;
  type: 'phone' | 'video' | 'onsite';
  when: string;
  timezone: string;
  location?: string;
  link?: string;
  panel: string[];
  outcome: 'pending' | 'advance' | 'reject';
  scorecards: InterviewScorecard[];
  notes?: string;
  reminders: InterviewReminder[];
}

export interface InterviewScorecard {
  evaluatorId: string;
  criteria: {
    name: string;
    score: number;
    comments?: string;
  }[];
  overallScore: number;
  recommendation: 'hire' | 'maybe' | 'no';
}

export interface InterviewReminder {
  type: 'email' | 'sms' | 'push';
  when: string;
  sent: boolean;
}

// Offers
export interface Offer extends BaseEntity {
  jobOrderId: string;
  candidateId: string;
  payRate: number;
  startDate: string;
  shift: string;
  employmentType: 'temp' | 'temp_to_hire' | 'direct';
  contingencies: {
    bgc: boolean;
    drug: boolean;
    eVerify: boolean;
  };
  expiresAt: string;
  state: 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';
}

// Placements
export interface Placement extends BaseEntity {
  jobOrderId: string;
  candidateId: string; // becomes employeeId as needed
  clientId: string;
  worksiteId: string;
  startDate: string;
  endDate?: string;
  ratePlan: {
    pay: number;
    bill: number;
    ot: number;
  };
  assignmentId?: string; // link to scheduling/timesheets
  backfillFor?: string;
  status: 'active' | 'completed' | 'terminated' | 'no_show';
  incidentCount: number;
}

// Worksites
export interface Worksite extends BaseEntity {
  clientId: string;
  label: string;
  address: string;
  geo?: {
    lat: number;
    lng: number;
  };
  shiftPatterns: Shift[];
  supervisorContacts: string[]; // contact IDs
  timeclockMode: 'kiosk' | 'mobile_geofence' | 'badge';
  requiredPPE: string[];
}

// Handoff Guardrails
export interface HandoffGuardrails {
  msaAccepted: boolean;
  creditApproved: boolean;
  billingProfileComplete: boolean;
  primaryContactSet: boolean;
  worksiteCaptured: boolean;
}

// Filter Interfaces
export interface JobOrderFilters {
  status?: JobOrderStatus[];
  priority?: ('low' | 'medium' | 'high')[];
  clientId?: string;
  recruiterId?: string;
  dateRange?: {
    start: string;
    end: string;
  };
  search?: string;
}

export interface CandidateFilters {
  status?: ('applicant' | 'active_employee' | 'inactive' | 'do_not_hire')[];
  location?: string;
  skills?: string[];
  certifications?: string[];
  dateRange?: {
    start: string;
    end: string;
  };
  search?: string;
}

// Pipeline Interfaces
export interface PipelineStage {
  id: string;
  name: string;
  candidates: Candidate[];
  color: string;
  order: number;
}

// AI Scoring
export interface CandidateJobScore {
  candidateId: string;
  jobOrderId: string;
  score: number; // 0-100
  breakdown: {
    skillsMatch: number;
    certifications: number;
    distance: number;
    availability: number;
    payExpectation: number;
    workHistory: number;
    reliability: number;
  };
  timestamp: number;
}
