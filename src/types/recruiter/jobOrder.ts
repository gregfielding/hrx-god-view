import { FieldValue } from 'firebase/firestore';

export interface JobOrder {
  id: string;
  jobOrderSeq: number; // Raw auto-increment per tenant
  jobOrderNumber: string; // Formatted number (e.g., "0001")
  jobOrderName: string;
  jobOrderDescription?: string;
  status: JobOrderStatus;
  jobType?: 'gig' | 'career'; // Job type for determining if it's a gig or career position
  tenantId: string;
  startDate?: Date;
  endDate?: Date;
  createdAt: Date | FieldValue;
  updatedAt: Date | FieldValue;
  poNumber?: string;
  /** Gig job orders: preliminary total event budget ($) from Financials section */
  gigEstimatedValue?: number;
  /** Gig job orders: blended average markup % for preliminary budgeting */
  gigAverageMarkup?: number;
  /** Gig: estimated event start (YYYY-MM-DD) */
  gigEstimatedStartDate?: string | null;
  /** Gig: estimated event end (YYYY-MM-DD) */
  gigEstimatedEndDate?: string | null;
  
  // Deal data - unified structure
  deal?: any; // The complete deal data structure
  
  // Company / Worksite
  companyId: string;
  companyName: string;
  /** Hiring Entity (Employer of Record). E-Verify and onboarding flow come from this entity; set when creating from an account. */
  hiringEntityId?: string | null;
  companyContacts: JobOrderContact[];
  worksiteId: string;
  worksiteName: string;
  worksiteAddress: Address;

  /** Account (sub or standalone CRM company) UID for lookup; equals companyId. */
  accountId?: string;
  /** Parent/national account UID when this account is a child. */
  parentAccountId?: string | null;
  /** Location/worksite UID for lookup; equals worksiteId. */
  locationId?: string;
  /** Account display name (quick lookup). */
  accountName?: string;
  /** Parent account display name (quick lookup). */
  parentAccountName?: string | null;
  /** Location display name (quick lookup). */
  locationName?: string;
  
  // Job Details
  jobTitle: string;
  jobDescription?: string;
  uniformRequirements?: string;
  assignedRecruiters: string[]; // User IDs
  indeedUrl?: string; // External job posting links
  craigslistUrl?: string;
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

  /** Job Score: requirement pack id for eligibility + fit (e.g. warehouse_w2, general_labor_1099, nursing_w2) */
  requirementPackId?: string;

  /** AccuSource screening package (provider id + display name from synced catalog). Merges with account/location orderDefaults in mergeScreeningPackageFromLayers. */
  screeningPackageId?: string;
  screeningPackageName?: string;
  
  // 🆕 Deal Conversion Fields - Discovery Stage
  currentStaffCount?: number;
  currentAgencyCount?: number;
  currentSatisfactionLevel?: 'very_happy' | 'somewhat' | 'frustrated';
  currentStruggles?: string[];
  hasUsedAgenciesBefore?: boolean;
  lastAgencyUsed?: string;
  reasonStoppedUsingAgencies?: string;
  openToUsingAgenciesAgain?: boolean;
  additionalJobTitles?: string[];
  shiftTimes?: string[];
  employmentType?: 'seasonal' | 'year_round';
  onsiteSupervisionRequired?: boolean;
  
  // 🆕 Deal Conversion Fields - Qualification Stage
  mustHaveRequirements?: string;
  mustAvoidRequirements?: string;
  potentialObstacles?: string[];
  expectedStartDate?: string;
  initialHeadcount?: number;
  headcountAfter30Days?: number;
  headcountAfter90Days?: number;
  headcountAfter180Days?: number;
  expectedPayRate?: number;
  expectedMarkup?: number;
  
  // 🆕 Deal Conversion Fields - Scoping Stage
  replacingExistingAgency?: boolean;
  rolloverExistingStaff?: boolean;
  backgroundCheckPackages?: string[];
  drugScreeningPanels?: string[];
  additionalScreenings?: string[];
  eVerifyRequired?: boolean;
  dressCode?: string;
  timeclockSystem?: string;
  disciplinePolicy?: string;
  poRequired?: boolean;
  paymentTerms?: string;
  invoiceDeliveryMethod?: 'email' | 'portal' | 'mail';
  invoiceFrequency?: 'weekly' | 'biweekly' | 'monthly';
  rolloverStaff?: Array<{
    howMany: number;
    fromAgency: string;
    positions: string;
    markupPercent: number;
  }>;
  
  // 🆕 Deal Conversion Fields - Verbal Agreement Stage
  verbalAgreementContact?: string;
  verbalAgreementDate?: string;
  verbalAgreementMethod?: 'phone' | 'email' | 'in_person' | 'other';
  conditionsToFulfill?: string[];
  approvalsNeeded?: string[];
  insuranceSubmitted?: boolean;
  
  // 🆕 Deal Conversion Fields - Closed Won Stage
  contractSignedDate?: string;
  contractExpirationDate?: string;
  rateSheetOnFile?: boolean;
  msaSigned?: boolean;
  
  // 🆕 Financial Fields
  estimatedRevenue?: number;
  
  // Metadata
  createdBy: string;
  dealId?: string; // Link back to originating CRM deal

  // Placements tab: last workforce group selected via "Choose Group" (for quick re-select)
  placementsLastGroup?: { id: string; groupName: string };
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
  /** Account (sub/standalone) and parent/location for lookup (optional in form). */
  accountId?: string;
  parentAccountId?: string | null;
  locationId?: string;
  accountName?: string;
  parentAccountName?: string | null;
  locationName?: string;

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
