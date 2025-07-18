// List of known staffing company tenant IDs
export const STAFFING_COMPANY_IDS = [
  'BCiP2bQ9CgVOCTfV6MhD', // C1 Staffing
  // Add new staffing company IDs here as you create them
  // 'NEW_TENANT_ID_1', // Company Name 1
  // 'NEW_TENANT_ID_2', // Company Name 2
];

/**
 * Check if a tenant ID belongs to a staffing company
 * @param tenantId - The tenant ID to check
 * @returns boolean - True if the tenant is a staffing company
 */
export const isStaffingCompany = (tenantId: string): boolean => {
  return STAFFING_COMPANY_IDS.includes(tenantId);
};

/**
 * Get the list of all staffing company IDs
 * @returns string[] - Array of staffing company tenant IDs
 */
export const getStaffingCompanyIds = (): string[] => {
  return [...STAFFING_COMPANY_IDS];
};

/**
 * Add a new staffing company ID to the list
 * @param tenantId - The new tenant ID to add
 * @param companyName - The name of the company (for documentation)
 */
export const addStaffingCompany = (tenantId: string, companyName: string): void => {
  if (!STAFFING_COMPANY_IDS.includes(tenantId)) {
    STAFFING_COMPANY_IDS.push(tenantId);
    console.log(`Added ${companyName} (${tenantId}) to staffing companies list`);
  }
}; 