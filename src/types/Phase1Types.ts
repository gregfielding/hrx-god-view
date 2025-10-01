/**
 * Phase 1 Types - Simplified structure based on phase1-groundwork.md
 * Focus on core collections: jobOrders, applications, userGroups
 */

// ============================================================================
// BASE TYPES
// ============================================================================

export interface BaseEntity {
  tenantId: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

// ============================================================================
// JOB ORDERS (Phase 1 Target Structure)
// ============================================================================

export interface JobOrder extends BaseEntity {
  id: string;
  jobOrderNumber: number; // Auto-incrementing
  jobOrderName: string; // "Forklift Operator - Vegas"
  status: 'Open' | 'On-Hold' | 'Cancelled' | 'Filled' | 'Completed';
  companyId: string; // Reference to crm_companies
  locationId?: string; // Reference to crm_companies/{companyId}/locations
  createdAt: number; // timestamp
  startDate: string; // date
  endDate?: string; // date or null
  recruiterId: string; // Reference to users
  userGroups: string[]; // Array of userGroup IDs
  
  // Additional fields for completeness
  description?: string;
  requirements?: string[];
  payRate?: number;
  billRate?: number;
  openings?: number;
  remainingOpenings?: number;
  priority?: 'Low' | 'Medium' | 'High' | 'Urgent';
  tags?: string[];
  notes?: string;
}

// ============================================================================
// APPLICATIONS (Phase 1 Target Structure)
// ============================================================================

export interface Application extends BaseEntity {
  id: string;
  candidateId: string; // Reference to users
  jobOrderId?: string; // Optional - reference to jobOrders
  jobBoardPostId?: string; // Optional - reference to jobBoardPosts
  status: 'applied' | 'interviewing' | 'background' | 'drug' | 'onboarded' | 'rejected';
  createdAt: number; // timestamp
  
  // Additional fields for completeness
  resumeUrl?: string;
  coverLetter?: string;
  source?: string; // How they found the job
  notes?: string;
  tags?: string[];
  recruiterId?: string; // Assigned recruiter
  interviewDate?: number;
  backgroundCheckDate?: number;
  drugTestDate?: number;
  onboardedDate?: number;
  rejectedDate?: number;
  rejectionReason?: string;
}

// ============================================================================
// USER GROUPS (Phase 1 Target Structure)
// ============================================================================

export interface UserGroup extends BaseEntity {
  id: string;
  groupName: string; // "Vegas Forklift Drivers"
  members: string[]; // Array of user IDs
  createdBy: string; // recruiter user ID
  createdAt: number; // timestamp
  
  // Additional fields for completeness
  description?: string;
  tags?: string[];
  isActive?: boolean;
  memberCount?: number; // Computed field
}

// ============================================================================
// JOB BOARD POSTS (Phase 1 Target Structure)
// ============================================================================

export interface JobBoardPost extends BaseEntity {
  id: string;
  title: string;
  description: string;
  location: string;
  jobOrderId?: string; // Optional - link to job order
  status: 'draft' | 'posted' | 'paused' | 'closed';
  postedAt?: number; // timestamp when posted
  expiresAt?: number; // timestamp when expires
  
  // Additional fields for completeness
  payRate?: number;
  payPeriod?: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  requirements?: string[];
  benefits?: string[];
  tags?: string[];
  createdBy: string; // recruiter user ID
}

// ============================================================================
// COLLECTION PATHS (Phase 1)
// ============================================================================

export const PHASE1_COLLECTION_PATHS = {
  // Target structure (new)
  JOB_ORDERS: 'jobOrders',
  APPLICATIONS: 'applications', 
  USER_GROUPS: 'userGroups',
  JOB_BOARD_POSTS: 'jobBoardPosts',
  
  // Existing structure (keep)
  CRM_COMPANIES: 'crm_companies',
  CRM_CONTACTS: 'crm_contacts',
  CRM_DEALS: 'crm_deals',
  USERS: 'users',
  
  // Legacy structure (to be cleaned up)
  RECRUITER_JOB_ORDERS: 'recruiter_jobOrders',
  RECRUITER_APPLICATIONS: 'recruiter_applications',
  RECRUITER_CANDIDATES: 'recruiter_candidates',
  RECRUITER_ASSIGNMENTS: 'recruiter_assignments',
  RECRUITER_JOBS_BOARD_POSTS: 'recruiter_jobsBoardPosts',
} as const;

// ============================================================================
// PHASE 1 SPECIFIC TYPES
// ============================================================================

export type JobOrderStatus = JobOrder['status'];
export type ApplicationStatus = Application['status'];
export type JobBoardPostStatus = JobBoardPost['status'];

export interface Phase1CollectionInfo {
  name: string;
  path: string;
  isTarget: boolean; // Is this the target structure?
  isLegacy: boolean; // Is this legacy to be removed?
  documentCount: number;
  issues: string[];
}

export interface Phase1CleanupPlan {
  tenantId: string;
  collectionsToRemove: string[];
  collectionsToMigrate: {
    from: string;
    to: string;
    documentCount: number;
  }[];
  newCollectionsToCreate: string[];
  estimatedDocumentsToMove: number;
}
