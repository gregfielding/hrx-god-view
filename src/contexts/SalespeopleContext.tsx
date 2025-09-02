import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from './AuthContext';

interface Salesperson {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  crm_sales: boolean;
}

interface SalespeopleContextType {
  salespeople: Salesperson[];
  loading: boolean;
  error: string | null;
  refreshSalespeople: () => Promise<void>;
  getSalespeopleForTenant: (tenantId: string) => Promise<Salesperson[]>;
}

const SalespeopleContext = createContext<SalespeopleContextType | undefined>(undefined);

interface SalespeopleProviderProps {
  children: ReactNode;
}

export const SalespeopleProvider: React.FC<SalespeopleProviderProps> = ({ children }) => {
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.id;
  const [salespeople, setSalespeople] = useState<Salesperson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cache, setCache] = useState<Map<string, { data: Salesperson[]; timestamp: number }>>(new Map());
  const [lastFetch, setLastFetch] = useState<number>(0);

  const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes cache (increased)
  const MIN_FETCH_INTERVAL = 60 * 1000; // 60 seconds minimum between fetches (increased)

  const functions = getFunctions();
  const getSalespeopleForTenantFunction = httpsCallable(functions, 'getSalespeopleForTenant');

  const fetchSalespeople = async (targetTenantId: string): Promise<Salesperson[]> => {
    const now = Date.now();
    
    // Check cache first
    const cached = cache.get(targetTenantId);
    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      console.log('📦 Salespeople served from cache for tenant:', targetTenantId);
      return cached.data;
    }

    // Check if we recently fetched (rate limiting)
    if (now - lastFetch < MIN_FETCH_INTERVAL) {
      console.log('⏱️ Rate limiting: skipping fetch, using cached data');
      return cached?.data || [];
    }

    try {
      setLoading(true);
      setError(null);
      
      console.log('🔍 Fetching salespeople for tenant:', targetTenantId);
      
      const result = await getSalespeopleForTenantFunction({ tenantId: targetTenantId });
      const data = result.data as any;
      
      if (data.salespeople) {
        const salespeopleData = data.salespeople as Salesperson[];
        
        // Update cache
        setCache(prev => new Map(prev).set(targetTenantId, {
          data: salespeopleData,
          timestamp: now
        }));
        
        setLastFetch(now);
        console.log('✅ Salespeople fetched and cached:', salespeopleData.length, 'people');
        
        return salespeopleData;
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch salespeople';
      console.error('❌ Error fetching salespeople:', errorMessage);
      setError(errorMessage);
      
      // Return cached data if available, even if expired
      const cached = cache.get(targetTenantId);
      if (cached) {
        console.log('🔄 Returning expired cache due to error');
        return cached.data;
      }
      
      return [];
    } finally {
      setLoading(false);
    }
  };

  const getSalespeopleForTenant = async (targetTenantId: string): Promise<Salesperson[]> => {
    // If we already have data for this tenant, return it immediately
    const cached = cache.get(targetTenantId);
    if (cached) {
      return cached.data;
    }
    
    // Otherwise fetch it
    return await fetchSalespeople(targetTenantId);
  };

  const refreshSalespeople = async (): Promise<void> => {
    if (tenantId) {
      // Clear cache for this tenant
      setCache(prev => {
        const newCache = new Map(prev);
        newCache.delete(tenantId);
        return newCache;
      });
      
      // Fetch fresh data
      const freshData = await fetchSalespeople(tenantId);
      setSalespeople(freshData);
    }
  };

  // Auto-fetch when tenantId changes
  useEffect(() => {
    if (tenantId) {
      fetchSalespeople(tenantId).then(setSalespeople);
    }
  }, [tenantId]);

  const value: SalespeopleContextType = {
    salespeople,
    loading,
    error,
    refreshSalespeople,
    getSalespeopleForTenant
  };

  return (
    <SalespeopleContext.Provider value={value}>
      {children}
    </SalespeopleContext.Provider>
  );
};

export const useSalespeople = (): SalespeopleContextType => {
  const context = useContext(SalespeopleContext);
  if (context === undefined) {
    throw new Error('useSalespeople must be used within a SalespeopleProvider');
  }
  return context;
};

// Hook for getting salespeople for a specific tenant
export const useSalespeopleForTenant = (tenantId: string) => {
  const { getSalespeopleForTenant, loading, error } = useSalespeople();
  const [salespeople, setSalespeople] = useState<Salesperson[]>([]);

  useEffect(() => {
    if (tenantId) {
      getSalespeopleForTenant(tenantId).then(setSalespeople);
    }
  }, [tenantId, getSalespeopleForTenant]);

  return { salespeople, loading, error };
};
