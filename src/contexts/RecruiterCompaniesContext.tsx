import React, { createContext, useContext, useState, ReactNode } from 'react';

interface RecruiterCompaniesContextType {
  search: string;
  setSearch: (value: string) => void;
  showFavoritesOnly: boolean;
  setShowFavoritesOnly: (value: boolean) => void;
}

const RecruiterCompaniesContext = createContext<RecruiterCompaniesContextType | undefined>(undefined);

export const useRecruiterCompanies = () => {
  const context = useContext(RecruiterCompaniesContext);
  if (!context) {
    throw new Error('useRecruiterCompanies must be used within RecruiterCompaniesProvider');
  }
  return context;
};

interface RecruiterCompaniesProviderProps {
  children: ReactNode;
}

export const RecruiterCompaniesProvider: React.FC<RecruiterCompaniesProviderProps> = ({ children }) => {
  const [search, setSearch] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  return (
    <RecruiterCompaniesContext.Provider value={{ search, setSearch, showFavoritesOnly, setShowFavoritesOnly }}>
      {children}
    </RecruiterCompaniesContext.Provider>
  );
};

