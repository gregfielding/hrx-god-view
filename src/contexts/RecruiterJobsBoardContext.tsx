import React, { createContext, useContext, useState, ReactNode, useRef, useCallback } from 'react';

interface RecruiterJobsBoardContextType {
  search: string;
  setSearch: (value: string) => void;
  showFavoritesOnly: boolean;
  setShowFavoritesOnly: (show: boolean) => void;
  onNewPost?: () => void;
  setOnNewPost: (handler: () => void) => void;
}

const RecruiterJobsBoardContext = createContext<RecruiterJobsBoardContextType | undefined>(undefined);

export const useRecruiterJobsBoard = () => {
  const context = useContext(RecruiterJobsBoardContext);
  if (!context) {
    throw new Error('useRecruiterJobsBoard must be used within RecruiterJobsBoardProvider');
  }
  return context;
};

interface RecruiterJobsBoardProviderProps {
  children: ReactNode;
}

export const RecruiterJobsBoardProvider: React.FC<RecruiterJobsBoardProviderProps> = ({ children }) => {
  const [search, setSearch] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const onNewPostRef = useRef<(() => void) | undefined>(undefined);

  const setOnNewPost = useCallback((handler: () => void) => {
    onNewPostRef.current = handler;
  }, []);

  const onNewPost = useCallback(() => {
    onNewPostRef.current?.();
  }, []);

  return (
    <RecruiterJobsBoardContext.Provider value={{ search, setSearch, showFavoritesOnly, setShowFavoritesOnly, onNewPost, setOnNewPost }}>
      {children}
    </RecruiterJobsBoardContext.Provider>
  );
};

