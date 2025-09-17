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
   * Job Orders (authoritative tenant-level collection)
   */
  jobOrders: (tid: string) => `tenants/${tid}/jobOrders`,
  jobOrder: (tid: string, id: string) => `tenants/${tid}/jobOrders/${id}`,

  /**
   * Job Board Posts
   */
  jobBoardPosts: (tid: string) => `tenants/${tid}/jobBoardPosts`,
  jobBoardPost: (tid: string, id: string) => `tenants/${tid}/jobBoardPosts/${id}`,

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
   * User Groups (manual candidate grouping)
   */
  userGroups: (tid: string) => `tenants/${tid}/userGroups`,
  userGroup: (tid: string, id: string) => `tenants/${tid}/userGroups/${id}`,

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

  /**
   * Monitoring and events (for auditing)
   */
  monitoring: (tid: string) => `tenants/${tid}/monitoring`,
  events: (tid: string) => `tenants/${tid}/monitoring/events`,
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
    return path.startsWith('jobOrders/') && !path.includes('tenants/');
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
      console.error(`🚨 LEGACY PATH DETECTED: ${context} is using top-level jobOrders: ${path}`);
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
