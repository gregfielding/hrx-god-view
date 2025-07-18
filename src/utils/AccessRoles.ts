// src/utils/AccessRoles.ts

// export type Role = 'Applicant' | 'Worker' | 'Customer' | 'Agency' | 'HRX' | 'Dismissed';
// export type SecurityLevel = 'Admin' | 'Manager' | 'Worker' | 'Staffer';

export type Role = 'Tenant' | 'HRX';
export type SecurityLevel = '7' | '6' |'5' | '4' | '3' | '2' | '1' | '0';

// Security level meanings:
// '7' = Admin highest access)
// '6' = Manager
// '5' = Worker
// '4' = Hired Staff
// '3' = Flex
// '2' = Applicant
// '1' = Dismissed
// '0' = Suspended (lowest access)

export const AccessRoleMap: Record<string, string> = {
  HRX_7: 'hrx_7',      // HRX Admin
  HRX_6: 'hrx_6',      // HRX Manager
  HRX_5: 'hrx_5',      // HRX Worker
  Tenant_7: 'tenant_7', // Tenant Admin
  Tenant_6: 'tenant_6', // Tenant Manager
  Tenant_5: 'tenant_5', // Tenant Worker
  Tenant_4: 'tenant_4', // Tenant Hired Staff
  Tenant_3: 'tenant_3', // Tenant Flex
  Tenant_2: 'tenant_2', // Tenant Applicant
  Tenant_1: 'tenant_1', // Tenant Dismissed
  Tenant_0: 'tenant_0', // Tenant Suspended
  // Add other mappings as needed
};

export function getAccessRole(role: Role, securityLevel: SecurityLevel): string {
  const key = `${role}_${securityLevel}`;
  const accessRole = AccessRoleMap[key];
  
  // If we have a specific mapping, use it
  if (accessRole) {
    return accessRole;
  }
  
  // Fallback logic for common combinations
  if (role === 'HRX') {
    switch (securityLevel) {
      case '7': return 'hrx_7'; // Admin
      case '6': return 'hrx_6'; // Manager
      case '5': return 'hrx_5'; // Worker
      default: return 'hrx_5';
    }
  }
  if (role === 'Tenant') {
    switch (securityLevel) {
      case '7': return 'tenant_7'; // Admin
      case '6': return 'tenant_6'; // Manager
      case '5': return 'tenant_5'; // Worker
      case '4': return 'tenant_4'; // Hired Staff
      case '3': return 'tenant_3'; // Flex
      case '2': return 'tenant_2'; // Applicant
      case '1': return 'tenant_1'; // Dismissed
      case '0': return 'tenant_0'; // Suspended
      default: return 'tenant_2';
    }
  }
  // if (role === 'Agency') {
  //   switch (securityLevel) {
  //     case 'Admin': return 'agency_1';
  //     case 'Manager': return 'agency_2';
  //     case 'Staffer': return 'agency_3';
  //     case 'Worker': return 'agency_4';
  //     default: return 'agency_3';
  //   }
  // }
  // if (role === 'Worker') {
  //   return 'worker_1';
  // }
  
  // Default fallback
  return 'tenant_1';
}

export function hasAccess(required: string, role: Role, securityLevel: SecurityLevel): boolean {
  const userAccessRole = getAccessRole(role, securityLevel);

  // HRX has access to everything
  if (userAccessRole.startsWith('hrx_')) {
    return true;
  }

  // Exact match
  if (userAccessRole === required) {
    return true;
  }

  // Access level hierarchy for new structure
  const accessLevels: Record<string, number> = {
    'hrx_7': 25, // HRX Admin
    'hrx_6': 20, // HRX Manager
    'hrx_5': 19, // HRX Worker
    'tenant_7': 15, // Tenant Admin
    'tenant_6': 10, // Tenant Manager
    'tenant_5': 8,  // Tenant Worker
    'tenant_4': 5,  // Tenant Hired Staff
    'tenant_3': 2,  // Tenant Flex
    'tenant_2': 1,  // Tenant Applicant
    'tenant_1': 0,  // Tenant Dismissed
    'tenant_0': -1, // Tenant Suspended
  };

  const userLevel = accessLevels[userAccessRole] || 0;
  const requiredLevel = accessLevels[required] || 0;

  // Allow if user has higher or equal access level
  return userLevel >= requiredLevel;
}

// Ensure the file is treated as a module
export {};
