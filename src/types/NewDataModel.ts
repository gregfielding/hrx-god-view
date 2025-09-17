/**
 * New Data Model Types for Phase 1
 * Following the principle: Only two top-level collections (tenants, users)
 * Everything else lives under tenants/{tenantId}
 */

// ============================================================================
// BASE TYPES
// ============================================================================

export interface BaseEntity {
  id: string;
  tenantId: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

export interface BaseEntityWithName extends BaseEntity {
  name: string;
}

// ============================================================================
// ACCOUNTS (was crm_companies)
// ============================================================================

export interface Account extends BaseEntityWithName {
  // Core Information
  companyName: string; // Alias for name, for backward compatibility
  status: 'lead' | 'qualified' | 'active' | 'inactive' | 'lost';
  industry: string;
  tier: 'A' | 'B' | 'C';
  tags: string[];
  
  // Contact Information
  address: string;
  city: string;
  state: string;
  zipcode: string;
  country: string;
  phone: string;
  website: string;
  linkedInUrl?: string;
  
  // Location Data
  latitude?: number;
  longitude?: number;
  
  // Business Information
  notes: string;
  source: string;
  externalId?: string; // For external system integration
  
  // Legacy CRM Fields (for migration)
  salesOwnerId?: string;
  salesOwnerName?: string;
  salesOwnerRef?: string;
  freshsalesId?: string;
  
  // Enhanced Company Structure
  companyStructure?: {
    parentId?: string; // Reference to parent company
    locationType: 'headquarters' | 'facility' | 'branch' | 'regional_office';
    region?: string;
    msaSigned?: boolean;
    nationalAccountId?: string;
    assignedRep?: string;
    facilityCode?: string;
    headcount?: number;
    isUnionized?: boolean;
    hasTempLaborExperience?: boolean;
    workforceModel?: 'full_time' | 'flex' | 'outsourced' | 'mixed';
  };
  
  // Deal Intelligence
  dealIntelligence?: {
    complexityScore?: number; // 1-10 scale
    urgencyLevel?: 'low' | 'medium' | 'high' | 'critical';
    painPoints?: string[];
    decisionMakers?: string[]; // Contact IDs
    influencers?: string[]; // Contact IDs
    blockers?: string[]; // Contact IDs
    competitiveVendors?: string[];
    complianceRequirements?: string[];
    implementationTimeline?: number; // Days
    estimatedValue?: number;
    effortToRewardRatio?: number;
  };
  
  // Association Metadata
  associationCounts?: {
    contacts: number;
    locations: number;
    deals: number;
    jobOrders: number;
  };
}

// ============================================================================
// CONTACTS (moved from crm_contacts)
// ============================================================================

export interface Contact extends BaseEntity {
  // Core Information
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  title: string;
  
  // Relationships
  accountId: string; // Reference to Account
  role: 'decision_maker' | 'influencer' | 'finance' | 'operations' | 'hr' | 'other';
  status: 'active' | 'inactive';
  
  // Location Association
  locationId?: string; // Reference to Account location
  
  // Additional Information
  tags: string[];
  notes: string;
  
  // Legacy CRM Fields
  salesOwnerId?: string;
  salesOwnerName?: string;
  salesOwnerRef?: string;
  freshsalesId?: string;
  
  // Enhanced Contact Profile
  contactProfile?: {
    dealRole: 'decision_maker' | 'recommender' | 'observer' | 'blocker' | 'champion';
    influence: 'low' | 'medium' | 'high';
    personality: 'dominant' | 'analytical' | 'amiable' | 'expressive';
    contactMethod: 'email' | 'phone' | 'in_person' | 'linkedin';
    isContractSigner: boolean;
    isDecisionInfluencer: boolean;
    isImplementationResponsible: boolean;
    
    relationshipStage: 'cold' | 'warm' | 'hot' | 'advocate';
    lastContactDate?: number;
    preferredContactTime?: string;
    communicationStyle?: 'formal' | 'casual' | 'technical' | 'relationship_focused';
    
    department?: string;
    division?: string;
    location?: string;
    reportingTo?: string; // Contact ID
    directReports?: string[]; // Contact IDs
    
    dealNotes?: string;
    objections?: string[];
    interests?: string[];
    painPoints?: string[];
  };
  
  // Association Metadata
  associationCounts?: {
    deals: number;
    locations: number;
    jobOrders: number;
  };
}

// ============================================================================
// LOCATIONS (keep as-is, under accounts)
// ============================================================================

export interface Location extends BaseEntityWithName {
  accountId: string; // Reference to Account
  
  // Address Information
  address: string;
  city: string;
  state: string;
  zipcode: string;
  country: string;
  
  // Contact Information
  phone?: string;
  email?: string;
  
  // Location Data
  latitude?: number;
  longitude?: number;
  
  // Business Information
  locationType: 'headquarters' | 'facility' | 'branch' | 'regional_office';
  headcount?: number;
  isUnionized?: boolean;
  facilityCode?: string;
  
  // Additional Information
  notes?: string;
  tags?: string[];
}

// ============================================================================
// JOB ORDERS (AUTHORITATIVE)
// ============================================================================

export interface JobOrder extends BaseEntityWithName {
  // Core Information
  title: string; // Alias for name
  accountId: string; // Reference to Account (denormalized)
  locationId?: string; // Reference to Account location
  
  // Job Details
  roleCategory?: string;
  openings: number;
  remainingOpenings: number;
  
  // Timeline
  startDate: string; // ISO date string
  endDate?: string; // ISO date string
  targetFillDate?: string; // ISO date string
  
  // Work Details
  shifts: Shift[];
  
  // Compensation
  payRate: number;
  billRate?: number;
  markup?: number;
  otRules: OTRules;
  
  // Requirements
  backgroundCheck: BackgroundCheck;
  drugTest: DrugTest;
  language: string[];
  minExperience?: number;
  certifications: string[];
  dressCode?: string;
  
  // Operations
  priority: 'low' | 'medium' | 'high' | 'urgent';
  urgencyScore: number; // 0-100, AI-calculated
  recruiterOwnerId: string;
  teamIds: string[];
  
  // Jobs Board
  autoPostToJobsBoard: boolean;
  submittalLimit: number;
  internalOnly: boolean;
  allowOverfill: boolean;
  
  // Status & Lifecycle
  status: 'draft' | 'open' | 'interviewing' | 'offer' | 'partially_filled' | 'filled' | 'closed' | 'canceled';
  
  // Additional Information
  notes?: string;
  tags?: string[];
  
  // Metrics (denormalized)
  metrics: JobOrderMetrics;
  
  // Legacy Fields (for migration)
  crmCompanyId?: string; // Reference to old CRM company
  crmDealId?: string; // Reference to CRM deal
  worksiteId?: string; // Legacy worksite reference
}

// ============================================================================
// CANDIDATES (talent pool)
// ============================================================================

export interface Candidate extends BaseEntity {
  // Core Information
  firstName: string;
  lastName: string;
  fullName: string; // Computed field
  email: string;
  phone?: string;
  
  // Professional Information
  title?: string;
  experience?: number; // Years
  skills: string[];
  certifications: string[];
  languages: string[];
  
  // Work Authorization
  workAuth: 'citizen' | 'permanent_resident' | 'work_visa' | 'student_visa' | 'other';
  
  // Availability
  availability: 'immediate' | '2_weeks' | '1_month' | '3_months' | 'flexible';
  preferredShifts: string[];
  preferredLocations: string[];
  
  // Contact Information
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  
  // Documents
  resumeUrl?: string;
  coverLetterUrl?: string;
  
  // Status
  status: 'active' | 'inactive' | 'placed' | 'blacklisted';
  
  // Additional Information
  notes?: string;
  tags?: string[];
  source?: string;
  
  // Metrics
  metrics: CandidateMetrics;
}

// ============================================================================
// JOB BOARD POSTS
// ============================================================================

export interface JobBoardPost extends BaseEntityWithName {
  // Core Information
  title: string; // Alias for name
  description: string;
  location: string;
  
  // Mode
  mode: 'linked' | 'evergreen';
  jobOrderId?: string; // Required for linked mode
  
  // Compensation
  payRate: number;
  payPeriod: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  billRate?: number;
  billPeriod?: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  
  // Visibility & Status
  visibility: 'public' | 'private' | 'internal';
  status: 'draft' | 'posted' | 'paused' | 'closed';
  
  // Channels
  channels: string[]; // Where the post is published
  
  // Screening
  screeningQuestions: ScreeningQuestion[];
  
  // Timeline
  postedAt?: number;
  expiresAt?: number;
  
  // Additional Information
  tags?: string[];
  notes?: string;
  
  // Metrics
  metrics: JobBoardPostMetrics;
}

// ============================================================================
// APPLICATIONS (tenant-level authoritative)
// ============================================================================

export interface Application extends BaseEntity {
  // Core Information
  mode: 'linked' | 'evergreen';
  jobOrderId?: string; // For linked applications
  postId: string; // Reference to JobBoardPost
  candidateId?: string; // If candidate exists in system
  
  // Applicant Data
  applicantData: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    resumeUrl?: string;
    coverLetter?: string;
    [key: string]: unknown;
  };
  
  // Application Details
  answers: ApplicationAnswer[];
  workAuth: 'citizen' | 'permanent_resident' | 'work_visa' | 'student_visa' | 'other';
  availability: 'immediate' | '2_weeks' | '1_month' | '3_months' | 'flexible';
  
  // Source & Tracking
  source: 'QR' | 'URL' | 'referral' | 'Companion' | 'Indeed' | 'LinkedIn';
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  };
  referralCode?: string;
  consents: string[];
  
  // Status & Workflow
  status: 'new' | 'screened' | 'advanced' | 'interview' | 'offer_pending' | 'hired' | 'rejected' | 'withdrawn';
  
  // AI Analysis
  aiScore?: number;
  aiRecommendations?: string[];
  aiRiskFactors?: string[];
  
  // Timestamps
  screenedAt?: number;
  advancedAt?: number;
  interviewedAt?: number;
  hiredAt?: number;
  rejectedAt?: number;
  withdrawnAt?: number;
  
  // Additional Information
  notes?: string;
  tags?: string[];
  
  // Metrics
  metrics: ApplicationMetrics;
}

// ============================================================================
// ASSIGNMENTS (tenant-level authoritative)
// ============================================================================

export interface Assignment extends BaseEntity {
  // Core Information
  jobOrderId: string; // Reference to JobOrder
  candidateId: string; // Reference to Candidate
  applicationId?: string; // Reference to Application (if from application)
  
  // Assignment Details
  startDate: string; // ISO date string
  endDate?: string; // ISO date string
  payRate: number;
  billRate?: number;
  
  // Status
  status: 'pending' | 'active' | 'completed' | 'terminated' | 'cancelled';
  
  // Work Details
  hoursWorked?: number;
  totalEarnings?: number;
  
  // Additional Information
  notes?: string;
  tags?: string[];
  
  // Metrics
  metrics: AssignmentMetrics;
}

// ============================================================================
// USER GROUPS
// ============================================================================

export interface UserGroup extends BaseEntityWithName {
  description?: string;
  type: 'manual' | 'auto' | 'smart';
  
  // Group Configuration
  criteria?: {
    skills?: string[];
    experience?: {
      min?: number;
      max?: number;
    };
    location?: string[];
    status?: string[];
    tags?: string[];
  };
  
  // Members
  memberIds: string[]; // Candidate IDs
  
  // Additional Information
  tags?: string[];
  notes?: string;
}

// ============================================================================
// TASKS
// ============================================================================

export interface Task extends BaseEntity {
  // Core Information
  title: string;
  description?: string;
  type: 'todo' | 'appointment';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  
  // Time Fields
  scheduledDate: string; // Date only (YYYY-MM-DD)
  startTime?: string; // ISO string for appointments
  endTime?: string; // Calculated from startTime + duration
  duration?: number; // Duration in minutes
  dueDate?: string;
  
  // Assignment
  assignedTo: string;
  assignedToName?: string; // Optimized field
  createdBy: string;
  createdByName?: string; // Optimized field
  
  // Associations
  associations?: {
    accounts?: string[];
    contacts?: string[];
    jobOrders?: string[];
    candidates?: string[];
    applications?: string[];
    assignments?: string[];
    relatedTo?: {
      type: 'account' | 'contact' | 'jobOrder' | 'candidate' | 'application' | 'assignment';
      id: string;
    };
    relatedToName?: string; // Optimized field
  };
  
  // Additional Information
  tags?: string[];
  notes?: string;
  reason?: string;
  
  // AI Fields
  aiSuggested?: boolean;
  aiPrompt?: string;
  aiRecommendations?: string;
  aiGenerated?: boolean;
  aiReason?: string;
  aiConfidence?: number;
  aiContext?: any;
  
  // Google Integration
  googleCalendarEventId?: string;
  googleTaskId?: string;
  lastGoogleSync?: string;
  syncStatus?: 'pending' | 'synced' | 'failed';
  googleMeetLink?: string;
  googleMeetConferenceId?: string;
  meetingAttendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  }>;
  
  // Task-specific fields
  agenda?: string; // For meetings
  goals?: string[];
  outcomes?: string[];
  followUpRequired?: boolean;
  followUpDate?: string;
}

// ============================================================================
// COUNTERS
// ============================================================================

export interface Counter extends BaseEntity {
  counterId: string; // e.g., 'jobOrderNumber', 'applicationNumber'
  next: number;
  prefix?: string; // e.g., 'JO-', 'APP-'
  suffix?: string;
  padding?: number; // e.g., 4 for '0001'
  
  // Additional Information
  description?: string;
  lastUsed?: number;
}

// ============================================================================
// SUPPORTING TYPES
// ============================================================================

export interface Shift {
  label: string;
  start: string; // HH:mm format
  end: string; // HH:mm format
  days: number[]; // 0-6 for Sunday-Saturday
  breakMinutes: number;
  differential?: number;
}

export interface OTRules {
  multiplier: number;
  threshold: number;
  cap?: number;
}

export interface BackgroundCheck {
  required: boolean;
  package?: string;
  vendor?: string;
}

export interface DrugTest {
  required: boolean;
  panel?: string;
  vendor?: string;
}

export interface ScreeningQuestion {
  id: string;
  question: string;
  type: 'text' | 'yesno' | 'multiselect' | 'number' | 'file';
  required: boolean;
  options?: string[]; // For multiselect
  min?: number; // For number type
  max?: number; // For number type
  regex?: string; // For text validation
  conditional?: {
    dependsOn: string; // Question ID
    value: any; // Required value
  };
}

export interface ApplicationAnswer {
  questionId: string;
  question: string;
  answer: string | string[] | number;
  type: 'text' | 'yesno' | 'multiselect' | 'number' | 'file';
}

// ============================================================================
// METRICS TYPES
// ============================================================================

export interface JobOrderMetrics {
  submittals: number;
  interviews: number;
  offers: number;
  placements: number;
  timeToFirstSubmittalHrs?: number;
  timeToFillDays?: number;
  jobAgingDays: number;
}

export interface CandidateMetrics {
  applications: number;
  interviews: number;
  offers: number;
  placements: number;
  lastActivity?: number;
}

export interface JobBoardPostMetrics {
  views: number;
  applications: number;
  conversionRate: number;
  lastActivity?: number;
}

export interface ApplicationMetrics {
  timeToScreen?: number; // Hours
  timeToInterview?: number; // Hours
  timeToOffer?: number; // Hours
  timeToHire?: number; // Hours
}

export interface AssignmentMetrics {
  hoursWorked: number;
  totalEarnings: number;
  performanceScore?: number;
  lastActivity?: number;
}

// ============================================================================
// COLLECTION PATHS
// ============================================================================

export const COLLECTION_PATHS = {
  ACCOUNTS: 'accounts',
  CONTACTS: 'contacts',
  LOCATIONS: 'locations',
  JOB_ORDERS: 'jobOrders',
  CANDIDATES: 'candidates',
  JOB_BOARD_POSTS: 'jobBoardPosts',
  APPLICATIONS: 'applications',
  ASSIGNMENTS: 'assignments',
  USER_GROUPS: 'userGroups',
  TASKS: 'tasks',
  COUNTERS: 'counters',
} as const;

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type CollectionName = keyof typeof COLLECTION_PATHS;
export type EntityType = 
  | 'Account' 
  | 'Contact' 
  | 'Location' 
  | 'JobOrder' 
  | 'Candidate' 
  | 'JobBoardPost' 
  | 'Application' 
  | 'Assignment' 
  | 'UserGroup' 
  | 'Task' 
  | 'Counter';

export type Entity = 
  | Account 
  | Contact 
  | Location 
  | JobOrder 
  | Candidate 
  | JobBoardPost 
  | Application 
  | Assignment 
  | UserGroup 
  | Task 
  | Counter;
