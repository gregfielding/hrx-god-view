import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { logger } from '../utils/logger';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';

import { auth, db } from '../firebase';
import { Role, SecurityLevel, getAccessRole } from '../utils/AccessRoles';
import { logLoginActivity, logLogoutActivity } from '../utils/activityLogger';

// New claims-based types
export type ClaimsRole = 'Admin' | 'Recruiter' | 'Manager' | 'Worker' | 'Customer' | 'Tenant' | 'HRX';
export type ClaimsSecurityLevel = '1' | '2' | '3' | '4' | '5' | '6' | '7';

export interface TenantRole {
  role: ClaimsRole;
  securityLevel: ClaimsSecurityLevel;
}

export interface CustomClaims {
  hrx?: boolean;
  roles?: {
    [tenantId: string]: TenantRole;
  };
  ver?: number;
}

type AuthContextType = {
  user: User | null;
  currentUser: User | null;
  role: Role;
  securityLevel: SecurityLevel;
  accessRole: string;
  modules: string[];
  loading: boolean;
  logout: () => Promise<void>;
  avatarUrl: string;
  setAvatarUrl: (url: string) => void;
  orgType: 'Tenant' | 'HRX' | null;
  tenantId?: string; // Primary tenant ID for backward compatibility
  tenantIds?: string[]; // Array of all tenant IDs the user belongs to
  activeTenant: any | null; // Active tenant object
  setActiveTenant: (tenant: any) => void; // Function to set active tenant
  // New claims-based properties
  isHRX: boolean;
  claimsRoles: { [tenantId: string]: TenantRole };
  currentClaimsRole?: ClaimsRole;
  currentClaimsSecurityLevel?: ClaimsSecurityLevel;
  refreshUserClaims: () => Promise<void>; // Function to refresh claims from token
  crmSalesEnabled?: boolean;
  recruiterEnabled?: boolean;
  jobsBoardEnabled?: boolean;
  setCreatingUserProfile: (creating: boolean) => void;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  currentUser: null,
  role: 'Tenant',
  securityLevel: '5',
  accessRole: 'tenant_3',
  modules: [],
  loading: true,
  logout: async () => {
    console.warn('logout called on uninitialized context');
  },
  avatarUrl: '',
  setAvatarUrl: () => {
    console.warn('setAvatarUrl called on uninitialized context');
  },
  orgType: null,
  activeTenant: null,
  setActiveTenant: () => {
    console.warn('setActiveTenant called on uninitialized context');
  },
  isHRX: false,
  claimsRoles: {},
  currentClaimsRole: undefined,
  currentClaimsSecurityLevel: undefined,
  refreshUserClaims: async () => {
    console.warn('refreshUserClaims called on uninitialized context');
  },
  crmSalesEnabled: false,
  recruiterEnabled: false,
  jobsBoardEnabled: false,
  setCreatingUserProfile: () => {
    console.warn('setCreatingUserProfile called on uninitialized context');
  },
});

export const useAuth = () => useContext(AuthContext);

// Helper hook to get the active tenant ID
export const useActiveTenantId = () => {
  const { activeTenant } = useAuth();
  return activeTenant?.id;
};

// Helper hook to get the current user's role for a specific tenant
export const useTenantRole = (tenantId: string) => {
  const { claimsRoles } = useAuth();
  return claimsRoles[tenantId];
};

// Helper hook to check if user has a specific role in the active tenant
export const useHasRole = (role: ClaimsRole) => {
  const { currentClaimsRole, isHRX } = useAuth();
  return isHRX || currentClaimsRole === role;
};

// Helper hook to check if user has any of the specified roles in the active tenant
export const useHasAnyRole = (roles: ClaimsRole[]) => {
  const { currentClaimsRole, isHRX } = useAuth();
  return isHRX || roles.includes(currentClaimsRole!);
};

// Helper hook to check if user is HRX
export const useIsHRX = () => {
  const { isHRX } = useAuth();
  return isHRX;
};

// Helper hook to check if user is admin in the active tenant
export const useIsTenantAdmin = () => {
  const { isHRX, currentClaimsRole } = useAuth();
  return isHRX || currentClaimsRole === 'Admin';
};

// Helper hook to check if user has any of the specified roles in a specific tenant
export const useHasRoleInTenant = (tenantId: string, roles: ClaimsRole[]) => {
  const { isHRX, claimsRoles } = useAuth();
  if (isHRX) return true; // HRX users have all roles
  const tenantRole = claimsRoles[tenantId];
  return tenantRole ? roles.includes(tenantRole.role) : false;
};

// Helper hook to require specific roles in a tenant (throws error if not authorized)
export const useRequireRole = (tenantId: string, roles: ClaimsRole[]) => {
  const { isHRX, claimsRoles, currentUser } = useAuth();
  
  if (!currentUser) {
    throw new Error('User not authenticated');
  }
  
  if (isHRX) return; // HRX users are always authorized
  
  const tenantRole = claimsRoles[tenantId];
  if (!tenantRole || !roles.includes(tenantRole.role)) {
    throw new Error(`User does not have required role. Required: ${roles.join(' or ')}, Current: ${tenantRole?.role || 'none'}`);
  }
};

// Helper hook to refresh user claims (useful after role changes)
export const useRefreshClaims = () => {
  const { refreshUserClaims } = useAuth();
  return refreshUserClaims;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role>('Tenant');
  const [securityLevel, setSecurityLevel] = useState<SecurityLevel>('5');
  const [modules, setModules] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string>('');
  const [orgType, setOrgType] = useState<'Tenant' | 'HRX' | null>(null);
  const [tenantId, setTenantId] = useState<string | undefined>(undefined);
  const [tenantIds, setTenantIds] = useState<string[]>([]);
  const [activeTenant, setActiveTenant] = useState<any | null>(null);
  const lastActiveTenantIdRef = useRef<string | undefined>(undefined);
  const lastWrittenActiveTenantIdRef = useRef<string | undefined>(undefined);
  // Add new state for tenantRoles
  const [tenantRoles, setTenantRoles] = useState<{ [tenantId: string]: { role: Role, securityLevel: SecurityLevel } }>({});
  
  // New claims-based state
  const [isHRX, setIsHRX] = useState<boolean>(false);
  const [claimsRoles, setClaimsRoles] = useState<{ [tenantId: string]: TenantRole }>({});
  const [currentClaimsRole, setCurrentClaimsRole] = useState<ClaimsRole | undefined>(undefined);
  const [currentClaimsSecurityLevel, setCurrentClaimsSecurityLevel] = useState<ClaimsSecurityLevel | undefined>(undefined);
  const hasReportedLoginRef = useRef<boolean>(false);
  const [crmSalesEnabled, setCrmSalesEnabled] = useState<boolean>(false);
  const [recruiterEnabled, setRecruiterEnabled] = useState<boolean>(false);
  const [jobsBoardEnabled, setJobsBoardEnabled] = useState<boolean>(false);
  const lastActivitySentAtRef = useRef<number>(0);
  const isCreatingUserProfileRef = useRef<boolean>(false);
  const lastUserDataRef = useRef<any>(null);

  const LOGIN_PING_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

  const shouldReportLoginPing = (uid: string) => {
    if (typeof window === 'undefined') return false;
    try {
      const key = `hrx:lastLoginPing:${uid}`;
      const now = Date.now();
      const lastPing = Number(localStorage.getItem(key) || '0');
      const dueToAge = now - lastPing > LOGIN_PING_INTERVAL_MS;

      return dueToAge;
    } catch (error) {
      console.warn('Login ping sampling failed:', error);
      return false;
    }
  };

  const recordLoginPing = (uid: string) => {
    if (typeof window === 'undefined') return;
    try {
      const key = `hrx:lastLoginPing:${uid}`;
      localStorage.setItem(key, Date.now().toString());
    } catch {
      // Ignore storage errors (private browsing, etc.)
    }
  };

  const setCreatingUserProfile = (creating: boolean) => {
    isCreatingUserProfileRef.current = creating;
  };

  // Update tenantId when activeTenant changes and save to database
  // Comment out this useEffect to break the infinite loop
  // useEffect(() => {
  //   if (activeTenant?.id && currentUser) {
  //     const userRef = doc(db, 'users', currentUser.uid);
  //     (async () => {
  //       const userSnap = await getDoc(userRef);
  //       const userData = userSnap.data();
  //       if (userData?.activeTenantId !== activeTenant.id) {
  //         await updateDoc(userRef, {
  //           activeTenantId: activeTenant.id,
  //           lastTenantSwitch: serverTimestamp()
  //         });
  //       }
  //     })();
  //   }
  // }, [activeTenant, currentUser]);

  // --- NEW: When activeTenant changes, update role/securityLevel ---
  // Comment out this useEffect to see if it's causing the infinite loop
  // useEffect(() => {
  //   if (activeTenant?.id && tenantRoles[activeTenant.id]) {
  //     setRole(tenantRoles[activeTenant.id].role || 'Worker');
  //     setSecurityLevel(tenantRoles[activeTenant.id].securityLevel || 'Worker');
  //   } else {
  //     setRole('Worker');
  //     setSecurityLevel('3');
  //   }
  // }, [activeTenant, tenantRoles]);

  const accessRole = getAccessRole(role, securityLevel);

  // Helper function to convert claims role to legacy role
  const convertClaimsRoleToLegacy = (claimsRole: ClaimsRole): Role => {
    switch (claimsRole) {
      case 'Admin':
        return 'HRX'; // Admin maps to HRX for legacy compatibility
      case 'Recruiter':
      case 'Manager':
      case 'Worker':
      case 'Customer':
        return 'Tenant';
      default:
        return 'Tenant';
    }
  };

  // Helper function to convert claims security level to legacy security level
  const convertClaimsSecurityToLegacy = (claimsSecurity: ClaimsSecurityLevel): SecurityLevel => {
    // Map claims security levels (1-7) to legacy security levels (0-7)
    switch (claimsSecurity) {
      case '7': return '7'; // HRX Admin
      case '6': return '6'; // HRX Manager
      case '5': return '5'; // Worker
      case '4': return '4'; // Hired Staff
      case '3': return '3'; // Flex
      case '2': return '2'; // Applicant
      case '1': return '1'; // Dismissed
      default: return '3';
    }
  };

  // Helper function to load claims from user token (force fresh token)
  const loadClaimsFromUser = async (user: User): Promise<CustomClaims> => {
    try {
      // Avoid forcing a token refresh on localhost development to prevent
      // Firestore WebChannel terminate noise due to credential changes
      const isLocalDev = typeof window !== 'undefined' && window.location.hostname === 'localhost' && process.env.NODE_ENV === 'development';
      const forceRefresh = !isLocalDev;
      const tokenResult = await user.getIdTokenResult(forceRefresh);
      const claims = tokenResult.claims as CustomClaims;
      logger.debug('Claims loaded');
      return claims || {};
    } catch (error) {
      logger.error('Failed to load claims from user token:', error);
      return {};
    }
  };

  // Helper function to refresh user claims (useful when switching tenants)
  const refreshUserClaims = async (): Promise<void> => {
    if (currentUser) {
      try {
        const claims = await loadClaimsFromUser(currentUser);
        const claimsRolesMap = claims.roles || {};
        const claimsTenantIds = Object.keys(claimsRolesMap);
        const isHRXUser = !!claims.hrx;

        // Update claims-based state
        setIsHRX(isHRXUser);
        setClaimsRoles(claimsRolesMap);

        // Update tenant IDs if they changed
        if (JSON.stringify(claimsTenantIds) !== JSON.stringify(tenantIds)) {
          setTenantIds(claimsTenantIds);
        }

        // Update role/security level for active tenant
        const activeTenantId = activeTenant?.id;
        if (activeTenantId && claimsRolesMap[activeTenantId]) {
          const claimsRole = claimsRolesMap[activeTenantId];
          setCurrentClaimsRole(claimsRole.role);
          setCurrentClaimsSecurityLevel(claimsRole.securityLevel);
          setRole(convertClaimsRoleToLegacy(claimsRole.role));
          setSecurityLevel(convertClaimsSecurityToLegacy(claimsRole.securityLevel));
        }
      } catch (error) {
        logger.error('Failed to refresh user claims:', error);
      }
    }
  };

  // Helper function to create default user document
  const createDefaultUserDoc = async (user: User) => {
    const userRef = doc(db, 'users', user.uid);
    
    // Check if AuthDialog is currently creating a user profile
    if (isCreatingUserProfileRef.current) {
      logger.debug('AuthDialog is creating user profile, skipping default document creation');
      return null;
    }
    
    // Check if user document already exists to prevent overwriting
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      logger.debug('User document already exists, not creating default document');
      return userSnap.data();
    }

    // For new users from public jobs board, don't create default document
    // The AuthDialog should handle user profile creation
    // We'll wait longer to ensure AuthDialog has time to create the profile
    logger.debug('Waiting for AuthDialog to create user profile...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check again after the delay
    if (isCreatingUserProfileRef.current) {
      logger.debug('AuthDialog is still creating user profile after delay, skipping default document creation');
      return null;
    }

    const userSnapAfterDelay = await getDoc(userRef);
    if (userSnapAfterDelay.exists()) {
      logger.debug('User document created by AuthDialog during delay, not creating default document');
      return userSnapAfterDelay.data();
    }

    // Only create default document for users who weren't created via AuthDialog
    // If we're on the C1 public routes, initialize with the correct Tenant/Applicant profile
    logger.debug('Creating fallback default user document');
    const isC1Route = typeof window !== 'undefined' && window.location.pathname.startsWith('/c1/');
    const c1TenantId = 'BCiP2bQ9CgVOCTfV6MhD';

    const defaultUserDoc = isC1Route
      ? {
          uid: user.uid,
          email: user.email || '',
          firstName: user.displayName?.split(' ')[0] || '',
          lastName: user.displayName?.split(' ').slice(1).join(' ') || '',
          role: 'Tenant' as Role,
          securityLevel: '2' as SecurityLevel, // Applicant level
          orgType: 'Tenant' as 'Tenant' | 'HRX',
          onboarded: false,
          createdAt: serverTimestamp(),
          lastLogin: serverTimestamp(),
          avatar: user.photoURL || '',
          activeTenantId: c1TenantId,
          tenantIds: {
            [c1TenantId]: {
              role: 'Applicant',
              securityLevel: '2',
            },
          },
          // New user defaults aligned with public jobs board
          isActive: true,
          workStatus: 'Active',
          workEligibility: false,
          dob: undefined,
          phoneE164: undefined,
          phoneVerified: false,
          address: {
            street: '',
            city: '',
            state: '',
            zipCode: '',
            coordinates: null,
          },
          languages: [],
          skills: [],
          certifications: [],
          userGroupIds: [],
          crm_sales: false,
          recruiter: false,
          jobsBoard: false, // Module access flag for managers/admins only
          source: 'public_jobs_board',
          // Default privacy and notification settings
          locationSettings: {
            locationSharingEnabled: true,
            locationGranularity: 'precise',
            locationUpdateFrequency: 'realtime',
          },
          notificationSettings: {
            pushNotifications: true,
            emailNotifications: true,
            smsNotifications: true,
            companionMessages: true,
            shiftReminders: true,
            safetyAlerts: true,
            performanceUpdates: true,
            quietHours: {
              enabled: false,
              startTime: '22:00',
              endTime: '08:00',
            },
          },
          privacySettings: {
            profileVisibility: 'managers',
            showContactInfo: true,
            showLocation: true,
            showPerformanceMetrics: true,
            allowDataAnalytics: true,
            allowAIInsights: true,
          },
        }
      : {
          uid: user.uid,
          email: user.email || '',
          firstName: user.displayName?.split(' ')[0] || '',
          lastName: user.displayName?.split(' ').slice(1).join(' ') || '',
          role: 'Tenant' as Role,
          securityLevel: '4' as SecurityLevel,
          orgType: 'HRX' as 'Tenant' | 'HRX',
          onboarded: false,
          createdAt: serverTimestamp(),
          lastLogin: serverTimestamp(),
          avatar: user.photoURL || '',
          activeTenantId: null, // Will be set when user switches to a tenant
        };

    // In localhost development, avoid client Firestore writes to prevent WebChannel noise
    try {
      const isLocalDev = typeof window !== 'undefined' && window.location.hostname === 'localhost' && process.env.NODE_ENV === 'development';
      if (isLocalDev) {
        try {
          const key = `dev:userDoc:${user.uid}`;
          localStorage.setItem(key, JSON.stringify({ ...defaultUserDoc, createdAt: Date.now(), lastLogin: Date.now() }));
        } catch {}
        return defaultUserDoc;
      }
    } catch {}

    await setDoc(userRef, defaultUserDoc);
    return defaultUserDoc;
  };

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);

      if (user) {
        // Report login once per session to update lastLoginAt and loginCount
        if (!hasReportedLoginRef.current) {
          const shouldReportLogin = shouldReportLoginPing(user.uid);
          if (!shouldReportLogin) {
            hasReportedLoginRef.current = true;
          } else {
            try {
              const functions = getFunctions();
              const updateUserLoginInfo = httpsCallable(functions as any, 'updateUserLoginInfo');
              const onC1Route = typeof window !== 'undefined' && window.location.pathname.startsWith('/c1/');
              await updateUserLoginInfo({
                userId: user.uid,
                loginData: {
                  deviceInfo: {
                    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
                    platform: typeof navigator !== 'undefined' ? (navigator as any).platform : 'unknown',
                    language: typeof navigator !== 'undefined' ? navigator.language : 'unknown',
                  },
                },
                // Context for first-time creation on public jobs board
                initializeIfMissing: true,
                source: onC1Route ? 'public_jobs_board' : undefined,
                tenantId: onC1Route ? 'BCiP2bQ9CgVOCTfV6MhD' : undefined,
              });
              recordLoginPing(user.uid);
              hasReportedLoginRef.current = true;
              // Log login activity only when we actually reported a login (throttled), so page refreshes don't spam the activity log
              try {
                const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
                const deviceType = /Mobile|Android|iPhone/i.test(userAgent) ? 'mobile' : 'desktop';
                await logLoginActivity(user.uid, { userAgent, deviceType });
              } catch (logError) {
                console.warn('Failed to log login activity:', logError);
              }
            } catch (err) {
              hasReportedLoginRef.current = true;
              console.warn('Failed to update user login info:', err);
            }
          }
        }

        const cleanupFns: Array<() => void> = [];

        // Start lightweight activity heartbeat (throttled)
        try {
          const functions = getFunctions();
          const updateUserActivity = httpsCallable(functions as any, 'updateUserActivity');

          const sendHeartbeat = async (reason: string) => {
            // Temporary guard: avoid CORS on production domain until server deploy
            const origin = typeof window !== 'undefined' ? window.location.origin : '';
            const allowlist = new Set(['http://localhost:3000', 'https://hrx1-d3beb.web.app', 'https://hrx1-d3beb.firebaseapp.com']);
            if (!allowlist.has(origin)) {
              return; // skip heartbeat to prevent CORS error spam
            }

            const now = Date.now();
            // 5-minute throttle client-side to avoid runaway cost
            if (now - lastActivitySentAtRef.current < 5 * 60 * 1000) return;
            lastActivitySentAtRef.current = now;
            try {
              await updateUserActivity({
                userId: user.uid,
                activity: {
                  route: typeof window !== 'undefined' ? window.location.pathname : undefined,
                  visibility: typeof document !== 'undefined' ? document.visibilityState === 'visible' : true,
                  reason,
                },
              });
            } catch (err) {
              console.warn('Failed to update user activity (suppressed):', err);
            }
          };

          // Initial heartbeat
          sendHeartbeat('auth_state_changed');

          // Visibility change heartbeat
          const handleVisibilityChange = () => sendHeartbeat('visibility_change');
          document.addEventListener('visibilitychange', handleVisibilityChange);

          // Route change heartbeat (simple heuristic)
          const handlePopState = () => sendHeartbeat('route_change');
          window.addEventListener('popstate', handlePopState);

          cleanupFns.push(() => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('popstate', handlePopState);
          });
        } catch (err) {
          console.warn('Heartbeat setup failed:', err);
        }

        // Load claims from user token (primary source of truth)
        const claims = await loadClaimsFromUser(user);
        const claimsRolesMap = claims.roles || {};
        const claimsTenantIds = Object.keys(claimsRolesMap);
        const isHRXUser = !!claims.hrx;

        // Set claims-based state
        setIsHRX(isHRXUser);
        setClaimsRoles(claimsRolesMap);

        const userRef = doc(db, 'users', user.uid);

        const unsubscribeUser = onSnapshot(userRef, async (docSnap) => {
          if (docSnap.exists()) {
            const userData = docSnap.data();
            const avatar = userData.avatar || '';
            const userOrgType = userData.orgType || 'HRX';

            // --- NEW: Handle tenantRoles as a map ---
            let tenantRolesMap: { [tenantId: string]: { role: Role, securityLevel: SecurityLevel } } = {};
            let userTenantIds: string[] = [];
            let primaryTenantId: string | undefined = undefined;

            // Prioritize claims-based tenant IDs, fallback to Firestore
            if (claimsTenantIds.length > 0) {
              userTenantIds = claimsTenantIds;
              primaryTenantId = userData.activeTenantId || userTenantIds[0];
            } else if (userData.tenantIds && typeof userData.tenantIds === 'object' && !Array.isArray(userData.tenantIds)) {
              tenantRolesMap = userData.tenantIds;
              userTenantIds = Object.keys(userData.tenantIds);
              primaryTenantId = userData.activeTenantId || userData.tenantId || userTenantIds[0];
            } else if (Array.isArray(userData.tenantIds)) {
              // Legacy array format fallback
              userTenantIds = userData.tenantIds;
              primaryTenantId = userData.activeTenantId || userData.tenantId || userTenantIds[0];
            } else if (userData.tenantId) {
              userTenantIds = [userData.tenantId];
              primaryTenantId = userData.activeTenantId || userData.tenantId;
            }

            // Update the ref to track what's currently in Firestore
            if (userData.activeTenantId) {
              lastWrittenActiveTenantIdRef.current = userData.activeTenantId;
            }

            setAvatarUrl(avatar);
            setOrgType(userOrgType === 'HRX' ? 'HRX' : 'Tenant');
            setTenantId(userData.activeTenantId || primaryTenantId || undefined);
            setTenantIds(userTenantIds);
            setTenantRoles(tenantRolesMap);

            // Set role/securityLevel based on claims (primary) or Firestore (fallback)
            const activeTenantId = userData.activeTenantId || primaryTenantId;
            
            // Per-user module flags - read from tenant-specific location first, then fallback to top-level
            const tenantData = activeTenantId && userData.tenantIds?.[activeTenantId] ? userData.tenantIds[activeTenantId] : {};
            
            // Module access check (debug logging removed)
            
            setCrmSalesEnabled(!!(tenantData.crm_sales ?? userData.crm_sales));
            setRecruiterEnabled(!!(tenantData.recruiter ?? userData.recruiter));
            // Jobs Board is included with Recruiter access (WorkersTable comment); explicit jobsBoard flag also grants access
            const hasRecruiter = !!(tenantData.recruiter ?? userData.recruiter);
            const hasJobsBoard = !!(tenantData.jobsBoard ?? userData.jobsBoard);
            setJobsBoardEnabled(hasJobsBoard || hasRecruiter);
            
            // Store userData in a ref so we can access it in the useEffect below
            lastUserDataRef.current = userData;
            
            if (activeTenantId && claimsRolesMap[activeTenantId]) {
              // Use claims-based role for active tenant
              const claimsRole = claimsRolesMap[activeTenantId];
              setCurrentClaimsRole(claimsRole.role);
              setCurrentClaimsSecurityLevel(claimsRole.securityLevel);
              setRole(convertClaimsRoleToLegacy(claimsRole.role));
              setSecurityLevel(convertClaimsSecurityToLegacy(claimsRole.securityLevel));
            } else if (activeTenantId && tenantRolesMap[activeTenantId]) {
              // Fallback to Firestore tenant roles
              setRole(tenantRolesMap[activeTenantId].role || 'Tenant');
              setSecurityLevel(tenantRolesMap[activeTenantId].securityLevel || '5');
            } else if (userData.role && userData.securityLevel) {
              // Fallback to the user's direct role/security level
              setRole(userData.role);
              setSecurityLevel(userData.securityLevel);
            } else {
              setRole('Tenant');
              setSecurityLevel('5');
            }

            // Set activeTenant object for context
            const tenantIdToUse = userData.activeTenantId || primaryTenantId;
            // Normalize C1 tenant ID typo (0 vs O): some user docs have BCiP2bQ9CgV0CTfV6MhD, canonical is BCiP2bQ9CgVOCTfV6MhD
            const C1_TENANT_ID_TYPO = 'BCiP2bQ9CgV0CTfV6MhD';
            const C1_TENANT_ID_CANONICAL = 'BCiP2bQ9CgVOCTfV6MhD';
            const resolvedTenantId = tenantIdToUse === C1_TENANT_ID_TYPO ? C1_TENANT_ID_CANONICAL : tenantIdToUse;
            const isInTenantIds = tenantIdToUse && (userTenantIds.includes(tenantIdToUse) || userTenantIds.includes(resolvedTenantId));
            if (tenantIdToUse && isInTenantIds) {
              try {
                const tenantRef = doc(db, 'tenants', resolvedTenantId);
                const tenantSnap = await getDoc(tenantRef);
                if (tenantSnap.exists()) {
                  setActiveTenant({ id: tenantSnap.id, ...tenantSnap.data() });
                } else {
                  setActiveTenant({ id: resolvedTenantId });
                }
              } catch (err) {
                setActiveTenant({ id: resolvedTenantId });
              }
            } else if (userTenantIds.length > 0) {
              const firstId = userTenantIds[0];
              const resolvedFirst = firstId === C1_TENANT_ID_TYPO ? C1_TENANT_ID_CANONICAL : firstId;
              try {
                const tenantRef = doc(db, 'tenants', resolvedFirst);
                const tenantSnap = await getDoc(tenantRef);
                if (tenantSnap.exists()) {
                  setActiveTenant({ id: tenantSnap.id, ...tenantSnap.data() });
                } else {
                  setActiveTenant({ id: resolvedFirst });
                }
              } catch (err) {
                setActiveTenant({ id: resolvedFirst });
              }
            } else {
              setActiveTenant(null);
            }

            // Load modules depending on accessRole
            let fetchedModules: string[] = [];

            if (accessRole.startsWith('tenant_') || accessRole.startsWith('agency_')) {
              // For tenant users, check all their tenants for modules
              for (const tid of userTenantIds) {
                const tenantRef = doc(db, 'tenants', tid);
                const tenantSnap = await getDoc(tenantRef);
                if (tenantSnap.exists()) {
                  const tenantData = tenantSnap.data();
                  const tenantModules = tenantData.modules || [];
                  fetchedModules = [...fetchedModules, ...tenantModules];
                  // If this tenant has tenants, also check customer-specific modules
                  if (tenantData.tenants && Array.isArray(tenantData.tenants)) {
                    for (const tenantId of tenantData.tenants) {
                      const customerRef = doc(db, 'tenants', tid, 'tenants', tenantId);
                      const customerSnap = await getDoc(customerRef);
                      if (customerSnap.exists()) {
                        const customerModules = customerSnap.data().modules || [];
                        fetchedModules = [...fetchedModules, ...customerModules];
                      }
                    }
                  }
                }
              }
              // Remove duplicates
              fetchedModules = [...new Set(fetchedModules)];
            } else if (accessRole.startsWith('hrx_')) {
              fetchedModules = ['*']; // HRX has access to all modules
            }

            setModules(fetchedModules);
          } else {
            // Create default user document if it doesn't exist
            try {
              await createDefaultUserDoc(user);
              // The onSnapshot will trigger again with the new document
            } catch (error) {
              console.error('Failed to create default user document:', error);
              setRole('Tenant');
              setSecurityLevel('3');
              setModules([]);
              setAvatarUrl('');
              setOrgType('HRX');
              setTenantId(undefined);
              setTenantIds([]);
              setActiveTenant(null);
              // Reset claims-based state
              setIsHRX(false);
              setClaimsRoles({});
              setCurrentClaimsRole(undefined);
              setCurrentClaimsSecurityLevel(undefined);
              setLoading(false);
            }
            return; // Don't set loading to false yet, wait for the new document
          }

          setLoading(false);
        });

        return () => {
          cleanupFns.forEach((fn) => {
            try { fn(); } catch {}
          });
        };
      } else {
        setRole('Tenant');
        setSecurityLevel('3');
        setModules([]);
        setAvatarUrl('');
        setOrgType(null);
        setTenantId(undefined);
        setTenantIds([]);
        setActiveTenant(null);
        // Reset claims-based state
        setIsHRX(false);
        setClaimsRoles({});
        setCurrentClaimsRole(undefined);
        setCurrentClaimsSecurityLevel(undefined);
        setCrmSalesEnabled(false);
        setRecruiterEnabled(false);
        setJobsBoardEnabled(false);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
    };
  }, []);

  // Update module flags when activeTenant changes (e.g., user switches tenants)
  useEffect(() => {
    if (!activeTenant?.id || !lastUserDataRef.current) return;
    
    const userData = lastUserDataRef.current;
    const tenantData = userData.tenantIds?.[activeTenant.id] || {};
    
    // Updating module flags for activeTenant change (debug logging removed)
    
    setCrmSalesEnabled(!!(tenantData.crm_sales ?? userData.crm_sales));
    setRecruiterEnabled(!!(tenantData.recruiter ?? userData.recruiter));
    const hasRecruiter = !!(tenantData.recruiter ?? userData.recruiter);
    const hasJobsBoard = !!(tenantData.jobsBoard ?? userData.jobsBoard);
    setJobsBoardEnabled(hasJobsBoard || hasRecruiter);
  }, [activeTenant?.id]);

  const logout = async () => {
    // Log logout activity before signing out
    if (currentUser) {
      try {
        const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
        await logLogoutActivity(currentUser.uid, {
          userAgent,
        });
      } catch (logError) {
        console.warn('Failed to log logout activity:', logError);
        // Don't block logout if activity logging fails
      }
    }
    
    await signOut(auth);
    setCurrentUser(null);
    setRole('Tenant');
    setSecurityLevel('3');
    setModules([]);
    setAvatarUrl('');
    setOrgType(null);
    setTenantId(undefined);
    setTenantIds([]);
    setActiveTenant(null);
    lastWrittenActiveTenantIdRef.current = undefined;
    // Reset claims-based state
    setIsHRX(false);
    setClaimsRoles({});
    setCurrentClaimsRole(undefined);
    setCurrentClaimsSecurityLevel(undefined);
    setCrmSalesEnabled(false);
    setRecruiterEnabled(false);
    setJobsBoardEnabled(false);
    // Redirect to jobs board
    window.location.href = '/c1/jobs-board';
  };

  return (
    <AuthContext.Provider
      value={{
        user: currentUser,
        currentUser,
        role,
        securityLevel,
        accessRole,
        modules,
        loading,
        logout,
        avatarUrl,
        setAvatarUrl,
        orgType,
        tenantId,
        tenantIds,
        activeTenant,
        setActiveTenant,
        // New claims-based properties
        isHRX,
        claimsRoles,
        currentClaimsRole,
        currentClaimsSecurityLevel,
        refreshUserClaims,
        crmSalesEnabled,
        recruiterEnabled,
        jobsBoardEnabled,
        setCreatingUserProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
