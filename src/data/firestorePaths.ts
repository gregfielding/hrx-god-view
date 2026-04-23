/**
 * Canonical Firestore Path Helpers
 * 
 * This module provides centralized path generation for all Firestore operations.
 * All components MUST use these helpers instead of raw string paths to ensure
 * consistency and prevent path-related bugs.
 * 
 * Usage:
 * ```ts
 * import { p } from '../data/firestorePaths';
 * 
 * // Get collection reference
 * const jobOrdersRef = collection(db, p.jobOrders(tenantId));
 * 
 * // Get document reference
 * const jobOrderRef = doc(db, p.jobOrder(tenantId, jobOrderId));
 * ```
 */

/** Doc id under tenants/{tid}/workers_comp_rates: GA_8810 or GA_8810__m__accountDocId when scoped to a national/standalone account. */
export function workersCompRateDocId(stateCode: string, code: string, modifierAccountId?: string | null): string {
  const s = String(stateCode || '').trim().toUpperCase();
  const c = String(code || '').trim();
  const m = String(modifierAccountId || '').trim();
  return m ? `${s}_${c}__m__${m}` : `${s}_${c}`;
}

/**
 * Canonical path helpers for Phase 1.5+ data model
 * 
 * All paths follow the tenant-scoped structure:
 * tenants/{tenantId}/...
 */
export const p = {
  /**
   * Tenant root path
   */
  tenant: (tid: string) => `tenants/${tid}`,

  /**
   * Account (Company) paths
   * Legacy: crm_companies (keeping doc IDs for compatibility)
   */
  accounts: (tid: string) => `tenants/${tid}/crm_companies`,
  account: (tid: string, id: string) => `tenants/${tid}/crm_companies/${id}`,
  
  /**
   * Account subcollections
   */
  accountLocations: (tid: string, accId: string) => `tenants/${tid}/crm_companies/${accId}/locations`,
  accountContacts: (tid: string, accId: string) => `tenants/${tid}/crm_companies/${accId}/crm_contacts`,
  accountDeals: (tid: string, accId: string) => `tenants/${tid}/crm_companies/${accId}/crm_deals`,

  /**
   * Recruiter Accounts (tenant subcollection: customers hub – companies, contacts, job orders, etc.)
   * Active/Inactive; bridge between opportunity, contact, company, job order.
   */
  recruiterAccounts: (tid: string) => `tenants/${tid}/accounts`,
  recruiterAccount: (tid: string, id: string) => `tenants/${tid}/accounts/${id}`,
  /** Account file uploads (e.g. contracts) */
  recruiterAccountUploads: (tid: string, accountId: string) => `tenants/${tid}/accounts/${accountId}/uploads`,
  recruiterAccountUpload: (tid: string, accountId: string, uploadId: string) => `tenants/${tid}/accounts/${accountId}/uploads/${uploadId}`,
  /** Location-level order defaults override (key = companyId_locationId, no slashes). */
  recruiterAccountLocationDefaults: (tid: string, accountId: string, locationKey: string) =>
    `tenants/${tid}/accounts/${accountId}/location_defaults/${locationKey}`,
  /** Location-level file uploads (docs have locationKey field). */
  recruiterAccountLocationUploads: (tid: string, accountId: string) =>
    `tenants/${tid}/accounts/${accountId}/location_uploads`,
  recruiterAccountLocationUpload: (tid: string, accountId: string, uploadId: string) =>
    `tenants/${tid}/accounts/${accountId}/location_uploads/${uploadId}`,

  /**
   * QuickBooks Online integration (account-scoped cache and sync).
   * Canonical account ID = Firestore document ID; QBO customerId stored on account.integrations.quickbooks.
   */
  recruiterAccountQuickbooks: (tid: string, accountId: string) => `tenants/${tid}/accounts/${accountId}/quickbooks`,
  /** Single doc: current QBO customer snapshot for this account */
  recruiterAccountQuickbooksCustomer: (tid: string, accountId: string) => `tenants/${tid}/accounts/${accountId}/quickbooks/customer`,
  recruiterAccountQuickbooksInvoices: (tid: string, accountId: string) => `tenants/${tid}/accounts/${accountId}/quickbooks/invoices`,
  recruiterAccountQuickbooksInvoice: (tid: string, accountId: string, invoiceId: string) => `tenants/${tid}/accounts/${accountId}/quickbooks/invoices/${invoiceId}`,
  recruiterAccountQuickbooksPayments: (tid: string, accountId: string) => `tenants/${tid}/accounts/${accountId}/quickbooks/payments`,
  recruiterAccountQuickbooksPayment: (tid: string, accountId: string, paymentId: string) => `tenants/${tid}/accounts/${accountId}/quickbooks/payments/${paymentId}`,
  recruiterAccountQuickbooksArSummary: (tid: string, accountId: string) => `tenants/${tid}/accounts/${accountId}/quickbooks/arSummary`,
  recruiterAccountQuickbooksArSummaryCurrent: (tid: string, accountId: string) => `tenants/${tid}/accounts/${accountId}/quickbooks/arSummary/current`,
  recruiterAccountQuickbooksSyncLogs: (tid: string, accountId: string) => `tenants/${tid}/accounts/${accountId}/quickbooks/syncLogs`,
  recruiterAccountQuickbooksSyncLog: (tid: string, accountId: string, logId: string) => `tenants/${tid}/accounts/${accountId}/quickbooks/syncLogs/${logId}`,

  /**
   * Job Orders (authoritative tenant-level collection)
   */
  jobOrders: (tid: string) => `tenants/${tid}/job_orders`,
  jobOrder: (tid: string, id: string) => `tenants/${tid}/job_orders/${id}`,

  /**
   * Shifts (subcollection of job order) — C1 Recruiter Shift Setup reads/writes here
   */
  shifts: (tid: string, jobOrderId: string) => `tenants/${tid}/job_orders/${jobOrderId}/shifts`,
  shift: (tid: string, jobOrderId: string, shiftId: string) => `tenants/${tid}/job_orders/${jobOrderId}/shifts/${shiftId}`,

  /** Gig auto-messaging: one doc per shift-notification batch (timestamps for recruiter UI). */
  jobOrderAutoMessagingSendLog: (tid: string, jobOrderId: string) =>
    `tenants/${tid}/job_orders/${jobOrderId}/autoMessagingSendLog`,

  /**
   * Job board postings (canonical Firestore collection — live app uses `job_postings`).
   * `jobBoardPosts` / `jobBoardPost` are deprecated aliases; prefer `jobPostings` / `jobPosting`.
   */
  jobPostings: (tid: string) => `tenants/${tid}/job_postings`,
  jobPosting: (tid: string, id: string) => `tenants/${tid}/job_postings/${id}`,
  /** @deprecated Use `jobPostings` — path is `job_postings` */
  jobBoardPosts: (tid: string) => `tenants/${tid}/job_postings`,
  /** @deprecated Use `jobPosting` — path is `job_postings` */
  jobBoardPost: (tid: string, id: string) => `tenants/${tid}/job_postings/${id}`,

  /**
   * Applications (tenant-level authoritative)
   */
  applications: (tid: string) => `tenants/${tid}/applications`,
  application: (tid: string, id: string) => `tenants/${tid}/applications/${id}`,

  /**
   * Assignments (tenant-level authoritative)
   */
  assignments: (tid: string) => `tenants/${tid}/assignments`,
  assignment: (tid: string, id: string) => `tenants/${tid}/assignments/${id}`,

  /**
   * Onboarding (Phase 1A)
   */
  entities: (tid: string) => `tenants/${tid}/entities`,
  entity: (tid: string, id: string) => `tenants/${tid}/entities/${id}`,
  /** Entity employments: per worker per entity (doc id = userId__entityKey) */
  entityEmployments: (tid: string) => `tenants/${tid}/entity_employments`,
  entityEmployment: (tid: string, docId: string) => `tenants/${tid}/entity_employments/${docId}`,
  /** Worker onboarding pipelines (doc id = userId__entityKey) */
  workerOnboarding: (tid: string) => `tenants/${tid}/worker_onboarding`,
  workerOnboardingPipeline: (tid: string, pipelineId: string) => `tenants/${tid}/worker_onboarding/${pipelineId}`,
  requirementPackages: (tid: string) => `tenants/${tid}/requirement_packages`,
  requirementPackage: (tid: string, id: string) => `tenants/${tid}/requirement_packages/${id}`,
  onboardingInstances: (tid: string) => `tenants/${tid}/onboarding_instances`,
  onboardingInstance: (tid: string, id: string) => `tenants/${tid}/onboarding_instances/${id}`,
  /** Cloud Functions audit: assignment-confirmed automation and related dispatches (read-only for clients). */
  onboardingAutomationDispatch: (tid: string) => `tenants/${tid}/onboarding_automation_dispatch`,

  /**
   * Onboarding Library (Phase 1B)
   */
  onboardingItemLibrary: (tid: string) => `tenants/${tid}/onboarding_item_library`,
  onboardingItem: (tid: string, id: string) => `tenants/${tid}/onboarding_item_library/${id}`,
  onboardingDocuments: (tid: string) => `tenants/${tid}/onboarding_documents`,
  onboardingDocument: (tid: string, id: string) => `tenants/${tid}/onboarding_documents/${id}`,

  /**
   * Phase 2: Compliance, Benefits, Payroll, AI Signals (see docs/PHASE2_SYSTEMS_ARCHITECTURE.md)
   */
  workerComplianceItems: (tid: string) => `tenants/${tid}/worker_compliance_items`,
  workerComplianceItem: (tid: string, id: string) => `tenants/${tid}/worker_compliance_items/${id}`,
  workerBenefits: (tid: string) => `tenants/${tid}/worker_benefits`,
  workerBenefit: (tid: string, id: string) => `tenants/${tid}/worker_benefits/${id}`,
  workerPayrollAccounts: (tid: string) => `tenants/${tid}/worker_payroll_accounts`,
  workerPayrollAccount: (tid: string, id: string) => `tenants/${tid}/worker_payroll_accounts/${id}`,
  workerSignals: (tid: string) => `tenants/${tid}/worker_signals`,
  workerSignal: (tid: string, id: string) => `tenants/${tid}/worker_signals/${id}`,
  /**
   * I-9 supporting uploads (identity / List A–C). Canonical scope: tenant + user; doc stores userId + optional workflow fields.
   * @see docs/I9_SUPPORTING_DOCUMENTS_ARCHITECTURE.md
   */
  workerI9SupportingDocuments: (tid: string) => `tenants/${tid}/worker_i9_supporting_documents`,
  workerI9SupportingDocument: (tid: string, documentId: string) =>
    `tenants/${tid}/worker_i9_supporting_documents/${documentId}`,

  /**
   * AccuSource (tenant-global): synced SourceDirect package/service catalog. Single doc id `catalog`.
   */
  integrationsAccusource: () => 'integrations_accusource',
  integrationsAccusourceCatalogDocId: () => 'catalog',

  /**
   * Everee payroll integration (HRX Everee Master Plan)
   */
  evereeWorkers: (tid: string) => `tenants/${tid}/everee_workers`,
  evereeWorker: (tid: string, entityId: string, userId: string) =>
    `tenants/${tid}/everee_workers/${entityId}__${userId}`,
  evereeEmbedSessions: (tid: string) => `tenants/${tid}/everee_embed_sessions`,
  evereeEmbedSession: (tid: string, sessionId: string) =>
    `tenants/${tid}/everee_embed_sessions/${sessionId}`,
  evereeWebhookEvents: (tid: string) => `tenants/${tid}/everee_webhook_events`,
  evereeWebhookEvent: (tid: string, eventId: string) =>
    `tenants/${tid}/everee_webhook_events/${eventId}`,
  evereePayHistoryCache: (tid: string) => `tenants/${tid}/everee_pay_history_cache`,
  evereePayHistoryCacheDoc: (tid: string, cacheId: string) =>
    `tenants/${tid}/everee_pay_history_cache/${cacheId}`,

  /**
   * E-Verify cases (HRX E-Verify Master Plan)
   */
  everifyCases: (tid: string) => `tenants/${tid}/everify_cases`,
  everifyCase: (tid: string, id: string) => `tenants/${tid}/everify_cases/${id}`,
  everifyCasesPublic: (tid: string) => `tenants/${tid}/everify_cases_public`,
  everifyCasePublic: (tid: string, id: string) => `tenants/${tid}/everify_cases_public/${id}`,
  everifyCaseEvents: (tid: string, caseId: string) =>
    `tenants/${tid}/everify_cases/${caseId}/events`,
  everifyCaseEvent: (tid: string, caseId: string, eventId: string) =>
    `tenants/${tid}/everify_cases/${caseId}/events/${eventId}`,

  /**
   * Signatures (Phase 1C + HRX Signatures Spec: document templates, bundles, envelopes, sessions)
   */
  documentTemplates: (tid: string) => `tenants/${tid}/document_templates`,
  documentTemplate: (tid: string, id: string) => `tenants/${tid}/document_templates/${id}`,
  documentBundles: (tid: string) => `tenants/${tid}/document_bundles`,
  documentBundle: (tid: string, id: string) => `tenants/${tid}/document_bundles/${id}`,
  signatureEnvelopes: (tid: string) => `tenants/${tid}/signature_envelopes`,
  signatureEnvelope: (tid: string, id: string) => `tenants/${tid}/signature_envelopes/${id}`,
  signatureEnvelopeEvents: (tid: string, envelopeId: string) =>
    `tenants/${tid}/signature_envelopes/${envelopeId}/events`,
  signatureEnvelopeEvent: (tid: string, envelopeId: string, eventId: string) =>
    `tenants/${tid}/signature_envelopes/${envelopeId}/events/${eventId}`,
  signatureSessions: (tid: string) => `tenants/${tid}/signature_sessions`,
  signatureSession: (tid: string, id: string) => `tenants/${tid}/signature_sessions/${id}`,
  signatureEnvelopesPublic: (tid: string) => `tenants/${tid}/signature_envelopes_public`,
  signatureEnvelopePublic: (tid: string, id: string) => `tenants/${tid}/signature_envelopes_public/${id}`,

  /**
   * Entity Master Data (Phase 1B Extension)
   */
  entityCostCenters: (tid: string) => `tenants/${tid}/entity_cost_centers`,
  entityCostCenter: (tid: string, id: string) => `tenants/${tid}/entity_cost_centers/${id}`,
  entityJurisdictions: (tid: string) => `tenants/${tid}/entity_jurisdictions`,
  entityJurisdiction: (tid: string, id: string) => `tenants/${tid}/entity_jurisdictions/${id}`,
  complianceDocuments: (tid: string) => `tenants/${tid}/compliance_documents`,
  complianceDocument: (tid: string, id: string) => `tenants/${tid}/compliance_documents/${id}`,
  workersComp: (tid: string) => `tenants/${tid}/workers_comp`,
  workersCompPolicy: (tid: string, id: string) => `tenants/${tid}/workers_comp/${id}`,
  workersCompClassCodes: (tid: string) => `tenants/${tid}/workers_comp_class_codes`,
  workersCompClassCode: (tid: string, id: string) => `tenants/${tid}/workers_comp_class_codes/${id}`,
  workersCompRateSets: (tid: string) => `tenants/${tid}/workers_comp_rate_sets`,
  workersCompRateSet: (tid: string, id: string) => `tenants/${tid}/workers_comp_rate_sets/${id}`,
  /** WC rates by state + code (single source of truth). Doc id: STATE_CODE or STATE_CODE__m__accountId when scoped to a national/standalone account. */
  workersCompRates: (tid: string) => `tenants/${tid}/workers_comp_rates`,
  workersCompRate: (tid: string, stateCode: string, code: string, modifierAccountId?: string | null) =>
    `tenants/${tid}/workers_comp_rates/${workersCompRateDocId(stateCode, code, modifierAccountId)}`,

  /**
   * User Groups (manual candidate grouping)
   */
  userGroups: (tid: string) => `tenants/${tid}/userGroups`,
  userGroup: (tid: string, id: string) => `tenants/${tid}/userGroups/${id}`,

  /**
   * Recruiter invite log (sent invites from Invite Users page)
   */
  inviteLog: (tid: string) => `tenants/${tid}/invite_log`,
  inviteLogEntry: (tid: string, id: string) => `tenants/${tid}/invite_log/${id}`,

  /**
   * Tasks (todos, appointments)
   */
  tasks: (tid: string) => `tenants/${tid}/tasks`,
  task: (tid: string, id: string) => `tenants/${tid}/tasks/${id}`,

  /**
   * Counters (auto-incrementing IDs)
   */
  counters: (tid: string) => `tenants/${tid}/counters`,
  counter: (tid: string, id: string) => `tenants/${tid}/counters/${id}`,
  
  /**
   * Specific counter paths
   */
  jobOrderCounter: (tid: string) => `tenants/${tid}/counters/jobOrderNumber`,

  /**
   * Settings and configuration
   */
  settings: (tid: string) => `tenants/${tid}/settings`,
  config: (tid: string) => `tenants/${tid}/settings/config`,
  main: (tid: string) => `tenants/${tid}/settings/main`,
  flex: (tid: string) => `tenants/${tid}/settings/flex`,
  smartGroups: (tid: string) => `tenants/${tid}/settings/smartGroups`,

  /**
   * Saved Smart Groups (saved search results with member list)
   */
  savedSmartGroups: (tid: string) => `tenants/${tid}/savedSmartGroups`,
  savedSmartGroup: (tid: string, id: string) => `tenants/${tid}/savedSmartGroups/${id}`,

  /**
   * Monitoring and events (for auditing)
   */
  monitoring: (tid: string) => `tenants/${tid}/monitoring`,
  events: (tid: string) => `tenants/${tid}/monitoring/events`,
};

/**
 * Unified worker notifications + inbox (HRX-Unified-Notifications-and-Inbox-Spec).
 * Global threads; per-user notifications and device tokens.
 */
export const workerNotificationsPaths = {
  userNotifications: (uid: string) => `users/${uid}/notifications`,
  userNotification: (uid: string, notificationId: string) => `users/${uid}/notifications/${notificationId}`,
  userDeviceTokens: (uid: string) => `users/${uid}/deviceTokens`,
  userDeviceToken: (uid: string, tokenId: string) => `users/${uid}/deviceTokens/${tokenId}`,
  threads: () => 'threads',
  thread: (threadId: string) => `threads/${threadId}`,
  threadMessages: (threadId: string) => `threads/${threadId}/messages`,
  threadMessage: (threadId: string, messageId: string) => `threads/${threadId}/messages/${messageId}`,
};

/**
 * Worker certification records (Phase 1 — canonical `certification_records` subcollection).
 */
export const userCertificationPaths = {
  certificationRecords: (uid: string) => `users/${uid}/certification_records`,
  certificationRecord: (uid: string, recordId: string) =>
    `users/${uid}/certification_records/${recordId}`,
};

/**
 * Canonical tenant-scoped conversations (inbox).
 * tenants/{tenantId}/conversations/{conversationId}/messages/{messageId}
 */
export const conversationPaths = {
  conversations: (tenantId: string) => `tenants/${tenantId}/conversations`,
  conversation: (tenantId: string, conversationId: string) =>
    `tenants/${tenantId}/conversations/${conversationId}`,
  messages: (tenantId: string, conversationId: string) =>
    `tenants/${tenantId}/conversations/${conversationId}/messages`,
  message: (tenantId: string, conversationId: string, messageId: string) =>
    `tenants/${tenantId}/conversations/${conversationId}/messages/${messageId}`,
};

/**
 * Legacy path detection helpers
 * Use these to identify and warn about legacy path usage
 */
export const legacyPaths = {
  /**
   * Check if a path uses legacy recruiter_* collections
   */
  isRecruiterLegacy: (path: string): boolean => {
    return path.includes('/recruiter_');
  },

  /**
   * Check if a path uses top-level jobOrders (should be tenant-scoped)
   */
  isTopLevelJobOrders: (path: string): boolean => {
    return (path.startsWith('jobOrders/') || path.startsWith('job_orders/')) && !path.includes('tenants/');
  },

  /**
   * Check if a path is missing tenantId
   */
  isMissingTenantId: (path: string): boolean => {
    return !path.startsWith('tenants/') && !path.startsWith('users/');
  },

  /**
   * Warn about legacy path usage
   */
  warnLegacyUsage: (path: string, context = 'Unknown'): void => {
    if (legacyPaths.isRecruiterLegacy(path)) {
      console.error(`🚨 LEGACY PATH DETECTED: ${context} is using recruiter_* collection: ${path}`);
    }
    if (legacyPaths.isTopLevelJobOrders(path)) {
      console.error(`🚨 LEGACY PATH DETECTED: ${context} is using top-level jobOrders/job_orders: ${path}`);
    }
    if (legacyPaths.isMissingTenantId(path)) {
      console.error(`🚨 MISSING TENANT ID: ${context} path doesn't include tenantId: ${path}`);
    }
  }
};

/**
 * Path validation helpers
 */
export const pathValidation = {
  /**
   * Ensure a path includes tenantId
   */
  requireTenantId: (path: string, tenantId: string): string => {
    if (!path.includes(tenantId)) {
      throw new Error(`Path ${path} must include tenantId: ${tenantId}`);
    }
    return path;
  },

  /**
   * Validate that a path follows the canonical structure
   */
  validateCanonical: (path: string): boolean => {
    // Must start with tenants/ or users/
    if (!path.startsWith('tenants/') && !path.startsWith('users/')) {
      return false;
    }

    // Check for legacy patterns
    if (legacyPaths.isRecruiterLegacy(path) || legacyPaths.isTopLevelJobOrders(path)) {
      return false;
    }

    return true;
  }
};

/**
 * Type-safe path builders for common operations
 */
export const pathBuilders = {
  /**
   * Build a collection query path with filters
   */
  collectionQuery: (basePath: string, filters?: Record<string, any>) => {
    // This would be used with Firestore query builders
    return basePath;
  },

  /**
   * Build a subcollection path
   */
  subcollection: (parentPath: string, subcollectionName: string, docId?: string) => {
    const base = `${parentPath}/${subcollectionName}`;
    return docId ? `${base}/${docId}` : base;
  }
};

export default p;
