import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore'; // 🔥 Import onSnapshot
import { auth, db } from '../firebase';
import { Role, SecurityLevel } from '../utils/AccessRoles'; // 🆕 Import Role, SecurityLevel

type AuthContextType = {
  user: User | null; // alias of currentUser
  currentUser: User | null;
  role: Role;
  securityLevel: SecurityLevel; // 🆕 New field
  loading: boolean;
  logout: () => Promise<void>;
  avatarUrl: string;
  setAvatarUrl: (url: string) => void;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  currentUser: null,
  role: 'Employee', // Default role
  securityLevel: 'Worker', // Default securityLevel
  loading: true,
  logout: async () => {
    console.warn('logout called on uninitialized context');
  },
  avatarUrl: '',
  setAvatarUrl: (url: string) => {
    console.warn('setAvatarUrl called on uninitialized context');
  },
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role>('Employee');
  const [securityLevel, setSecurityLevel] = useState<SecurityLevel>('Worker');
  const [loading, setLoading] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string>('');

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);

      if (user) {
        const userRef = doc(db, 'users', user.uid);

        // 🔥 Real-time listener for user document
        const unsubscribeUser = onSnapshot(userRef, (docSnap) => {
          if (docSnap.exists()) {
            const userData = docSnap.data();
            setRole(userData.role || 'Employee');
            setSecurityLevel(userData.securityLevel || 'Worker');
            setAvatarUrl(userData.avatar || '');
          } else {
            setRole('Employee');
            setSecurityLevel('Worker');
            setAvatarUrl('');
          }
          setLoading(false);
        });

        // Cleanup Firestore listener when user signs out
        return unsubscribeUser;
      } else {
        // User is signed out
        setRole('Employee');
        setSecurityLevel('Worker');
        setAvatarUrl('');
        setLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  const logout = async () => {
    await signOut(auth);
    setCurrentUser(null);
    setRole('Employee');
    setSecurityLevel('Worker');
    setAvatarUrl('');
  };

  return (
    <AuthContext.Provider
      value={{
        user: currentUser,
        currentUser,
        role,
        securityLevel,
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
