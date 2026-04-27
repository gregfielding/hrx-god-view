import React, { createContext, useContext, useState, ReactNode } from 'react';

interface RecruiterUsersContextType {
  search: string;
  setSearch: (value: string) => void;
  showFavoritesOnly: boolean;
  setShowFavoritesOnly: (value: boolean) => void;
}

const RecruiterUsersContext = createContext<RecruiterUsersContextType | undefined>(undefined);

export const useRecruiterUsers = () => {
  const context = useContext(RecruiterUsersContext);
  if (!context) {
    throw new Error('useRecruiterUsers must be used within RecruiterUsersProvider');
  }
  return context;
};

interface RecruiterUsersProviderProps {
  children: ReactNode;
}

export const RecruiterUsersProvider: React.FC<RecruiterUsersProviderProps> = ({ children }) => {
  const [search, setSearch] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  return (
    <RecruiterUsersContext.Provider value={{ search, setSearch, showFavoritesOnly, setShowFavoritesOnly }}>
      {children}
    </RecruiterUsersContext.Provider>
  );
};

