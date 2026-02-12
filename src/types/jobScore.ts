/**
 * Job Score system: per-application Job Match Score vs global Hiring Score (AI Score).
 * - Hiring Score: users/{uid}.scoreSummary.aiScore (global)
 * - Job Match Score: applications/{appId}.jobScoreSummary (per user per job), v1 rubric.
 */

/** Known requirement pack IDs. Extensible via registry. */
export type RequirementPackId = 'warehouse_w2' | 'general_labor_1099' | 'nursing_w2';

/** Rule type for requirement pack categories (v1). */
export type RequirementImportance = 'hard' | 'scored' | 'info';

/** Single requirement: key (canonical), label (display), mustHave vs niceToHave (legacy) */
export interface JobRequirement {
  key: string;
  label: string;
  mustHave: boolean;
}

/** A pack of requirements for a job type (legacy shape). */
export interface RequirementPack {
  id: RequirementPackId;
  name: string;
  description?: string;
  mustHave: JobRequirement[];
  niceToHave: JobRequirement[];
}

/** Employment type policy for requirement pack (v1.1). */
export type RequirementPackEmploymentType = 'w2' | 'contractor' | 'either';

/** v1 requirement pack: category-based with importance and weights. */
export interface RequirementPackV1 {
  id: RequirementPackId;
  name: string;
  description?: string;
  /** v1.1: required. Packs must have version for stale detection. */
  version: number;
  /** v1.1: influences compliance journey and hard gates. */
  employmentType?: RequirementPackEmploymentType;
  /** Required cert names (e.g. "RN", "BLS"). Default importance hard. */
  requiredCerts?: string[];
  /** Experience bands: "Entry" | "0-1" | "1-2" | "3-5" | "5+" */
  requiredExperienceLevels?: string[];
  /** Education levels: "HS" | "AA" | "BA" | "MA" | "Doctorate" */
  requiredEducationLevels?: string[];
  /** Shift types: "Full Time", "Part Time", "Days", "Nights", etc. */
  requiredShiftTypes?: string[];
  /** Language codes or names */
  requiredLanguages?: string[];
  /** Physical/PPE/uniform tags (info only in v1) */
  physicalPpeTags?: string[];
  /** Importance per category (defaults: certs hard, experience/education/scored, shift/language scored, physical info) */
  importance?: {
    licenses?: RequirementImportance;
    experience?: RequirementImportance;
    education?: RequirementImportance;
    shift?: RequirementImportance;
    language?: RequirementImportance;
    physical?: RequirementImportance;
  };
}

/** Stored on applications/{appId}.jobScoreSummary (legacy shape, still supported). */
export interface JobScoreSummary {
  requirementPackId: RequirementPackId;
  computedAt: any;
  eligible: boolean;
  missingRequirements: string[];
  missingLabels?: string[];
  fitScore: number;
  jobScore: number;
  hiringScoreUsed?: number;
}

/** Canonical v1 shape for jobScoreSummary (Rubric v1). */
export type JobScoreSummaryV1 = {
  version: 'v1';
  requirementPackId: string;
  requirementPackVersion?: number;
  computedAt: any;
  writtenAt?: any;

  jobScore: number;
  eligible: boolean;
  ceiling?: number;

  breakdown: {
    requirements: number;
    hiringLift: number;
  };

  buckets: {
    gates: { label: string; status: 'pass' | 'fail'; reason?: string }[];
    missingRequired: { key: string; label: string; sectionId?: string; reason?: string }[];
    missingOptional: { key: string; label: string; sectionId?: string; reason?: string }[];
    matched: { key: string; label: string }[];
  };

  nextActions: { label: string; sectionId?: string; priority: 1 | 2 | 3 }[];

  inputs: {
    aiScoreAtCompute?: number;
    userProfileUpdatedAt?: any;
  };

  stale?: {
    isStale: boolean;
    reasons: ('profileChanged' | 'requirementPackChanged' | 'aiScoreChanged')[];
  };
};

/** Stored summary may be legacy or v1 (discriminate by version). */
export type JobScoreSummaryStored = JobScoreSummary | JobScoreSummaryV1;

/** User doc shape used for eligibility/fit checks (subset) */
export interface UserDocForJobScore {
  workEligibility?: boolean;
  skills?: string[];
  workHistory?: any[];
  workExperience?: any[];
  certifications?: Array<{ name?: string } | string>;
  education?: any[];
  professionalBio?: string;
  bio?: string;
  resume?: { downloadUrl?: string; storagePath?: string };
  preferences?: {
    shiftPreferences?: string[];
    availabilityNotes?: string;
  };
  availableToStartDate?: string;
  addressInfo?: { city?: string; state?: string };
  address?: any;
  phone?: string;
  phoneE164?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  dob?: string;
  dateOfBirth?: any;
}
