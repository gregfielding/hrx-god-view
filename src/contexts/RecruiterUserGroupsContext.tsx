import React, { createContext, useContext, useState, ReactNode, useRef, useCallback } from 'react';

interface RecruiterUserGroupsContextType {
  search: string;
  setSearch: (value: string) => void;
  showFavoritesOnly: boolean;
  setShowFavoritesOnly: (value: boolean) => void;
  onCreateNewGroup?: () => void;
  setOnCreateNewGroup: (handler: () => void) => void;
}

const RecruiterUserGroupsContext = createContext<RecruiterUserGroupsContextType | undefined>(undefined);

export const useRecruiterUserGroups = () => {
  const context = useContext(RecruiterUserGroupsContext);
  if (!context) {
    throw new Error('useRecruiterUserGroups must be used within RecruiterUserGroupsProvider');
  }
  return context;
};

interface RecruiterUserGroupsProviderProps {
  children: ReactNode;
}

export const RecruiterUserGroupsProvider: React.FC<RecruiterUserGroupsProviderProps> = ({ children }) => {
  const [search, setSearch] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const onCreateNewGroupRef = useRef<(() => void) | undefined>(undefined);

  const setOnCreateNewGroup = useCallback((handler: () => void) => {
    onCreateNewGroupRef.current = handler;
  }, []);

  const onCreateNewGroup = useCallback(() => {
    onCreateNewGroupRef.current?.();
  }, []);

  return (
    <RecruiterUserGroupsContext.Provider value={{ search, setSearch, showFavoritesOnly, setShowFavoritesOnly, onCreateNewGroup, setOnCreateNewGroup }}>
      {children}
    </RecruiterUserGroupsContext.Provider>
  );
};

