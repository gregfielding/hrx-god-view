import React, { createContext, useContext, useState, ReactNode } from 'react';

interface CRMCacheState {
  activeTab: number;
  searchTerm: string;
  companyFilter: 'all' | 'my';
  contactFilter: 'all' | 'my';
  dealFilter: 'all' | 'my';
  taskFilter: 'all' | 'my';
  salesTeamFilter: 'all' | 'my';
  pipelineFilters: any;
  lastVisitedCompanyId?: string;
  // Added: state filters persistence
  companiesStateFilter?: string; // e.g., 'all' | 'TX'
  contactsStateFilter?: string;  // e.g., 'all' | 'TX'
}

interface CRMCacheContextType {
  cacheState: CRMCacheState;
  updateCacheState: (updates: Partial<CRMCacheState>) => void;
  clearCache: () => void;
  hasCachedState: boolean;
}

const defaultCacheState: CRMCacheState = {
  activeTab: 1, // Companies tab
  searchTerm: '',
  companyFilter: 'all',
  contactFilter: 'all',
  dealFilter: 'all',
  taskFilter: 'all',
  salesTeamFilter: 'all',
  pipelineFilters: {},
  companiesStateFilter: 'all',
  contactsStateFilter: 'all',
};

const CRMCacheContext = createContext<CRMCacheContextType | undefined>(undefined);

export const CRMCacheProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [cacheState, setCacheState] = useState<CRMCacheState>(defaultCacheState);
  const [hasCachedState, setHasCachedState] = useState(false);

  const updateCacheState = (updates: Partial<CRMCacheState>) => {
    setCacheState(prev => {
      const newState = { ...prev, ...updates };
      // Mark that we have cached state if any meaningful state exists
      const hasState = !!(newState.searchTerm || 
                      newState.activeTab !== 1 || 
                      newState.companyFilter !== 'all' ||
                      newState.contactFilter !== 'all' ||
                      newState.dealFilter !== 'all' ||
                      newState.taskFilter !== 'all' ||
                      newState.salesTeamFilter !== 'all' ||
                      (newState.companiesStateFilter && newState.companiesStateFilter !== 'all') ||
                      (newState.contactsStateFilter && newState.contactsStateFilter !== 'all') ||
                      Object.keys(newState.pipelineFilters).length > 0);
      
      setHasCachedState(hasState);
      return newState;
    });
  };

  const clearCache = () => {
    setCacheState(defaultCacheState);
    setHasCachedState(false);
  };

  return (
    <CRMCacheContext.Provider value={{
      cacheState,
      updateCacheState,
      clearCache,
      hasCachedState,
    }}>
      {children}
    </CRMCacheContext.Provider>
  );
};

export const useCRMCache = () => {
  const context = useContext(CRMCacheContext);
  if (context === undefined) {
    throw new Error('useCRMCache must be used within a CRMCacheProvider');
  }
  return context;
}; 