// src/utils/AccessRoles.ts

export type Role =
  | 'Applicant'
  | 'Employee'
  | 'Contractor'
  | 'Tenant'
  | 'Client'
  | 'HRX'
  | 'Dismissed';
export type SecurityLevel = 'Admin' | 'Manager' | 'Worker' | 'Staffer';

export const AccessRoleMap: Record<string, string> = {
  HRX_Admin: 'hrx_1',
  HRX_Manager: 'hrx_2',
  Tenant_Admin: 'tenant_1',
  Tenant_Manager: 'tenant_2',
  Tenant_Staffer: 'tenant_3',
  Tenant_Worker: 'tenant_4',
  Client_Admin: 'client_1',
  Client_Manager: 'client_2',
  Client_Staffer: 'client_3',
  Client_Worker: 'client_4',
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
