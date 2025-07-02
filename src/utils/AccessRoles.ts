// src/utils/AccessRoles.ts

export type Role =
  | 'Applicant'
  | 'Worker'
  | 'Customer'
  | 'Agency'
  | 'HRX'
  | 'Dismissed';
export type SecurityLevel = 'Admin' | 'Manager' | 'Worker' | 'Staffer';

export const AccessRoleMap: Record<string, string> = {
  HRX_Admin: 'hrx_1',
  HRX_Manager: 'hrx_2',
  Customer_Admin: 'customer_1',
  Customer_Manager: 'customer_2',
  Customer_Staffer: 'customer_3',
  Customer_Worker: 'customer_4',
  Agency_Admin: 'agency_1',
  Agency_Manager: 'agency_2',
  Agency_Staffer: 'agency_3',
  Agency_Worker: 'agency_4',
  Employee_Worker: 'employee_3',
  Contractor_Worker: 'contractor_3',
  Applicant_Worker: 'applicant_3',
  Dismissed_Worker: 'dismissed_3',
  // Add other mappings as needed
};

export function getAccessRole(role: Role, securityLevel: SecurityLevel): string {
  const key = `${role}_${securityLevel}`;
  return AccessRoleMap[key] || 'default';
}

export function hasAccess(required: string, role: Role, securityLevel: SecurityLevel): boolean {
  return getAccessRole(role, securityLevel) === required;
}

// Ensure the file is treated as a module
export {};
