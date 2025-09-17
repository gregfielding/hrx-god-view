import { FieldValue } from 'firebase/firestore';

export interface JobOrder {
  id: string;
  jobOrderSeq: number; // Raw auto-increment per tenant
  jobOrderNumber: string; // Formatted number (e.g., "JO-0001")
  jobOrderName: string;
  jobOrderDescription?: string;
  status: JobOrderStatus;
  tenantId: string;
  startDate?: Date;
  endDate?: Date;
  dateOpened: Date | FieldValue;
  poNumber?: string;
  
  // Company / Worksite
  companyId: string;
  companyName: string;
  companyContacts: JobOrderContact[];
  worksiteId: string;
  worksiteName: string;
  worksiteAddress: Address;
  
  // Job Details
  jobTitle: string;
  jobDescription?: string;
  uniformRequirements?: string;
  assignedRecruiters: string[]; // User IDs
  payRate: number;
  billRate: number;
  workersNeeded: number;
  headcountRequested: number; // Default: 0
  headcountFilled: number; // Default: 0
  workersCompCode?: string;
  workersCompRate?: number;
  checkInInstructions?: string;
  timesheetCollectionMethod: TimesheetMethod;
  
  // Jobs Board Options
  jobsBoardVisibility: JobsBoardVisibility;
  visibility: JobsBoardVisibility; // Alias for consistency
  showPayRate: boolean;
  showStartDate: boolean;
  showShiftTimes: boolean;
  restrictedGroups?: string[]; // Group IDs for visibility
  
  // Requirements
  requiredLicenses: string[];
  requiredCertifications: string[];
  drugScreenRequired: boolean;
  backgroundCheckRequired: boolean;
  experienceRequired?: string;
  educationRequired?: string;
  languagesRequired?: string[];
  skillsRequired?: string[];
  physicalRequirements?: string;
  ppeRequirements?: string;
  ppeProvidedBy: 'company' | 'worker' | 'both';
  additionalTrainingRequired?: string;
  
  // Context & Notes
  competingAgencies?: {
    count: number;
    satisfaction: 'high' | 'medium' | 'low';
    mistakesToAvoid?: string;
  };
  customerSpecificRules?: {
    attendance: string;
    noShows: string;
    overtime: string;
    callOffs: string;
    injuryHandling: string;
  };
  internalNotes?: string;
  
  // Onboarding
  onboardingRequirements?: string[];
  
  // Metadata
  createdBy: string;
  createdAt: Date | FieldValue;
  updatedAt: Date | FieldValue;
  dealId?: string; // Link back to originating CRM deal
}

export interface JobOrderContact {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role: 'hiring_manager' | 'supervisor' | 'hr_contact' | 'safety_contact' | 'other';
  notes?: string;
  worksites?: Array<{
    id: string;
    name: string;
  }>;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
}

export type JobOrderStatus = 'draft' | 'open' | 'on_hold' | 'cancelled' | 'filled' | 'completed';

export type TimesheetMethod = 'app_clock_in_out' | 'physical_sign_in' | 'supervisor_approval' | 'other';

export type JobsBoardVisibility = 'hidden' | 'public' | 'group_restricted';

export interface JobOrderFormData {
  // Core fields
  jobOrderName: string;
  jobOrderDescription?: string;
  status: JobOrderStatus;
  startDate?: Date;
  endDate?: Date;
  poNumber?: string;
  
  // Company / Worksite
  companyId: string;
  companyName: string;
  companyContacts: JobOrderContact[];
  worksiteId: string;
  worksiteName: string;
  worksiteAddress: Address;
  
  // Job Details
  jobTitle: string;
  jobDescription?: string;
  uniformRequirements?: string;
  assignedRecruiters: string[];
  payRate: number;
  billRate: number;
  workersNeeded: number;
  headcountRequested?: number; // Optional in form, defaults to 0
  headcountFilled?: number; // Optional in form, defaults to 0
  workersCompCode?: string;
  workersCompRate?: number;
  checkInInstructions?: string;
  timesheetCollectionMethod: TimesheetMethod;
  
  // Jobs Board Options
  jobsBoardVisibility: JobsBoardVisibility;
  visibility?: JobsBoardVisibility; // Optional in form, defaults to 'hidden'
  showPayRate: boolean;
  showStartDate: boolean;
  showShiftTimes: boolean;
  restrictedGroups?: string[];
  
  // Requirements
  requiredLicenses: string[];
  requiredCertifications: string[];
  drugScreenRequired: boolean;
  backgroundCheckRequired: boolean;
  experienceRequired?: string;
  educationRequired?: string;
  languagesRequired?: string[];
  skillsRequired?: string[];
  physicalRequirements?: string;
  ppeRequirements?: string;
  ppeProvidedBy: 'company' | 'worker' | 'both';
  additionalTrainingRequired?: string;
  
  // Context & Notes
  competingAgencies?: {
    count: number;
    satisfaction: 'high' | 'medium' | 'low';
    mistakesToAvoid?: string;
  };
  customerSpecificRules?: {
    attendance: string;
    noShows: string;
    overtime: string;
    callOffs: string;
    injuryHandling: string;
  };
  internalNotes?: string;
  
  // Onboarding
  onboardingRequirements?: string[];
}

// Application → Candidate → Employee Pipeline
export interface JobApplication {
  id: string;
  jobOrderId: string;
  applicantId: string;
  applicantName: string;
  applicantEmail: string;
  applicantPhone?: string;
  status: ApplicationStatus;
  appliedAt: Date;
  notes?: string;
  recruiterNotes?: string;
  screeningScore?: number;
  tenantId: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Candidate {
  id: string;
  applicationId: string;
  jobOrderId: string;
  applicantId: string;
  status: CandidateStatus;
  backgroundCheckStatus?: BackgroundCheckStatus;
  drugScreenStatus?: DrugScreenStatus;
  onboardingStatus?: OnboardingStatus;
  assignedAt: Date;
  notes?: string;
  tenantId: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Employee {
  id: string;
  candidateId: string;
  jobOrderId: string;
  employeeNumber: string; // Auto-generated
  status: EmployeeStatus;
  startDate: Date;
  endDate?: Date;
  jobTitle: string;
  worksiteId: string;
  supervisorId?: string;
  payRate: number;
  billRate: number;
  tenantId: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ApplicationStatus = 'applied' | 'screening' | 'interviewed' | 'rejected' | 'selected' | 'withdrawn';
export type CandidateStatus = 'selected' | 'background_check' | 'drug_screen' | 'onboarding' | 'ready' | 'rejected' | 'withdrawn';
export type BackgroundCheckStatus = 'not_required' | 'pending' | 'in_progress' | 'passed' | 'failed' | 'expired';
export type DrugScreenStatus = 'not_required' | 'pending' | 'in_progress' | 'passed' | 'failed' | 'expired';
export type OnboardingStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type EmployeeStatus = 'active' | 'inactive' | 'terminated' | 'on_leave';
