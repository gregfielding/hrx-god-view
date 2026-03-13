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
}

/** Pricing config stored on the account. */
export interface AccountPricing {
  /** National only: when false, a single flat markup % applies to all sub-accounts and positions. */
  subAccountsManageOwnPricing?: boolean;
  /** National only: flat markup % when subAccountsManageOwnPricing is false (e.g. 45). */
  flatMarkupPercent?: number | null;
  /** Positions table: job titles and rates. At national level trickles to children; at child/standalone defines local rates and WC/SUTA/FUTA. */
  positions?: AccountPositionPricing[];
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
  createdAt?: any; // Firestore Timestamp or serverTimestamp
  updatedAt?: any;
  createdBy?: string;
  updatedBy?: string;
  associations?: RecruiterAccountAssociations;
  /** Order defaults: staff instructions and attachments that pre-fill new job orders for this account */
  orderDefaults?: {
    staffInstructions?: Record<string, { text?: unknown; files?: Array<{ name?: string; label?: string; url?: string; uploadedAt?: string }> }>;
  };
  /** Pricing: flat markup (national) or positions table; positions can trickle from national to sub-accounts. */
  pricing?: AccountPricing;
  /** QuickBooks Online invoicing integration (scaffolding; OAuth/sync implemented later). */
  integrations?: {
    quickbooks?: AccountQuickBooksIntegration;
  };
  /** For list display only: E-Verify required (from defaults.eVerify.eVerifyRequired). */
  eVerifyRequired?: boolean;
}

export interface RecruiterAccountFormData {
  name: string;
  active: boolean;
  parentAccountId?: string | null;
}
