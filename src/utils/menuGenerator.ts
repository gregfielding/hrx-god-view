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
  staffingModuleEnabled?: boolean,
  // New claims-based parameters
  isHRXUser?: boolean,
  currentClaimsRole?: ClaimsRole,
  claimsRoles?: { [tenantId: string]: { role: ClaimsRole; securityLevel: string } },
  // User profile flags
  userJobsBoardEnabled?: boolean,
  currentSecurityLevel?: string,
  tenantSlug?: string
): Promise<MenuItem[]> {
  const menuItems: MenuItem[] = [];
  
  // If no tenant slug provided but we have tenantId, fetch it from Firestore
  let effectiveTenantSlug = tenantSlug;
  if (!effectiveTenantSlug && tenantId) {
    try {
      const { doc, getDoc } = await import('firebase/firestore');
      const { db } = await import('../firebase');
      const tenantRef = doc(db, 'tenants', tenantId);
      const tenantSnap = await getDoc(tenantRef);
      if (tenantSnap.exists()) {
        effectiveTenantSlug = tenantSnap.data()?.slug || null;
      }
    } catch (err) {
      console.warn('Could not fetch tenant slug:', err);
    }
  }

  // Debug helper (toggled via ?debugMenu=1 or localStorage 'debugMenu' === '1')
  const isMenuDebugEnabled = (): boolean => {
    try {
      if (typeof window !== 'undefined') {
        const search = window.location?.search || '';
        if (search.includes('debugMenu=1')) return true;
        if (search.includes('debugMenu=0')) return false;
        return window.localStorage?.getItem('debugMenu') === '1';
      }
    } catch (_) {}
    return false;
  };

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
        // Prefer the tenantId argument from Layout when present; otherwise use stored activeTenantId
        activeTenantId = (tenantId ?? userData?.activeTenantId) || null;
        
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
  
  // Get effective security level - prioritize tenant-specific over global
  // First check tenant-specific security level from activeTenantData
  // Then check currentSecurityLevel (which may be claims-based or global)
  const effectiveSecurityLevel = activeTenantData?.securityLevel || currentSecurityLevel;
  // REMOVED: Excessive logging causing re-renders
  // REMOVED: Excessive logging causing re-renders

  // REMOVED: Excessive logging causing re-renders
  // REMOVED: Excessive logging causing re-renders
  // REMOVED: Excessive logging causing re-renders

  if (!isHRX) {
    // Add basic menu items that don't require specific roles (for users without claims)
    // ChatGPT moved to top bar navigation - removed from sidebar

    // Inbox - only for security levels 5-7 (internal team)
    if (effectiveSecurityLevel && ['5', '6', '7'].includes(String(effectiveSecurityLevel))) {
      menuItems.push({
        text: 'Inbox',
        to: '/inbox',
        icon: 'inbox',
      });
    }

    // Messages → /text-messages — hidden from sidebar (restore block to re-enable).
    // if (effectiveSecurityLevel && ['5', '6', '7'].includes(String(effectiveSecurityLevel))) {
    //   menuItems.push({
    //     text: 'Messages',
    //     to: '/text-messages',
    //     icon: 'sms',
    //   });
    // }

    // Slack Channels removed - now combined with Mentions in top bar

    // Tasks and Calendar moved to top bar navigation - removed from sidebar
    // {
    //   text: 'My Profile',
    //   to: '/profile',
    //   icon: 'person',
    // },

    // Add tenant-specific menu items with claims-based role requirements
    // Workforce Management moved to Settings - removed from sidebar
    menuItems.push(
      // Canonical Contacts/Companies (avoid duplication across Recruiter + CRM)
      // Show for security levels 5+ (Recruiter/Manager/Admin/Worker types)
      ...((effectiveSecurityLevel && ['5', '6', '7'].includes(effectiveSecurityLevel)) ? [
        {
          text: 'Accounts',
          to: '/accounts',
          icon: 'business',
          requiredRoles: ['Recruiter', 'Manager', 'Admin'] as ClaimsRole[],
        },
        {
          text: 'Contacts',
          to: '/contacts',
          icon: 'contacts',
          requiredRoles: ['Recruiter', 'Manager', 'Admin', 'Worker'] as ClaimsRole[],
        },
        {
          text: 'Companies',
          to: '/companies',
          icon: 'companies',
          requiredRoles: ['Recruiter', 'Manager', 'Admin', 'Worker'] as ClaimsRole[],
        },
        {
          text: 'Users',
          to: '/users',
          icon: 'people',
          requiredRoles: ['Recruiter', 'Manager', 'Admin'] as ClaimsRole[],
        },
        {
          text: 'Onboarding',
          to: '/staff-onboarding',
          icon: 'how_to_reg',
          requiredRoles: ['Recruiter', 'Manager', 'Admin'] as ClaimsRole[],
        },
      ] : []),
      // Only show Customers if HRX Customers module is enabled
      ...(customersModuleEnabled ? [{
        text: 'Customers',
        to: '/customers',
        icon: 'business',
        requiredRoles: ['Admin', 'Manager'] as ClaimsRole[], // Admin and Manager only
      }] : []),
      // Only show Flex Jobs if HRX Flex Engine module is enabled
      // ...(flexModuleEnabled ? [{
      //   text: 'Flex Jobs',
      //   to: '/flex',
      //   icon: 'assignment',
      //   requiredRoles: ['Admin', 'Manager'] as ClaimsRole[], // Admin and Manager only
      // }] : []),
      // Show Jobs Board: always for security levels 0-4 (public view)
      // For security levels 5-7, Jobs Board is now in the Recruiter module
      ...((() => {
        // Always show for security levels 0-4 (Applicants, Flex, Workers)
        if (effectiveSecurityLevel && ['0', '1', '2', '3', '4'].includes(effectiveSecurityLevel)) {
          return [{
            text: 'Jobs Board',
            to: effectiveTenantSlug ? `/${effectiveTenantSlug}/jobs-board` : '/c1/jobs-board',
            icon: 'work',
            requiredRoles: ['Applicant', 'Worker', 'Staff', 'Manager', 'Admin'] as ClaimsRole[],
          }];
        }
        
        // Removed Jobs Board for security levels 5-7 - now in Recruiter module
        return [];
      })()),
      // Show My Applications and My Assignments for staff (security levels 1-4)
      ...((effectiveSecurityLevel && ['1', '2', '3', '4'].includes(effectiveSecurityLevel)) ? [
        {
          text: 'My Applications',
          to: effectiveTenantSlug ? `/${effectiveTenantSlug}/applications` : '/c1/workers/applications',
          icon: 'fact_check',
          requiredRoles: ['Applicant', 'Worker', 'Staff'] as ClaimsRole[],
        },
        {
          text: 'My Assignments',
          to: effectiveTenantSlug ? `/${effectiveTenantSlug}/assignments` : '/c1/workers/assignments',
          icon: 'assignment_turned_in',
          requiredRoles: ['Applicant', 'Worker', 'Staff'] as ClaimsRole[],
        }
      ] : []),
      // Jobs (role-gated; no module gate)
      ...([{
        text: 'Jobs',
        to: '/jobs',
        icon: 'people',
        requiredRoles: ['Recruiter', 'Manager', 'Admin'] as ClaimsRole[], // Recruiter area access
      }]),
      // Finances & Budgeting: internal team (security levels 5, 6, 7)
      ...([{
        text: 'Finances and Budgeting',
        to: '/finances-budgeting',
        icon: 'bar_chart',
        accessRoles: ['tenant_5', 'tenant_6', 'tenant_7'],
      }]),
      // Global Invoicing (sidebar): security level 7 only – all accounts, reporting, create invoices
      ...([{
        text: 'Invoicing',
        to: '/invoicing',
        icon: 'attach_money',
        accessRoles: ['tenant_7'],
      }]),
      // Workers Comp (hidden from main sidebar — still under Settings → Operations → Workers Comp)
      // ...([{
      //   text: 'Workers Comp',
      //   to: '/settings?tab=workers-comp',
      //   icon: 'health_and_safety',
      //   accessRoles: ['tenant_5', 'tenant_6', 'tenant_7'],
      // }]),
      // Sales CRM (role-gated; no module gate)
      ...([{
        text: 'Sales CRM',
        to: '/crm',
        icon: 'business',
        requiredRoles: ['Admin', 'Manager', 'Recruiter', 'Worker'] as ClaimsRole[], // Admin, Manager, Recruiter, and Worker access
      }]),
      {
        text: 'My Assignments',
        to: '/assignments',
        icon: 'assignment_turned_in',
        requiredRoles: ['Worker'] as ClaimsRole[], // Worker access
      },

      {
        text: 'Settings',
        to: '/settings',
        icon: 'settings',
        requiredRoles: ['Admin'] as ClaimsRole[], // Admin only
      },
      // Only show Company Defaults if Staffing, Flex, or Recruiting modules are enabled AND user is Manager/Admin
      // ...((staffingModuleEnabled || flexModuleEnabled || recruiterModuleEnabled) ? [{
      //   text: 'Company Defaults',
      //   to: '/company-defaults',
      //   icon: 'business_center',
      //   requiredRoles: ['Manager', 'Admin'] as ClaimsRole[], // Manager and Admin only
      // }] : []),
      // (Temporarily hidden)
      // {
      //   text: 'Modules',
      //   to: '/modules',
      //   icon: 'extension',
      //   requiredRoles: ['Admin'] as ClaimsRole[], // Admin only
      // },
      // (Temporarily hidden)
      // {
      //   text: 'Reports',
      //   to: '/reports',
      //   icon: 'assessment',
      //   requiredRoles: ['Admin', 'Manager'] as ClaimsRole[], // Admin only
      // },
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
      // (Temporarily hidden)
      // {
      //   text: 'Mobile App',
      //   to: '/mobile-app',
      //   icon: 'phone_iphone',
      //   requiredRoles: ['Admin', 'Recruiter', 'Manager', 'Worker', 'Customer'] as ClaimsRole[], // All user types
      // },
      // Shown in sidebar for eligible roles; Layout hides for internal shell (security 5–7).
      {
        text: 'Privacy & Notifications',
        to: '/privacy-settings',
        icon: 'notifications',
        requiredRoles: ['Admin', 'Recruiter', 'Manager', 'Customer'] as ClaimsRole[],
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
    // ChatGPT moved to top bar navigation - removed from sidebar
    menuItems.push({
      text: 'My Account',
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
        requiredRoles: ['Admin', 'Manager', 'HRX'] as ClaimsRole[], // HRX users have full access
      },
      {
        text: 'Tenants',
        to: '/tenants',
        icon: 'business',
        requiredRoles: ['Admin', 'Manager', 'HRX'] as ClaimsRole[], // HRX users have full access
      },
      {
        text: 'Broadcasts',
        to: '/broadcasts',
        icon: 'campaign',
        requiredRoles: ['Admin', 'Manager', 'HRX'] as ClaimsRole[], // HRX users have full access
      },
      {
        text: 'AI Launchpad',
        to: '/admin/ai',
        icon: 'rocket_launch',
        requiredRoles: ['Admin', 'Manager', 'HRX'] as ClaimsRole[], // HRX users have full access
      },
      {
        text: 'Modules Dashboard',
        to: '/admin/modules',
        icon: 'apps',
        requiredRoles: ['Admin', 'Manager', 'HRX'] as ClaimsRole[], // HRX users have full access
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
        requiredRoles: ['Admin', 'Manager', 'HRX'] as ClaimsRole[], // HRX users have full access
      },
      {
        text: 'Data Operations',
        to: '/admin/data-operations',
        icon: 'data_object',
        requiredRoles: ['Admin', 'Manager', 'HRX'] as ClaimsRole[], // HRX users have full access
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

  // Debug: surface what we resolved for active tenant role/level
  if (isMenuDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.log('[menuGenerator] activeTenantId:', activeTenantId, 'role:', activeTenantData?.role, 'level:', activeTenantData?.securityLevel, 'items:', menuItems.length);
  }

  // Filter menu items based on ONLY the active tenant's role and security level
  const filteredItems = menuItems.filter(item => {
    // Always allow items without explicit requirements
    if (!item.accessRoles && !item.requiredRoles) return true;

    // Derive user's role and level strictly from active tenant
    const tenantRoleRaw = (activeTenantData?.role || '').toString();
    const securityValue = activeTenantData?.securityLevel ?? '0';
    const tenantLevel = parseInt(securityValue.toString());
    const tenantAccessKey = `tenant_${isNaN(tenantLevel) ? '0' : tenantLevel}`;

    // Derive an effective role from security level to be bulletproof
    let effectiveRole: ClaimsRole = 'Tenant';
    if (!isNaN(tenantLevel)) {
      if (tenantLevel >= 7) effectiveRole = 'Admin';
      else if (tenantLevel >= 6) effectiveRole = 'Manager';
      else if (tenantLevel >= 5) effectiveRole = 'Worker';
      else effectiveRole = 'Tenant';
    }
    // For admin users (security level 7), always use the derived role from security level
    // For other users, use Firestore role if available, otherwise use derived role
    const tenantRole = (tenantLevel >= 7) 
      ? effectiveRole  // Admin users: use security level derived role
      : (tenantRoleRaw ? (tenantRoleRaw as ClaimsRole) : effectiveRole); // Others: use Firestore role if available
    
    // Debug logging removed for cleaner console

    // Legacy accessRoles check using computed tenant access key
    if (item.accessRoles && item.accessRoles.length > 0) {
      return item.accessRoles.includes(tenantAccessKey);
    }

    // Required roles check using tenant role only
    if (item.requiredRoles && item.requiredRoles.length > 0) {
      const ok = item.requiredRoles.includes(tenantRole as ClaimsRole);
      
      // Debug logging removed for cleaner console
      
      return ok;
    }

    return true;
  });
  
  return filteredItems;
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

  // If claims haven't loaded or active tenant isn't known yet, don't hide items here.
  // Let the generator's own legacy/Firestore checks stand.
  if (!currentClaimsRole || !activeTenantId) {
    return menuItems;
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