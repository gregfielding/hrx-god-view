import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { collection, query, where, getDocs, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { db } from '../firebase';
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
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [cache, setCache] = useState<Map<string, { data: Salesperson[]; timestamp: number }>>(new Map());
  const [unsubscribe, setUnsubscribe] = useState<Unsubscribe | null>(null);

  const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes cache (much longer since we're using real-time updates)
  const MIN_FETCH_INTERVAL = 5 * 60 * 1000; // 5 minutes minimum between manual fetches

  // Simple Firestore query function - no more expensive Firebase function calls
  const fetchSalespeopleFromFirestore = async (targetTenantId: string): Promise<Salesperson[]> => {
    try {
      console.log('🔍 Fetching salespeople from Firestore for tenant:', targetTenantId);
      
      // Simple query: get all users with crm_sales: true
      const usersRef = collection(db, 'users');
      const q = query(
        usersRef,
        where('crm_sales', '==', true)
      );
      
      const querySnapshot = await getDocs(q);
      const allUsers = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Filter for users in this tenant (in memory filtering is fast for reasonable user counts)
      const salespeople = allUsers.filter((user: any) => {
        // Check if user has direct tenantId match
        if (user.tenantId === targetTenantId) return true;
        
        // Check if user has tenantId in tenantIds array
        if (user.tenantIds && Array.isArray(user.tenantIds) && user.tenantIds.includes(targetTenantId)) {
          return true;
        }
        
        // Check if user has tenantId in tenantIds object (new structure)
        if (user.tenantIds && typeof user.tenantIds === 'object' && !Array.isArray(user.tenantIds) && user.tenantIds[targetTenantId]) {
          return true;
        }
        
        return false;
      });
      
      console.log(`✅ Found ${salespeople.length} salespeople for tenant ${targetTenantId}`);
      
      // Map to response format
      const result = salespeople.map((user: any) => ({
        id: user.id,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || '',
        jobTitle: user.jobTitle || '',
        crm_sales: user.crm_sales || false
      }));
      
      return result;
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch salespeople from Firestore';
      console.error('❌ Error fetching salespeople from Firestore:', errorMessage);
      throw new Error(errorMessage);
    }
  };

  // Set up real-time listener for salespeople changes
  useEffect(() => {
    if (!tenantId) return;
    
    console.log('🔄 Setting up real-time listener for salespeople in tenant:', tenantId);
    
    // Clean up previous listener
    if (unsubscribe) {
      unsubscribe();
    }
    
    try {
      // Query for salespeople in this tenant
      const usersRef = collection(db, 'users');
      const q = query(
        usersRef,
        where('crm_sales', '==', true)
      );
      
      // Set up real-time listener
      const unsubscribeFn = onSnapshot(q, (querySnapshot) => {
        const allUsers = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Filter for users in this tenant
        const salespeople = allUsers.filter((user: any) => {
          if (user.tenantId === tenantId) return true;
          if (user.tenantIds && Array.isArray(user.tenantIds) && user.tenantIds.includes(tenantId)) {
            return true;
          }
          if (user.tenantIds && typeof user.tenantIds === 'object' && !Array.isArray(user.tenantIds) && user.tenantIds[tenantId]) {
            return true;
          }
          return false;
        });
        
        // Map to response format
        const result = salespeople.map((user: any) => ({
          id: user.id,
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          email: user.email || '',
          jobTitle: user.jobTitle || '',
          crm_sales: user.crm_sales || false
        }));
        
        console.log(`🔄 Real-time update: ${result.length} salespeople for tenant ${tenantId}`);
        setSalespeople(result);
        setLoading(false);
        setError(null);
        
        // Update cache
        setCache(prev => new Map(prev).set(tenantId, {
          data: result,
          timestamp: Date.now()
        }));
        
      }, (error) => {
        console.error('❌ Real-time listener error:', error);
        setError('Failed to listen for salespeople updates');
        setLoading(false);
      });
      
      setUnsubscribe(() => unsubscribeFn);
      
    } catch (error) {
      console.error('❌ Error setting up real-time listener:', error);
      setError('Failed to set up real-time listener');
      setLoading(false);
    }
    
    // Cleanup function
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [tenantId]);

  const fetchSalespeople = async (targetTenantId: string): Promise<Salesperson[]> => {
    const now = Date.now();
    
    // Check cache first
    const cached = cache.get(targetTenantId);
    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      console.log('📦 Salespeople served from cache for tenant:', targetTenantId);
      return cached.data;
    }

    try {
      setLoading(true);
      setError(null);
      
      // Use simple Firestore query instead of expensive Firebase function
      const salespeopleData = await fetchSalespeopleFromFirestore(targetTenantId);
      
      // Update cache
      setCache(prev => new Map(prev).set(targetTenantId, {
        data: salespeopleData,
        timestamp: now
      }));
      
      console.log('✅ Salespeople fetched and cached:', salespeopleData.length, 'people');
      
      return salespeopleData;
      
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
    
    // Otherwise fetch it using simple Firestore query
    return await fetchSalespeopleFromFirestore(targetTenantId);
  };

  const refreshSalespeople = async (): Promise<void> => {
    if (tenantId) {
      // Clear cache for this tenant
      setCache(prev => {
        const newCache = new Map(prev);
        newCache.delete(tenantId);
        return newCache;
      });
      
      // Fetch fresh data using simple Firestore query
      const freshData = await fetchSalespeopleFromFirestore(tenantId);
      setSalespeople(freshData);
    }
  };

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
