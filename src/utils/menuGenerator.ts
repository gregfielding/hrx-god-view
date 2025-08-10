import { doc, getDoc } from 'firebase/firestore';

import { auth, db } from '../firebase';

import { Role, SecurityLevel, getAccessRole } from './AccessRoles';


export interface MenuItem {
  text: string;
  to: string;
  icon?: string;
  accessRoles?: string[];
  orgTypes?: ('Tenant' | 'HRX')[];
  securityLevels?: SecurityLevel[];
}

export async function generateMenuItems(
  accessRole: string,
  orgType: 'Tenant' | 'HRX' | null,
  tenantId?: string,
  flexModuleEnabled?: boolean,
  recruiterModuleEnabled?: boolean,
  customersModuleEnabled?: boolean,
  jobsBoardModuleEnabled?: boolean,
  crmModuleEnabled?: boolean
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

  // Check if this is HRX based on specific tenant ID
  const isHRX =  activeTenantId === 'TgDJ4sIaC7x2n5cPs3rW';
  console.log('isHRX:',  isHRX);
  console.log('Flex module enabled:', flexModuleEnabled);

  console.log('Active tenant ID:', activeTenantId);
  console.log('Active tenant data:', activeTenantData);
  console.log('Active tenant Role:', activeTenantData?.role || 'No role found');
  console.log('Active tenant Security Level:', activeTenantData?.securityLevel || 'No security level found');

  if (!isHRX) {
    // Add tenant-specific menu items
    menuItems.push(
      {
        text: 'Dashboard',
        to: '/dashboard',
        icon: 'dashboard',
        accessRoles: ['tenant_7', 'tenant_6'], // Admin and Manager only
      },
      {
        text: 'Workforce',
        to: '/workforce',
        icon: 'people',
        accessRoles: ['tenant_7', 'tenant_6'], // Admin and Manager only
      },
      // Only show Customers if HRX Customers module is enabled
      ...(customersModuleEnabled ? [{
        text: 'Customers',
        to: '/customers',
        icon: 'business',
        accessRoles: ['tenant_7', 'tenant_6'], // Admin and Manager only
      }] : []),
      // Only show Flex Jobs if HRX Flex Engine module is enabled
      ...(flexModuleEnabled ? [{
        text: 'Flex Jobs',
        to: '/flex',
        icon: 'assignment',
        accessRoles: ['tenant_7', 'tenant_6'], // Admin and Manager only
      }] : []),
      // Only show Jobs Board if HRX Jobs Board module is enabled
      ...(jobsBoardModuleEnabled ? [{
        text: 'Jobs Board',
        to: '/jobs-board',
        icon: 'work',
        accessRoles: ['tenant_7', 'tenant_6'], // Admin and Manager only
      }] : []),
      // Only show Recruiter if HRX Recruiting Engine module is enabled
      ...(recruiterModuleEnabled ? [{
        text: 'Recruiter',
        to: '/recruiter',
        icon: 'people',
        accessRoles: ['tenant_7', 'tenant_6'], // Admin and Manager only
      }] : []),
      // Only show Sales CRM if HRX CRM module is enabled
      ...(crmModuleEnabled ? [{
        text: 'Sales CRM',
        to: '/crm',
        icon: 'business',
        accessRoles: ['tenant_7', 'tenant_6'], // Admin and Manager only
      }] : []),
      {
        text: 'My Assignments',
        to: '/assignments',
        icon: 'assignment_turned_in',
        accessRoles: ['tenant_3'], // Flex only
      },

      {
        text: 'Settings',
        to: '/settings',
        icon: 'settings',
        accessRoles: ['tenant_7', 'tenant_7'], // Admin and Manager only
      },
      {
        text: 'Modules',
        to: '/modules',
        icon: 'extension',
        accessRoles: ['tenant_7', 'tenant_7'], // Admin and Manager only
      },
      {
        text: 'Reports',
        to: '/reports',
        icon: 'assessment',
        accessRoles: ['tenant_7', 'tenant_7'], // Admin and Manager only
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
        accessRoles: ['tenant_5', 'tenant_4', 'tenant_3', 'tenant_2'], // All users except Applicants and Dismissed
      },
      {
        text: 'Privacy & Notifications',
        to: '/privacy-settings',
        icon: 'notifications',
        accessRoles: ['tenant_5', 'tenant_4', 'tenant_3', 'tenant_2'], // All users except Applicants and Dismissed
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
        accessRoles: ['tenant_7', 'tenant_6', 'tenant_5', 'tenant_4', 'tenant_3', 'tenant_2'], // All users except Applicants and Dismissed
      }
    );
  }

  if (isHRX) {
    // Add HRX-specific admin menu items
    menuItems.push(
      {
        text: 'Dashboard',
        to: '/dashboard',
        icon: 'dashboard',
        accessRoles: ['hrx_7', 'hrx_6'],
      },
      {
        text: 'Team Access',
        to: '/users',
        icon: 'people',
        accessRoles: ['hrx_7', 'hrx_6'],
      },
      {
        text: 'Tenants',
        to: '/tenants',
        icon: 'business',
        accessRoles: ['hrx_7', 'hrx_6'],
      },
      {
        text: 'Broadcasts',
        to: '/broadcasts',
        icon: 'campaign',
       accessRoles: ['hrx_7', 'hrx_6'],
      },
      {
        text: 'AI Launchpad',
        to: '/admin/ai',
        icon: 'rocket_launch',
       accessRoles: ['hrx_7', 'hrx_6'],
      },
      {
        text: 'Modules Dashboard',
        to: '/admin/modules',
        icon: 'apps',
       accessRoles: ['hrx_7', 'hrx_6'],
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
       accessRoles: ['hrx_7', 'hrx_6'],
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
        accessRoles: ['hrx_7', 'hrx_6'],
      }
    );
  }

  // Filter menu items based on security level
  return menuItems.filter(item => {
    if (!item.accessRoles) return true;
    
    // Get the user's security level for the active tenant
    const userSecurityLevel = activeTenantData?.securityLevel || '0';
    
    // Convert security level to number for comparison
    const userLevel = parseInt(userSecurityLevel);
    
    // Check if user has access to any of the required roles
    // Only show items that the user has explicit access to
    for (const requiredRole of item.accessRoles) {
      if (requiredRole.startsWith('hrx_')) {
        const requiredLevel = parseInt(requiredRole.split('_')[1]);
        if (userLevel === requiredLevel) return true;
      } else if (requiredRole.startsWith('tenant_')) {
        const requiredLevel = parseInt(requiredRole.split('_')[1]);
        if (userLevel === requiredLevel) return true;
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