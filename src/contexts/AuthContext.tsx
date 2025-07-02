import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
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
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  currentUser: null,
  role: 'Worker',
  securityLevel: 'Worker',
  accessRole: 'worker_3',
  modules: [],
  loading: true,
  logout: async () => {
    console.warn('logout called on uninitialized context');
  },
  avatarUrl: '',
  setAvatarUrl: () => {
    console.warn('setAvatarUrl called on uninitialized context');
  },
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role>('Worker');
  const [securityLevel, setSecurityLevel] = useState<SecurityLevel>('Worker');
  const [modules, setModules] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string>('');

  const accessRole = getAccessRole(role, securityLevel);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);

      if (user) {
        const userRef = doc(db, 'users', user.uid);

        const unsubscribeUser = onSnapshot(userRef, async (docSnap) => {
          if (docSnap.exists()) {
            const userData = docSnap.data();
            const userRole = userData.role || 'Worker';
            const userSecLevel = userData.securityLevel || 'Worker';
            const avatar = userData.avatar || '';

            setRole(userRole);
            setSecurityLevel(userSecLevel);
            setAvatarUrl(avatar);

            const computedAccessRole = getAccessRole(userRole, userSecLevel);

            // Load modules depending on accessRole
            let fetchedModules: string[] = [];

            if (computedAccessRole.startsWith('customer_')) {
              const customerRef = doc(db, 'customers', user.uid);
              const customerSnap = await getDoc(customerRef);
              fetchedModules = customerSnap.exists() ? customerSnap.data().modules || [] : [];
            } else if (computedAccessRole.startsWith('client_')) {
              const clientRef = doc(db, 'clients', user.uid);
              const clientSnap = await getDoc(clientRef);
              fetchedModules = clientSnap.exists() ? clientSnap.data().modules || [] : [];
            } else if (computedAccessRole.startsWith('hrx_')) {
              fetchedModules = ['*']; // HRX has access to all modules
            }

            setModules(fetchedModules);
          } else {
            setRole('Worker');
            setSecurityLevel('Worker');
            setModules([]);
            setAvatarUrl('');
          }

          setLoading(false);
        });

        return unsubscribeUser;
      } else {
        setRole('Worker');
        setSecurityLevel('Worker');
        setModules([]);
        setAvatarUrl('');
        setLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  const logout = async () => {
    await signOut(auth);
    setCurrentUser(null);
    setRole('Worker');
    setSecurityLevel('Worker');
    setModules([]);
    setAvatarUrl('');
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
