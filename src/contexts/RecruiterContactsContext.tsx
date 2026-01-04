import React, { createContext, useContext, useState, ReactNode } from 'react';

interface RecruiterContactsContextType {
  search: string;
  setSearch: (value: string) => void;
  showFavoritesOnly: boolean;
  setShowFavoritesOnly: (value: boolean) => void;
}

const RecruiterContactsContext = createContext<RecruiterContactsContextType | undefined>(undefined);

export const useRecruiterContacts = () => {
  const context = useContext(RecruiterContactsContext);
  if (!context) {
    throw new Error('useRecruiterContacts must be used within RecruiterContactsProvider');
  }
  return context;
};

interface RecruiterContactsProviderProps {
  children: ReactNode;
}

export const RecruiterContactsProvider: React.FC<RecruiterContactsProviderProps> = ({ children }) => {
  const [search, setSearch] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  return (
    <RecruiterContactsContext.Provider value={{ search, setSearch, showFavoritesOnly, setShowFavoritesOnly }}>
      {children}
    </RecruiterContactsContext.Provider>
  );
};

