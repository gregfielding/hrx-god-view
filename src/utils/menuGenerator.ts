import { doc, getDoc } from 'firebase/firestore';

import { auth, db } from '../firebase';

import { Role, SecurityLevel, getAccessRole } from './AccessRoles';
import { ClaimsRole } from '../contexts/AuthContext';


export interface MenuItem {
  text: string;
  to: string;
  icon?: string;
  accessRoles?: string[]; // Legacy access roles
  orgTypes?: ('Tenant' | 'HRX')[];
  securityLevels?: SecurityLevel[];
  // New claims-based role requirements
  requiredRoles?: ClaimsRole[]; // User needs ANY of these roles
  requireAllRoles?: boolean; // If true, user needs ALL roles
}

export async function generateMenuItems(
  accessRole: string,
  orgType: 'Tenant' | 'HRX' | null,
  tenantId?: string,
  flexModuleEnabled?: boolean,
  recruiterModuleEnabled?: boolean,
  customersModuleEnabled?: boolean,
  jobsBoardModuleEnabled?: boolean,
  crmModuleEnabled?: boolean,
  // New claims-based parameters
  isHRXUser?: boolean,
  currentClaimsRole?: ClaimsRole,
  claimsRoles?: { [tenantId: string]: { role: ClaimsRole; securityLevel: string } }
): Promise<MenuItem[]> {
  const menuItems: MenuItem[] = [];

  // Get current user data from Firestore
  let userData: any = null;
  let activeTenantId: string | null = null;
  let activeTenantData: any = null;

  const currentUser = auth.currentUser;
  if (currentUser) {
    try {
      const userRef = doc(db, 'users', currentUser.uid);
      const userDoc = await getDoc(userRef);
      
      if (userDoc.exists()) {
        userData = userDoc.data();
        activeTenantId = userData?.activeTenantId || null;
        
        // console.log('=== MENU GENERATOR DEBUG ===');
        // console.log('Current user data:', {
        //   uid: currentUser.uid,
        //   activeTenantId: userData.activeTenantId,
        //   tenantIds: userData.tenantIds,
        //   role: userData.role,
        //   securityLevel: userData.securityLevel,
        //   orgType: userData.orgType
        // });
        
        // Get the security level for the active tenant
        if (activeTenantId && userData?.tenantIds && userData.tenantIds[activeTenantId]) {
          activeTenantData = userData.tenantIds[activeTenantId];
          // console.log('Active tenant data:', {
          //   tenantId: userData.activeTenantId,
          //   role: activeTenantData.role,
          //   securityLevel: activeTenantData.securityLevel
          // });
        }
        
        // console.log('=== END MENU GENERATOR DEBUG ===');
      }
    } catch (error) {
      console.error('Error fetching user data in menu generator:', error);
    }
  }

  // Check if this is HRX based on specific tenant ID (not user claims)
  // HRX user status (isHRXUser) gives access to switch tenants, but doesn't force HRX menu
  const isHRX = activeTenantId === 'TgDJ4sIaC7x2n5cPs3rW';
  // REMOVED: Excessive logging causing re-renders
  // REMOVED: Excessive logging causing re-renders

  // REMOVED: Excessive logging causing re-renders
  // REMOVED: Excessive logging causing re-renders
  // REMOVED: Excessive logging causing re-renders

  if (!isHRX) {
    // Add basic menu items that don't require specific roles (for users without claims)
    menuItems.push(
      {
        text: 'Dashboard',
        to: '/dashboard',
        icon: 'dashboard',
        // No role requirements - available to all users
      },
      {
        text: 'My Profile',
        to: '/profile',
        icon: 'person',
        // No role requirements - available to all users
      },
    );

    // Add tenant-specific menu items with claims-based role requirements
    menuItems.push(
      {
        text: 'Workforce',
        to: '/workforce',
        icon: 'people',
        requiredRoles: ['Admin', 'Manager'], // Admin and Manager only
      },
      // Only show Customers if HRX Customers module is enabled
      ...(customersModuleEnabled ? [{
        text: 'Customers',
        to: '/customers',
        icon: 'business',
        requiredRoles: ['Admin', 'Manager'] as ClaimsRole[], // Admin and Manager only
      }] : []),
      // Only show Flex Jobs if HRX Flex Engine module is enabled
      ...(flexModuleEnabled ? [{
        text: 'Flex Jobs',
        to: '/flex',
        icon: 'assignment',
        requiredRoles: ['Admin', 'Manager'] as ClaimsRole[], // Admin and Manager only
      }] : []),
      // Only show Jobs Board if HRX Jobs Board module is enabled
      ...(jobsBoardModuleEnabled ? [{
        text: 'Jobs Board',
        to: '/jobs-board',
        icon: 'work',
        requiredRoles: ['Admin', 'Manager'] as ClaimsRole[], // Admin and Manager only
      }] : []),
      // Only show Recruiter if HRX Recruiting Engine module is enabled
      ...(recruiterModuleEnabled ? [{
        text: 'Recruiter',
        to: '/recruiter',
        icon: 'people',
        requiredRoles: ['Recruiter', 'Manager', 'Admin'] as ClaimsRole[], // Recruiter area access
      }] : []),
      // Only show Sales CRM if HRX CRM module is enabled
      ...(crmModuleEnabled ? [{
        text: 'Sales CRM',
        to: '/crm',
        icon: 'business',
        requiredRoles: ['Admin', 'Manager', 'Recruiter', 'Worker'] as ClaimsRole[], // Admin, Manager, Recruiter, and Worker access
      }] : []),
      {
        text: 'My Assignments',
        to: '/assignments',
        icon: 'assignment_turned_in',
        accessRoles: ['tenant_2', 'tenant_3', 'tenant_4', 'tenant_5'], // Worker access (security level 2-5)
      },

      {
        text: 'Settings',
        to: '/settings',
        icon: 'settings',
        requiredRoles: ['Admin'], // Admin only
      },
      {
        text: 'Modules',
        to: '/modules',
        icon: 'extension',
        requiredRoles: ['Admin'], // Admin only
      },
      {
        text: 'Reports',
        to: '/reports',
        icon: 'assessment',
        requiredRoles: ['Admin', 'Manager'], // Admin and Manager only
      },
      // {
      //   text: 'Team Access',
      //   to: '/users',
      //   icon: 'people',
      //   accessRoles: ['tenant_7'], // Admin only
      // },
      // {
      //   text: 'AI Settings',
      //   to: '/aisettings',
      //   icon: 'auto_fix_high',
      //   accessRoles: ['tenant_7'], // Admin only
      // },
      {
        text: 'Mobile App',
        to: '/mobile-app',
        icon: 'phone_iphone',
        accessRoles: ['tenant_2', 'tenant_3', 'tenant_4', 'tenant_5'], // Worker access (security level 2-5)
      },
      {
        text: 'Privacy & Notifications',
        to: '/privacy-settings',
        icon: 'notifications',
        accessRoles: ['tenant_2', 'tenant_3', 'tenant_4', 'tenant_5'], // Worker access (security level 2-5)
      },
      // {
      //   text: 'Help',
      //   to: '/help',
      //   icon: 'help',
      //   accessRoles: ['tenant_7', 'tenant_6', 'tenant_5', 'tenant_4', 'tenant_3', 'tenant_2'], // All users except Applicants and Dismissed
      // },
      {
        text: 'Log out',
        to: '#', // Will be handled specially in Layout
        icon: 'logout',
        // No role requirements - always visible to all authenticated users
      }
    );
  }

  if (isHRX) {
    // Add basic menu items for HRX users (no role requirements)
    menuItems.push(
      {
        text: 'Dashboard',
        to: '/dashboard',
        icon: 'dashboard',
        // No role requirements - available to all HRX users
      },
      {
        text: 'My Profile',
        to: '/profile',
        icon: 'person',
        // No role requirements - available to all HRX users
      },
    );

    // Add HRX-specific admin menu items
    menuItems.push(
      {
        text: 'Team Access',
        to: '/users',
        icon: 'people',
        requiredRoles: ['Admin', 'Manager', 'HRX'], // HRX users have full access
      },
      {
        text: 'Tenants',
        to: '/tenants',
        icon: 'business',
        requiredRoles: ['Admin', 'Manager', 'HRX'], // HRX users have full access
      },
      {
        text: 'Broadcasts',
        to: '/broadcasts',
        icon: 'campaign',
        requiredRoles: ['Admin', 'Manager', 'HRX'], // HRX users have full access
      },
      {
        text: 'AI Launchpad',
        to: '/admin/ai',
        icon: 'rocket_launch',
        requiredRoles: ['Admin', 'Manager', 'HRX'], // HRX users have full access
      },
      {
        text: 'Modules Dashboard',
        to: '/admin/modules',
        icon: 'apps',
        requiredRoles: ['Admin', 'Manager', 'HRX'], // HRX users have full access
      },
      // {
      //   text: 'AI Context Dashboard',
      //   to: '/admin/ai-context',
      //   icon: 'dashboard',
      //  accessRoles: ['hrx_7', 'hrx_6'],
      // },
      
      // {
      //   text: 'Feedback Engine',
      //   to: '/admin/feedback-engine',
      //   icon: 'feedback',
      //  accessRoles: ['hrx_7', 'hrx_6'],
      // },
      // {
      //   text: 'AI Campaigns',
      //   to: '/admin/ai-campaigns',
      //   icon: 'campaign',
      //  accessRoles: ['hrx_7', 'hrx_6'],
      // },
      {
        text: 'AI Logs',
        to: '/admin/ai-logs',
        icon: 'list_alt',
        requiredRoles: ['Admin', 'Manager', 'HRX'], // HRX users have full access
      },
      {
        text: 'Data Operations',
        to: '/admin/data-operations',
        icon: 'data_object',
        requiredRoles: ['Admin', 'Manager', 'HRX'], // HRX users have full access
      },
      // {
      //   text: 'AI Self Improvement',
      //   to: '/admin/ai-self-improvement',
      //   icon: 'psychology',
      //  accessRoles: ['hrx_7', 'hrx_6'],
      // },
      // {
      //   text: 'AI Analytics',
      //   to: '/admin/ai-analytics',
      //   icon: 'analytics',
      //  accessRoles: ['hrx_7', 'hrx_6'],
      // },
      // {
      //   text: 'AI Feedback Dashboard',
      //   to: '/admin/ai-feedback-dashboard',
      //   icon: 'feedback',
      //  accessRoles: ['hrx_7', 'hrx_6'],
      // },
      // {
      //   text: 'Job Satisfaction Insights',
      //   to: '/admin/jsi',
      //   icon: 'insights',
      //  accessRoles: ['hrx_7', 'hrx_6'],
      // },
      // {
      //   text: 'Auto Context Engine',
      //   to: '/admin/auto-context',
      //   icon: 'auto_fix_high',
      //  accessRoles: ['hrx_7', 'hrx_6'],
      // },
      // {
      //   text: 'Auto DevOps',
      //   to: '/admin/auto-devops',
      //   icon: 'build',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Auto DevOps Monitoring',
      //   to: '/admin/auto-devops-monitoring',
      //   icon: 'monitor',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Auto DevOps Pipeline',
      //   to: '/admin/auto-devops-pipeline',
      //   icon: 'pipeline',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Broadcast Management',
      //   to: '/admin/broadcast-management',
      //   icon: 'campaign',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Context Engine',
      //   to: '/admin/context-engine',
      //   icon: 'psychology',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Customer Tone Overrides',
      //   to: '/admin/customer-tone-overrides',
      //   icon: 'tune',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Daily Motivation',
      //   to: '/admin/daily-motivation',
      //   icon: 'emoji_emotions',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Hello Message Config',
      //   to: '/admin/hello-message-config',
      //   icon: 'message',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Hello Message Management',
      //   to: '/admin/hello-message-management',
      //   icon: 'message',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Help Management',
      //   to: '/admin/help-management',
      //   icon: 'help',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Log Coverage Dashboard',
      //   to: '/admin/log-coverage',
      //   icon: 'coverage',
      //   accessRoles: ['hrx_1'],
      // },
      {
        text: 'Mobile App Errors',
        to: '/admin/mobile-errors',
        icon: 'phone_iphone',
        accessRoles: ['hrx_7', 'hrx_6'],
      },
      // {
      //   text: 'Moments Engine',
      //   to: '/admin/moments-engine',
      //   icon: 'psychology',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Notifications Table',
      //   to: '/admin/notifications',
      //   icon: 'notifications',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Prompt Builder',
      //   to: '/admin/prompt-builder',
      //   icon: 'build',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Retrieval Filters',
      //   to: '/admin/retrieval-filters',
      //   icon: 'filter_list',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Scheduled Moments Dashboard',
      //   to: '/admin/scheduled-moments',
      //   icon: 'schedule',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Test Scheduler Button',
      //   to: '/admin/test-scheduler',
      //   icon: 'play_arrow',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Tone Settings',
      //   to: '/admin/tone-settings',
      //   icon: 'tune',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Traits Engine',
      //   to: '/admin/traits-engine',
      //   icon: 'psychology',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Translation Management',
      //   to: '/admin/translation',
      //   icon: 'translate',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'User Language Preferences',
      //   to: '/admin/user-language-preferences',
      //   icon: 'language',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Vector Settings',
      //   to: '/admin/vector-settings',
      //   icon: 'tune',
      //   accessRoles: ['hrx_1'],
      // },
      // {
      //   text: 'Weights Engine',
      //   to: '/admin/weights-engine',
      //   icon: 'tune',
      //   accessRoles: ['hrx_1'],
      // },
      {
        text: 'Help',
        to: '/help',
        icon: 'help',
        accessRoles: ['hrx_7', 'hrx_6'],
      },
      {
        text: 'Log out',
        to: '#',
        icon: 'logout',
        // No role requirements - always visible to all HRX users
      }
    );
  }

  // Filter menu items based on security level and roles
  return menuItems.filter(item => {
    // If no access requirements, show the item
    if (!item.accessRoles && !item.requiredRoles) return true;
    
    // Get the user's security level for the active tenant
    const userSecurityLevel = activeTenantData?.securityLevel || '0';
    const userLevel = parseInt(userSecurityLevel);
    
    // Check legacy accessRoles (security level based)
    if (item.accessRoles) {
      for (const requiredRole of item.accessRoles) {
        if (requiredRole.startsWith('hrx_')) {
          const requiredLevel = parseInt(requiredRole.split('_')[1]);
          if (userLevel === requiredLevel) return true;
        } else if (requiredRole.startsWith('tenant_')) {
          const requiredLevel = parseInt(requiredRole.split('_')[1]);
          if (userLevel === requiredLevel) return true;
        }
      }
    }
    
    // Check new requiredRoles (claims-based)
    if (item.requiredRoles && activeTenantData?.role) {
      const userRole = activeTenantData.role;
      if (item.requiredRoles.includes(userRole as ClaimsRole)) {
        return true;
      }
    }
    
    return false;
  });
}

export function hasMenuAccess(
  menuItem: MenuItem,
  role: Role,
  securityLevel: SecurityLevel,
  orgType: 'Tenant' | 'HRX' | null
): boolean {
  // Check org type restrictions
  if (menuItem.orgTypes && !menuItem.orgTypes.includes(orgType || 'HRX')) {
    return false;
  }

  // Check security level restrictions
  if (menuItem.securityLevels && !menuItem.securityLevels.includes(securityLevel)) {
    return false;
  }

  // Check access role restrictions
  if (menuItem.accessRoles) {
    const userAccessRole = getAccessRole(role, securityLevel);
    return menuItem.accessRoles.includes(userAccessRole);
  }

  return true;
}

/**
 * Filter menu items based on claims-based roles
 * This function checks if the user has the required roles for each menu item
 */
export function filterMenuItemsByClaims(
  menuItems: MenuItem[],
  isHRX: boolean,
  currentClaimsRole?: ClaimsRole,
  activeTenantId?: string,
  claimsRoles?: { [tenantId: string]: { role: ClaimsRole; securityLevel: string } }
): MenuItem[] {
  // If we're in the HRX tenant, HRX users can see all menu items
  if (isHRX) {
    return menuItems;
  }

  // Debug logging
  console.log('=== MENU FILTERING DEBUG ===');
  console.log('isHRX:', isHRX);
  console.log('currentClaimsRole:', currentClaimsRole);
  console.log('activeTenantId:', activeTenantId);
  console.log('claimsRoles:', claimsRoles);
  console.log('menuItems count:', menuItems.length);

  // If no claims role or active tenant, show basic menu items (fallback for users without claims)
  if (!currentClaimsRole || !activeTenantId) {
    // Return basic menu items that don't require specific roles
    return menuItems.filter(item => {
      // Show items that have no role requirements or only have legacy accessRoles
      return (!item.requiredRoles || item.requiredRoles.length === 0) || 
             (item.accessRoles && item.accessRoles.length > 0);
    });
  }

  return menuItems.filter(item => {
    // If item has legacy accessRoles, use legacy filtering (for backward compatibility)
    if (item.accessRoles && item.accessRoles.length > 0) {
      // Keep legacy items for now - they'll be filtered by the existing system
      return true;
    }

    // If item has new requiredRoles, use claims-based filtering
    if (item.requiredRoles && item.requiredRoles.length > 0) {
      const tenantRole = claimsRoles?.[activeTenantId];
      
      console.log(`Checking item "${item.text}":`, {
        requiredRoles: item.requiredRoles,
        tenantRole: tenantRole,
        hasAccess: tenantRole && item.requiredRoles.includes(tenantRole.role)
      });
      
      // Special handling for "Tenant" role - it should have access to everything
      if (tenantRole?.role === 'Tenant') {
        return true; // Tenant role sees everything
      }
      
      // Special handling for "HRX" role - HRX users have access to admin/manager items, not worker items
      if (tenantRole?.role === 'HRX') {
        // HRX users should not see worker-specific items
        // Only show items that are appropriate for admin/manager roles
        return !item.requiredRoles.includes('Worker');
      }
      
      if (item.requireAllRoles) {
        // User must have ALL required roles
        return item.requiredRoles.every(role => {
          // Check if user has this role in the active tenant
          return tenantRole?.role === role;
        });
      } else {
        // User needs ANY of the required roles
        return tenantRole && item.requiredRoles.includes(tenantRole.role);
      }
    }

    // If no role requirements specified, show the item
    return true;
  });
} 