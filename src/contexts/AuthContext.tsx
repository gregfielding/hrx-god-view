import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';

import { auth, db } from '../firebase';
import { Role, SecurityLevel, getAccessRole } from '../utils/AccessRoles';

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
      const tokenResult = await user.getIdTokenResult(true); // Force fresh token
      const claims = tokenResult.claims as CustomClaims;
      console.log('=== CLAIMS DEBUG ===');
      console.log('Raw claims:', claims);
      console.log('claims.hrx:', claims.hrx);
      console.log('claims.roles:', claims.roles);
      console.log('=== END CLAIMS DEBUG ===');
      return claims || {};
    } catch (error) {
      console.error('Failed to load claims from user token:', error);
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
        console.error('Failed to refresh user claims:', error);
      }
    }
  };

  // Helper function to create default user document
  const createDefaultUserDoc = async (user: User) => {
    const userRef = doc(db, 'users', user.uid);
    
    // Check if user document already exists to prevent overwriting
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      console.log('User document already exists, not creating default document');
      return userSnap.data();
    }
    
    const defaultUserDoc = {
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

    await setDoc(userRef, defaultUserDoc);
    return defaultUserDoc;
  };

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);

      if (user) {
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
            if (tenantIdToUse && userTenantIds.includes(tenantIdToUse)) {
              try {
                const tenantRef = doc(db, 'tenants', tenantIdToUse);
                const tenantSnap = await getDoc(tenantRef);
                if (tenantSnap.exists()) {
                  setActiveTenant({ id: tenantSnap.id, ...tenantSnap.data() });
                } else {
                  setActiveTenant({ id: tenantIdToUse });
                }
              } catch (err) {
                setActiveTenant({ id: tenantIdToUse });
              }
            } else if (userTenantIds.length > 0) {
              try {
                const tenantRef = doc(db, 'tenants', userTenantIds[0]);
                const tenantSnap = await getDoc(tenantRef);
                if (tenantSnap.exists()) {
                  setActiveTenant({ id: tenantSnap.id, ...tenantSnap.data() });
                } else {
                  setActiveTenant({ id: userTenantIds[0] });
                }
              } catch (err) {
                setActiveTenant({ id: userTenantIds[0] });
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

        return unsubscribeUser;
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
        setLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  const logout = async () => {
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
