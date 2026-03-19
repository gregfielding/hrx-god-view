/**
 * Phase 2A: Compliance System — types, status model, and item type definitions.
 * Canonical structure for worker_compliance_items. See docs/PHASE2_SYSTEMS_ARCHITECTURE.md.
 */

/** Lifecycle status for a compliance item. */
export const COMPLIANCE_STATUS = [
  'not_started',
  'pending',
  'submitted',
  'in_review',
  'complete',
  'expired',
  'failed',
  'waived',
] as const;

export type ComplianceStatus = (typeof COMPLIANCE_STATUS)[number];

/** Human-friendly label for compliance status (admin table, worker UI). */
export function getComplianceStatusDisplayLabel(status: string): string {
  const labels: Record<string, string> = {
    not_started: 'Not started',
    pending: 'Pending',
    submitted: 'Submitted',
    in_review: 'In review',
    complete: 'Complete',
    expired: 'Expired',
    failed: 'Failed',
    waived: 'Waived',
  };
  return labels[status] ?? status.replace(/_/g, ' ');
}

/** Category of compliance item. */
export const COMPLIANCE_CATEGORY = [
  'eligibility',
  'screening',
  'acknowledgment',
  'credential',
] as const;

export type ComplianceCategory = (typeof COMPLIANCE_CATEGORY)[number];

/** Source of the compliance item. */
export const COMPLIANCE_SOURCE = [
  'onboarding_package',
  'admin_manual',
  'job_order',
  'worker_upload',
  'integration',
] as const;

export type ComplianceSource = (typeof COMPLIANCE_SOURCE)[number];

/** Supported compliance item type keys (Phase 2A initial set). */
export const COMPLIANCE_ITEM_TYPE_KEYS = [
  // Employment eligibility / onboarding-related
  'i9',
  'everify',
  'handbook_acknowledgment',
  'policy_acknowledgment',
  'contractor_agreement',
  'w4',
  'w9',
  // Screenings
  'background_check',
  'drug_screen',
  'tb_test',
  // Credentials / expiring docs
  'drivers_license',
  'work_permit',
  'food_handler',
  'cpr_bls',
  'forklift_certification',
] as const;

export type ComplianceItemTypeKey = (typeof COMPLIANCE_ITEM_TYPE_KEYS)[number];

export interface ComplianceItemTypeConfig {
  type: ComplianceItemTypeKey;
  category: ComplianceCategory;
  label: string;
  /** Whether this type typically has an expiration date. */
  hasExpiration: boolean;
}

/** Type definitions used by Compliance Library and worker compliance UI. */
export const COMPLIANCE_ITEM_TYPES: ComplianceItemTypeConfig[] = [
  { type: 'i9', category: 'eligibility', label: 'I-9', hasExpiration: false },
  { type: 'everify', category: 'eligibility', label: 'E-Verify', hasExpiration: false },
  { type: 'handbook_acknowledgment', category: 'acknowledgment', label: 'Handbook acknowledgment', hasExpiration: false },
  { type: 'policy_acknowledgment', category: 'acknowledgment', label: 'Policy acknowledgment', hasExpiration: false },
  { type: 'contractor_agreement', category: 'acknowledgment', label: 'Contractor agreement', hasExpiration: false },
  { type: 'w4', category: 'eligibility', label: 'W-4', hasExpiration: false },
  { type: 'w9', category: 'eligibility', label: 'W-9', hasExpiration: false },
  { type: 'background_check', category: 'screening', label: 'Background check', hasExpiration: true },
  { type: 'drug_screen', category: 'screening', label: 'Drug screen', hasExpiration: true },
  { type: 'tb_test', category: 'screening', label: 'TB test', hasExpiration: true },
  { type: 'drivers_license', category: 'credential', label: "Driver's license", hasExpiration: true },
  { type: 'work_permit', category: 'credential', label: 'Work permit', hasExpiration: true },
  { type: 'food_handler', category: 'credential', label: 'Food handler card', hasExpiration: true },
  { type: 'cpr_bls', category: 'credential', label: 'CPR / BLS', hasExpiration: true },
  { type: 'forklift_certification', category: 'credential', label: 'Forklift certification', hasExpiration: true },
];

const TYPE_CONFIG_MAP = new Map<ComplianceItemTypeKey, ComplianceItemTypeConfig>(
  COMPLIANCE_ITEM_TYPES.map((c) => [c.type, c])
);

export function getComplianceTypeConfig(type: string): ComplianceItemTypeConfig | undefined {
  return TYPE_CONFIG_MAP.get(type as ComplianceItemTypeKey);
}

export function getComplianceTypeLabel(type: string): string {
  return getComplianceTypeConfig(type)?.label ?? type;
}

/** Firestore-facing compliance item (matches docs/PHASE2_SYSTEMS_ARCHITECTURE.md). */
export interface WorkerComplianceItem {
  id?: string;
  tenantId: string;
  userId: string;
  entityId?: string | null;
  employmentId?: string | null;
  category: ComplianceCategory;
  type: ComplianceItemTypeKey | string;
  title?: string | null;
  required?: boolean;
  status: ComplianceStatus;
  source?: ComplianceSource | string | null;
  documentIds?: string[] | null;
  issuedAt?: unknown;
  expiresAt?: unknown;
  renewalDueAt?: unknown;
  verifiedAt?: unknown;
  verifiedBy?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/** Build deterministic doc ID for employment-scoped item (idempotent upserts). */
export function complianceItemIdForEmployment(
  userId: string,
  employmentId: string,
  type: string
): string {
  const safeType = type.replace(/\//g, '_');
  return `${userId}__${employmentId}__${safeType}`;
}
