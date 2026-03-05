/**
 * Recruiter Account – customer hub (tenants/{tenantId}/accounts).
 * Bridge between opportunity, contact, company, job order, user groups, etc.
 */

/** Worksite/location is scoped to a company */
export interface AccountLocationRef {
  companyId: string;
  locationId: string;
}

export interface RecruiterAccountAssociations {
  companyIds?: string[];
  locations?: AccountLocationRef[];  // worksites: companyId + locationId per company
  contactIds?: string[];
  jobOrderIds?: string[];
  dealIds?: string[];
  userGroupIds?: string[];
  savedSmartGroupIds?: string[];
  /** User IDs assigned as salespeople (CRM sales / internal team) */
  salespersonIds?: string[];
  /** User IDs assigned as recruiters */
  recruiterIds?: string[];
}

export interface RecruiterAccount {
  id?: string;
  name: string;
  active: boolean;
  createdAt?: any; // Firestore Timestamp or serverTimestamp
  updatedAt?: any;
  createdBy?: string;
  updatedBy?: string;
  associations?: RecruiterAccountAssociations;
}

export interface RecruiterAccountFormData {
  name: string;
  active: boolean;
}
