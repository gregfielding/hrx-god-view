import React, { createContext, useContext, useState, ReactNode } from 'react';

interface RecruiterJobOrdersContextType {
  search: string;
  setSearch: (value: string) => void;
  showFavoritesOnly: boolean;
  setShowFavoritesOnly: (value: boolean) => void;
}

const RecruiterJobOrdersContext = createContext<RecruiterJobOrdersContextType | undefined>(undefined);

export const useRecruiterJobOrders = () => {
  const context = useContext(RecruiterJobOrdersContext);
  if (!context) {
    throw new Error('useRecruiterJobOrders must be used within RecruiterJobOrdersProvider');
  }
  return context;
};

interface RecruiterJobOrdersProviderProps {
  children: ReactNode;
}

export const RecruiterJobOrdersProvider: React.FC<RecruiterJobOrdersProviderProps> = ({ children }) => {
  const [search, setSearch] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  return (
    <RecruiterJobOrdersContext.Provider value={{ search, setSearch, showFavoritesOnly, setShowFavoritesOnly }}>
      {children}
    </RecruiterJobOrdersContext.Provider>
  );
};

