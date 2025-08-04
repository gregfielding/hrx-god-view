import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, getDoc, onSnapshot, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Role, SecurityLevel, getAccessRole } from '../utils/AccessRoles';

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
});

export const useAuth = () => useContext(AuthContext);

// Helper hook to get the active tenant ID
export const useActiveTenantId = () => {
  const { activeTenant } = useAuth();
  return activeTenant?.id;
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

            if (userData.tenantIds && typeof userData.tenantIds === 'object' && !Array.isArray(userData.tenantIds)) {
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

            // Set role/securityLevel for the active tenant
            if (userData.activeTenantId && tenantRolesMap[userData.activeTenantId]) {
              setRole(tenantRolesMap[userData.activeTenantId].role || 'Tenant');
              setSecurityLevel(tenantRolesMap[userData.activeTenantId].securityLevel || '5');
            } else if (primaryTenantId && tenantRolesMap[primaryTenantId]) {
              // Use the primary tenant's role/security level if no activeTenantId
              setRole(tenantRolesMap[primaryTenantId].role || 'Tenant');
              setSecurityLevel(tenantRolesMap[primaryTenantId].securityLevel || '5');
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
