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

/** Account role in parent-child hierarchy; drives Locations tab, pricing, and job order rollup behavior. */
export type RecruiterAccountType = 'national' | 'child' | 'standalone';

/** One row in the account Positions table (job title + pay/bill + WC/SUTA/FUTA). */
export interface AccountPositionPricing {
  id?: string;
  /** Standardized job title (e.g. from O*NET list) */
  jobTitle: string;
  payRate: number;
  /** If set, bill rate is calculated as payRate * (1 + markupPercent/100). Otherwise use billRate directly. */
  markupPercent?: number | null;
  billRate: number;
  workersCompCode?: string;
  /** Workers comp rate as percentage (e.g. 2.3) */
  workersCompRate?: number | null;
  /** SUTA rate as percentage (shown when hiring entity is C1 Workforce or C1 Select) */
  sutaRate?: number | null;
  /** FUTA rate as percentage */
  futaRate?: number | null;
  /**
   * Customer-provided job description for this title (e.g. client’s official JD).
   * When this position is chosen on a job order, flows to job order `jobDescriptionFromClient` for AI / postings.
   */
  jobDescriptionFromClient?: string | null;
}

/** Pricing config stored on the account. */
export interface AccountPricing {
  /** National only: when false, a single flat markup % applies to all sub-accounts and positions. */
  subAccountsManageOwnPricing?: boolean;
  /** National only: flat markup % when subAccountsManageOwnPricing is false (e.g. 45). */
  flatMarkupPercent?: number | null;
  /** Positions table: job titles and rates. At national level trickles to children; at child/standalone defines local rates and WC/SUTA/FUTA. */
  positions?: AccountPositionPricing[];
  /** Free-form notes about pricing; flows downstream (e.g. National → Child → Job Order). */
  pricingNotes?: string | null;
}

/** QuickBooks Online integration state for this account (HRX-side scaffolding). */
export type AccountQuickBooksStatus =
  | 'not_connected'   // No QBO realm connected for tenant
  | 'connected_unmapped' // Realm connected but this account not linked to a QBO customer
  | 'mapped'          // Account linked to QBO customer; sync can run
  | 'sync_error';     // Mapping exists but last sync failed

export interface AccountQuickBooksIntegration {
  realmId?: string | null;
  customerId?: string | null;
  customerDisplayName?: string | null;
  status?: AccountQuickBooksStatus;
  lastSyncAt?: any; // Firestore Timestamp | null
  lastInvoiceSyncAt?: any;
  lastPaymentSyncAt?: any;
  lastArSyncAt?: any;
  syncError?: string | null;
}

/** Cached QBO customer snapshot: accounts/{accountId}/quickbooks/customer */
export interface AccountQuickBooksCustomerDoc {
  realmId?: string;
  customerId?: string;
  displayName?: string;
  fullyQualifiedName?: string;
  primaryEmailAddr?: string;
  primaryPhone?: string;
  active?: boolean;
  syncedAt?: any;
}

/** Cached QBO invoice: accounts/{accountId}/quickbooks/invoices/{invoiceId} */
export interface AccountQuickBooksInvoiceDoc {
  realmId?: string;
  invoiceId?: string;
  docNumber?: string;
  txnDate?: string;
  dueDate?: string;
  totalAmt?: number;
  balance?: number;
  currencyRef?: string;
  customerId?: string;
  customerName?: string;
  emailStatus?: string;
  printStatus?: string;
  syncedAt?: any;
}

/** Cached QBO payment: accounts/{accountId}/quickbooks/payments/{paymentId} */
export interface AccountQuickBooksPaymentDoc {
  realmId?: string;
  paymentId?: string;
  txnDate?: string;
  totalAmt?: number;
  unappliedAmt?: number;
  customerId?: string;
  paymentRefNum?: string;
  syncedAt?: any;
}

/** Cached A/R summary: accounts/{accountId}/quickbooks/arSummary/current */
export interface AccountQuickBooksArSummaryDoc {
  realmId?: string;
  customerId?: string;
  totalOpenBalance?: number;
  current?: number;
  days1to30?: number;
  days31to60?: number;
  days61to90?: number;
  over90?: number;
  asOfDate?: string;
  syncedAt?: any;
}

/** Sync log entry: accounts/{accountId}/quickbooks/syncLogs/{logId} */
export interface AccountQuickBooksSyncLogDoc {
  type?: 'customer' | 'invoice' | 'payment' | 'ar' | 'sendInvoice';
  status?: 'success' | 'error';
  message?: string;
  createdAt?: any;
  createdBy?: string;
}

export interface RecruiterAccount {
  id?: string;
  name: string;
  active: boolean;
  /** National = parent with child venues; Child = venue under a national; Standalone = no hierarchy. */
  accountType?: RecruiterAccountType | null;
  /** Entity (Employer of Record) governing billing, worker onboarding, etc. */
  hiringEntityId?: string | null;
  parentAccountId?: string | null;
  childAccountIds?: string[];
  /** MSP (Managed Service Provider) accounts linked to this account. */
  mspAccountIds?: string[];
  createdAt?: any; // Firestore Timestamp or serverTimestamp
  updatedAt?: any;
  createdBy?: string;
  updatedBy?: string;
  associations?: RecruiterAccountAssociations;
  /** Order defaults: staff instructions and attachments that pre-fill new job orders for this account */
  orderDefaults?: {
    staffInstructions?: Record<string, { text?: unknown; files?: Array<{ name?: string; label?: string; url?: string; uploadedAt?: string }> }>;
    /** AccuSource provider package id from synced catalog (`integrations_accusource/catalog`). */
    screeningPackageId?: string | null;
    screeningPackageName?: string | null;
    orderDetails?: Record<string, unknown>;
  };
  /** Billing/hiring defaults (E-Verify, etc.). Stored in Firestore as defaults; may be mirrored at top level for display. */
  defaults?: {
    eVerify?: { eVerifyRequired?: boolean };
    rules?: Record<string, unknown>;
    billing?: Record<string, unknown>;
  };
  /** Pricing: flat markup (national) or positions table; positions can trickle from national to sub-accounts. */
  pricing?: AccountPricing;
  /** QuickBooks Online invoicing integration (scaffolding; OAuth/sync implemented later). */
  integrations?: {
    quickbooks?: AccountQuickBooksIntegration;
  };
  /** For list display only: E-Verify required (from defaults.eVerify.eVerifyRequired). */
  eVerifyRequired?: boolean;
  /**
   * National accounts only: when true, new locations added under a linked CRM company auto-create a child account (backend trigger).
   */
  autoCreateChildAccountsForLocations?: boolean;
  /** Set by automation when this child account was created from a company location. */
  autoCreatedFromCompanyLocation?: boolean;
  /** Location display name at auto-create time (nickname else name); used for safe rename matching. */
  autoCreatedFromLocationDisplayName?: string;
  /** CRM company id when this account is tied to a single location (e.g. auto-created child). */
  companyId?: string | null;
  /** `crm_companies/{companyId}/locations/{locationId}` location id when tied to a worksite. */
  companyLocationId?: string | null;
}

export interface RecruiterAccountFormData {
  name: string;
  active: boolean;
  parentAccountId?: string | null;
}

/**
 * Tenant-level workers comp rate: one doc per (state, code) or (state, code, modifier account).
 * Update the rate here and all accounts/job orders referencing this state+code use the new rate.
 * jobTitles: from master job title list; when an account/job order uses one of these titles and worksite is in this state, code+rate auto-apply.
 * When modifierAccountId is set, the rule applies only to job orders / pricing under that national or standalone account (child venues use the parent id).
 */
export interface WorkersCompRateByState {
  /** State code (e.g. TX) – rate applies statewide. */
  state: string;
  /** Class code (e.g. 9014). */
  code: string;
  /** Rate as percentage (e.g. 1.7). */
  rate: number;
  /** Job titles from master list that use this code/rate in this state (e.g. ["Cleaner", "Janitor"]). */
  jobTitles?: string[] | null;
  /** When set, only accounts under this national or standalone recruiter account match (see resolveWorkersCompModifierAccountId). */
  modifierAccountId?: string | null;
  updatedAt?: any;
  updatedBy?: string | null;
}
