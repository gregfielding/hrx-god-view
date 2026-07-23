import { FieldValue } from 'firebase/firestore';

import type { ApplicationHiringLifecycle } from '../applicationHiringLifecycle';

export interface JobOrder {
  id: string;
  jobOrderSeq: number; // Raw auto-increment per tenant
  // Stored as a NUMBER since the 2026-07-08 normalization (Firestore
  // orders by type, so mixed values broke sorting); `string` remains in
  // the union for any un-migrated cache/snapshot. Display code pads it
  // ("#0001") via formatJobOrderNumber-style helpers.
  jobOrderNumber: number | string;
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
  /** Recruiter client account (`tenants/{tid}/accounts/{id}`). Used for Account → Job Orders (especially child/sub-accounts). */
  recruiterAccountId?: string | null;

  /** CRM contact id for decision maker (Company Contacts on job order form). */
  decisionMaker?: string;

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

  /** Gig / Careers: notify these user groups (SMS + push) when new shifts are posted; 15 min cooldown per recipient. */
  autoMessagingUserGroupIds?: string[];

  /** When true, placement flows skip outbound worker notifications for this job order. */
  muted?: boolean;

  // Jobs Board Options
  jobsBoardVisibility: JobsBoardVisibility;
  visibility: JobsBoardVisibility; // Alias for consistency
  showPayRate: boolean;
  showStartDate: boolean;
  showShiftTimes: boolean;
  restrictedGroups?: string[]; // Group IDs for visibility
  /**
   * Per-JO Auto-Add to User Groups (May 2026). Recruiter picks
   * groups once on the JO and the post-creation cascade
   * (`JobsBoardService.createPostsForGigJobOrderPositions`) seeds
   * each new posting with the same list. Independent of
   * `autoCreatedUserGroupId` (the National Account auto-group). The
   * cascade union-merges these arrays so a posting always inherits
   * both signals.
   */
  autoAddToUserGroups?: string[];

  // Requirements
  requiredLicenses: string[];
  requiredCertifications: string[];
  /**
   * Optional: `worker_compliance_items` doc ids for job-required certs (matches `cert_*` suffix in readiness snapshots).
   * @see `placementQualificationChipsModel` / docs when added to Firestore.
   */
  requiredCertificationComplianceIds?: string[];
  drugScreenRequired: boolean;
  backgroundCheckRequired: boolean;
  experienceRequired?: string;
  educationRequired?: string;
  languagesRequired?: string[];
  skillsRequired?: string[];
  // 🆕 Typed schema additions (Phase B — job requirement matchers).
  // Supersede the freeform fields above. Matchers read these first, falling
  // back to the legacy fields via the parsers in shared/. Both coexist during
  // migration. See docs/READINESS_EXECUTION_MATRIX.md §4.2, §4.4, §4.5.
  /** Minimum required education level (typed). Supersedes the freeform `educationRequired`. */
  educationLevelRequiredV2?: import('../../shared/educationLevel').EducationLevel;
  /** Languages required, with minimum proficiency per language. Supersedes `languagesRequired: string[]`. */
  languagesRequiredV2?: import('../../shared/languageProficiency').RequiredLanguageV1[];
  /** Required licenses with class + required endorsements. Supersedes `requiredLicenses: string[]`. */
  requiredLicensesV2?: import('../../shared/licenseRecord').RequiredLicenseV1[];
  /**
   * **R.1 (D4.R1, Q-R1-1)** — Per-skill severity overrides for the
   * `skillsRequired` parallel string array. Keyed by the same slug used to
   * build the `skill_match` readiness item (`slugify(skill)`). When absent,
   * skill items fall through to `requirementSeverityOverrides.skill_match`
   * then to the `'soft'` type default.
   *
   * Why parallel-map (not migrating `skillsRequired` to objects): keeps every
   * existing read site of `skillsRequired: string[]` working untouched and
   * confines the override surface to the matcher seed path.
   */
  skillsRequiredSeverityOverrides?: Record<string, 'hard' | 'soft'>;
  /**
   * **R.1 (D4.R1)** — Per-requirement-type severity overrides for the
   * singletons that have no per-instance severity slot (e.g. `e_verify`,
   * `background_check`, `drug_screen`, `screening_package_match`,
   * `safety_briefing`, `orientation`, `ppe_acknowledgement`,
   * `shift_confirmation`, `education_match`). The seeder's resolution chain
   * is per-instance → this map → type default.
   *
   * Cert / license / language requirements expose `severity` on their own
   * per-instance schemas (`Phase1CertificationRequirement`, `RequiredLicenseV1`,
   * `RequiredLanguageV1`); this map still applies as a fallback when none of
   * the instances on a JO declare it.
   */
  requirementSeverityOverrides?: Partial<
    Record<
      import('../../shared/assignmentReadinessItemV1').AssignmentReadinessRequirementType,
      'hard' | 'soft'
    >
  >;
  physicalRequirements?: string;
  ppeRequirements?: string;
  ppeProvidedBy: 'company' | 'worker' | 'both';
  /**
   * @deprecated R.0d (Apr 2026) — soft-deprecated by the Readiness Rebuild.
   * No new writes; existing data is preserved. Read sites continue to render
   * for legacy JOs but receive an IDE strikethrough as a refactor signal.
   * See `docs/READINESS_R0_HANDOFF.md`.
   */
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
  /**
   * @deprecated R.0d (Apr 2026) — soft-deprecated by the Readiness Rebuild.
   * Subsumed by Everee employee-readiness layer. No new writes; existing data
   * is preserved. See `docs/READINESS_R0_HANDOFF.md`.
   */
  onboardingRequirements?: string[];

  /** Job Score: requirement pack id for eligibility + fit (e.g. warehouse_w2, general_labor_1099, nursing_w2) */
  requirementPackId?: string;

  /** AccuSource screening package (provider id + display name from synced catalog). Merges with account/location orderDefaults in mergeScreeningPackageFromLayers. */
  screeningPackageId?: string;
  screeningPackageName?: string;
  /**
   * **R.10** — JobOrder-level override for the background-check expiry
   * threshold (days). Beats both Location and Account overrides in the
   * cascade. When unset, falls through to `location_defaults.orderDefaults.screeningValidityDays`,
   * then `account.orderDefaults.screeningValidityDays`, then
   * `DEFAULT_SCREENING_VALIDITY_DAYS` (365). Top-level (not nested under
   * `orderDefaults`) to match how `screeningPackageId` is exposed on JOs.
   * See `docs/READINESS_R10_HANDOFF.md` L4.R10.
   */
  screeningValidityDays?: number;
  /** Gig jobs board: when true, public post lists catalog services for the selected package. */
  showScreeningPackageOnPost?: boolean;
  screeningPackageServiceNames?: string[];
  
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
  /**
   * @deprecated R.0d (Apr 2026) — soft-deprecated by the Readiness Rebuild.
   * Subsumed by AccuSource `screeningPackageId` + `additionalScreenings`. No
   * new writes; existing data is preserved. See `docs/READINESS_R0_HANDOFF.md`.
   */
  drugScreeningPanels?: string[];
  additionalScreenings?: string[];
  eVerifyRequired?: boolean;
  /** Uniform requirement library selections (multi-select); may be string in legacy data. */
  dressCode?: string | string[];
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

  /**
   * Hiring workflow config (container overrides tenant `hiringConfig` in Cloud Functions).
   * Interview slice is merged in `aiHiringPolicyResolution.ts`.
   */
  hiringConfig?: HiringConfig;

  /** Job-order AI hiring overrides (merged with tenant `aiHiring`). Edited in Job Order → Hiring tab. */
  aiHiring?: Record<string, unknown>;

  /**
   * When true, Cloud Functions treat automation as off for this job order (phase 6 / auto-advance / gig fallback),
   * regardless of tenant defaults. Set from the hiring control panel until launch.
   */
  hiringAutomationPaused?: boolean;

  // Placements tab: last workforce group selected via "Choose Group" (for quick re-select)
  placementsLastGroup?: { id: string; groupName: string };

  /**
   * §16.1 propagation-policy snapshot. Populated by
   * `onJobOrderStatusTransitionSnapshot` at the first draft→active
   * transition (and by the `backfillJoSnapshotFields` migration for
   * pre-§16.1 active JOs). Shape: see `JobOrderSnapshot` below.
   *
   * Reads of any snapshot-policy field on a non-draft JO should
   * prefer `snapshot.{field}` over the cascade-resolved value via
   * `getEffectiveJobOrderField()`. The slice as shipped does NOT
   * rewire production editors — see `docs/CASCADE_PROPAGATION_R16.1_HANDOFF.md`
   * §L2 for the consumer-rewire follow-up plan.
   */
  snapshot?: JobOrderSnapshot | null;
}

/**
 * §16.1 — frozen-at-activation envelope on the JO doc.
 *
 * One snapshot is captured at the first transition out of `draft`
 * (excluding `cancelled` — see §16.1 L6). The snapshot is one-shot:
 * subsequent draft↔active oscillations do not re-resolve. The only
 * post-snapshot mutation paths are the Push-to-Active callable (an
 * admin action with audit trail) and a forced backfill re-run
 * (admin-only, audit-logged).
 *
 * Field set is the union of all top-level `snapshot-on-activation`
 * registry entries (see `src/shared/cascade/registry.ts`). The
 * `positions` blob carries the resolved+filtered (by
 * `selectedPositionIds`) positions list with every position's
 * sub-fields included.
 */
export interface JobOrderSnapshot {
  /** Idempotency key — first-snapshot timestamp. */
  capturedAt: Date | FieldValue;
  /** How this snapshot was created. `'trigger'` = `onJobOrderStatusTransitionSnapshot`; `'backfill'` = migration script. */
  capturedBy: 'trigger' | 'backfill';
  /** Bumped on every Push-to-Active that touches this JO. `null` = never pushed. */
  lastPushedAt?: Date | FieldValue | null;

  // Top-level snapshot fields (registry: snapshot-on-activation)
  hiringEntityId?: string | null;
  eVerifyRequired?: boolean | null;
  workersCompCode?: string | null;
  screeningPackageId?: string | null;
  additionalScreenings?: string[] | null;
  selectedPositionIds?: string[] | null;

  /**
   * Resolved+filtered positions list, one entry per id in
   * `selectedPositionIds` at activation time. Each entry includes
   * the full set of position sub-fields (pricing, tax, header).
   * Order matches `selectedPositionIds`.
   */
  positions?: ResolvedPositionSnapshot[];
}

/**
 * One position inside `JobOrderSnapshot.positions`. Mirrors the
 * `positions.itemFields` set in the cascade registry. Every field
 * is the resolved value from the cascade chain at activation —
 * pricing/tax fields come from the Child level (the only level
 * those are editable at), header fields can come from Account or
 * Child.
 */
export interface ResolvedPositionSnapshot {
  positionId: string;
  jobTitle?: string | null;
  jobDescription?: string | null;
  rateMode?: string | null;
  payRate?: number | null;
  billRate?: number | null;
  futa?: number | null;
  suta?: number | null;
  workersCompRate?: number | null;
  markupPercentage?: number | null;
}

/** Persisted on job orders / tenant / groups; merged tenant → posting → container. */
export type HiringConfig = {
  interview?: {
    interviewType?: 'worker_ai_prescreen';
    workerAiPrescreenRequired?: boolean;
  };
};

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

export type JobOrderStatus =
  | 'draft'
  | 'open'
  | 'on_hold'
  | 'cancelled'
  | 'filled'
  | 'filled_by_another_agency'
  | 'completed';

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

  /** Gig / Careers: notify these user groups (SMS + push) when new shifts are posted; 15 min cooldown per recipient. */
  autoMessagingUserGroupIds?: string[];

  muted?: boolean;

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
  /** Optional compliance item ids for placement cert blockers; see main `JobOrder` type. */
  requiredCertificationComplianceIds?: string[];
  drugScreenRequired: boolean;
  backgroundCheckRequired: boolean;
  experienceRequired?: string;
  educationRequired?: string;
  languagesRequired?: string[];
  skillsRequired?: string[];
  /** R.1 (D4.R1, Q-R1-1) — see main `JobOrder` type for semantics. */
  skillsRequiredSeverityOverrides?: Record<string, 'hard' | 'soft'>;
  /** R.1 (D4.R1) — see main `JobOrder` type for semantics. */
  requirementSeverityOverrides?: Partial<
    Record<
      import('../../shared/assignmentReadinessItemV1').AssignmentReadinessRequirementType,
      'hard' | 'soft'
    >
  >;
  physicalRequirements?: string;
  ppeRequirements?: string;
  ppeProvidedBy: 'company' | 'worker' | 'both';
  /**
   * @deprecated R.0d (Apr 2026) — soft-deprecated by the Readiness Rebuild.
   * No new writes; existing data is preserved. See `docs/READINESS_R0_HANDOFF.md`.
   */
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
  /**
   * @deprecated R.0d (Apr 2026) — soft-deprecated by the Readiness Rebuild.
   * Subsumed by Everee employee-readiness layer. No new writes; existing data
   * is preserved. See `docs/READINESS_R0_HANDOFF.md`.
   */
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
  /** Optional canonical hiring funnel snapshot when persisted on the application doc. */
  hiringLifecycle?: ApplicationHiringLifecycle;
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
