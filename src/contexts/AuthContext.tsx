import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

type AuthContextType = {
  user: User | null; // alias of currentUser
  currentUser: User | null;
  role: 'worker' | 'admin' | 'god';
  loading: boolean;
  logout: () => Promise<void>;
  avatarUrl: string;
  setAvatarUrl: (url: string) => void;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  currentUser: null,
  role: 'worker',
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
  const [role, setRole] = useState<'worker' | 'admin' | 'god'>('worker');
  const [loading, setLoading] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string>('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);

      if (user) {
        try {
          const userRef = doc(db, 'users', user.uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            const userData = userSnap.data();
            setRole(userData.role || 'worker');
            setAvatarUrl(userData.avatar || '');
          }
        } catch (err) {
          console.error('Error fetching role or avatar:', err);
        }
      } else {
        setRole('worker');
        setAvatarUrl('');
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const logout = async () => {
    await signOut(auth);
    setCurrentUser(null);
    setRole('worker');
    setAvatarUrl('');
  };

  return (
    <AuthContext.Provider
      value={{
        user: currentUser,
        currentUser,
        role,
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