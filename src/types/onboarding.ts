/**
 * Worker onboarding & compliance (v2/v3).
 * Data model: users/{uid}.onboarding, onboardingTemplates/{templateId}
 * Specs: HRX-Worker-Documents-v2, HRX-Documents-Compliance-Scoring-v3
 */

/** Checklist item status (stored) */
export type ChecklistItemStatus = 'missing' | 'submitted' | 'verified' | 'expired';

/** Provider that hosts the document */
export type ChecklistItemProvider = 'everee' | 'hrx';

/** Checklist item kind: document (upload) vs attestation (answers). */
export type ChecklistItemKind = 'document' | 'attestation';

/** Single checklist item — shape stored in users/{uid}.onboarding.checklist[key] */
export interface OnboardingChecklistItem {
  status: ChecklistItemStatus;
  provider: ChecklistItemProvider;
  /** document = upload/view; attestation = review answers (e.g. Work Eligibility) */
  kind?: ChecklistItemKind;
  /** Everee/HRX document id for view link generation */
  externalId?: string;
  /** Optional pre-generated view URL (prefer externalId + callable for security) */
  viewUrl?: string;
  /** When this document expires (e.g. driver license, cert) */
  expiresAt?: any; // Firestore Timestamp
  renewalRequestedAt?: any;
  /** HRX-hosted: direct file URL */
  fileUrl?: string;
  updatedAt?: any;
  /** For aggregate items e.g. certifications */
  count?: number;
  nextExpiringAt?: any;
}

/** Full checklist: item key -> item data */
export type OnboardingChecklist = Record<string, OnboardingChecklistItem>;

export type OnboardingJourney = 'employee' | 'contractor';
export type OnboardingStatus = 'not_started' | 'in_progress' | 'complete';

/** v3: employment type for compliance (w2 vs contractor) */
export type OnboardingEmploymentType = 'w2' | 'contractor';

/** v3: overall compliance status */
export type ComplianceOverallStatus = 'compliant' | 'expiring_soon' | 'non_compliant' | 'incomplete';

/** v3: result of computeComplianceSummary(checklist) */
export interface ComplianceSummary {
  compliancePercent: number;
  overallStatus: ComplianceOverallStatus;
  requiredCount: number;
  completedCount: number;
  expiredCount: number;
  expiringSoonCount: number;
  lastEvaluatedAt: Date;
}

/** users/{uid}.onboarding */
export interface UserOnboarding {
  journey: OnboardingJourney;
  status: OnboardingStatus;
  templateId: string;
  checklist: OnboardingChecklist;
  lastSyncedAtEveree?: any;
  updatedAt: any;
  /** v3 */
  employmentType?: OnboardingEmploymentType;
  overallStatus?: ComplianceOverallStatus;
  compliancePercent?: number;
  requiredCount?: number;
  completedCount?: number;
  expiredCount?: number;
  expiringSoonCount?: number;
  lastEvaluatedAt?: any;
}

/** onboardingTemplates/{templateId} */
export interface OnboardingTemplate {
  journeyType: OnboardingJourney;
  requiredItems: string[];
  optionalItems: string[];
  expirationTrackedItems: string[];
}

/** Display status for UI (includes derived expiring_soon / expired from expiresAt) */
export type DocRecordDisplayStatus =
  | 'missing'
  | 'submitted'
  | 'verified'
  | 'expiring_soon'
  | 'expired';
