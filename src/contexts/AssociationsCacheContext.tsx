import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AssociationResult } from '../types/CRM';

interface CachedAssociationsData {
  associations: AssociationResult | null;
  availableEntities: {
    companies: any[];
    locations: any[];
    contacts: any[];
    deals: any[];
    salespeople: any[];
    divisions: any[];
  };
  timestamp: number;
  loading: boolean;
  error: string | null;
}

interface AssociationsCacheContextType {
  // Cache management
  getCachedData: (entityKey: string) => CachedAssociationsData | null;
  setCachedData: (entityKey: string, data: CachedAssociationsData) => void;
  clearCache: (entityKey?: string) => void;
  clearAllCache: () => void;
  
  // Cache utilities
  isCacheValid: (entityKey: string, maxAgeMs?: number) => boolean;
  getCacheAge: (entityKey: string) => number | null;
  
  // Cache statistics
  getCacheStats: () => {
    totalEntries: number;
    totalSize: number;
    oldestEntry: number | null;
    newestEntry: number | null;
  };
}

const AssociationsCacheContext = createContext<AssociationsCacheContextType | undefined>(undefined);

interface AssociationsCacheProviderProps {
  children: ReactNode;
  maxCacheAge?: number; // Default 5 minutes
  maxCacheSize?: number; // Default 50 entries
}

export const AssociationsCacheProvider: React.FC<AssociationsCacheProviderProps> = ({
  children,
  maxCacheAge = 5 * 60 * 1000, // 5 minutes
  maxCacheSize = 50
}) => {
  const [cache, setCache] = useState<Map<string, CachedAssociationsData>>(new Map());

  // Generate a unique key for an entity
  const generateEntityKey = useCallback((entityType: string, entityId: string, tenantId: string) => {
    return `${tenantId}:${entityType}:${entityId}`;
  }, []);

  // Get cached data for an entity
  const getCachedData = useCallback((entityKey: string): CachedAssociationsData | null => {
    const cached = cache.get(entityKey);
    if (!cached) return null;

    // Check if cache is still valid
    const age = Date.now() - cached.timestamp;
    if (age > maxCacheAge) {
      // Cache expired, remove it - defer to avoid setState during render
      setTimeout(() => {
        setCache(prev => {
          const newCache = new Map(prev);
          newCache.delete(entityKey);
          return newCache;
        });
      }, 0);
      return null;
    }

    return cached;
  }, [cache, maxCacheAge]);

  // Set cached data for an entity
  const setCachedData = useCallback((entityKey: string, data: CachedAssociationsData) => {
    setCache(prev => {
      const newCache = new Map(prev);
      
      // If cache is full, remove oldest entry
      if (newCache.size >= maxCacheSize) {
        let oldestKey = '';
        let oldestTime = Date.now();
        
        for (const [key, value] of newCache.entries()) {
          if (value.timestamp < oldestTime) {
            oldestTime = value.timestamp;
            oldestKey = key;
          }
        }
        
        if (oldestKey) {
          newCache.delete(oldestKey);
        }
      }
      
      newCache.set(entityKey, {
        ...data,
        timestamp: Date.now()
      });
      
      return newCache;
    });
  }, [maxCacheSize]);

  // Clear cache for specific entity or all
  const clearCache = useCallback((entityKey?: string) => {
    setCache(prev => {
      const newCache = new Map(prev);
      if (entityKey) {
        newCache.delete(entityKey);
      } else {
        newCache.clear();
      }
      return newCache;
    });
  }, []);

  // Clear all cache
  const clearAllCache = useCallback(() => {
    setCache(new Map());
  }, []);

  // Check if cache is still valid
  const isCacheValid = useCallback((entityKey: string, maxAgeMs?: number) => {
    const cached = cache.get(entityKey);
    if (!cached) return false;
    
    const age = Date.now() - cached.timestamp;
    const maxAge = maxAgeMs || maxCacheAge;
    return age <= maxAge;
  }, [cache, maxCacheAge]);

  // Get cache age in milliseconds
  const getCacheAge = useCallback((entityKey: string): number | null => {
    const cached = cache.get(entityKey);
    if (!cached) return null;
    return Date.now() - cached.timestamp;
  }, [cache]);

  // Get cache statistics
  const getCacheStats = useCallback(() => {
    if (cache.size === 0) {
      return {
        totalEntries: 0,
        totalSize: 0,
        oldestEntry: null,
        newestEntry: null
      };
    }

    let oldestTime = Date.now();
    let newestTime = 0;
    let totalSize = 0;

    for (const [_, value] of cache.entries()) {
      if (value.timestamp < oldestTime) {
        oldestTime = value.timestamp;
      }
      if (value.timestamp > newestTime) {
        newestTime = value.timestamp;
      }
      totalSize += JSON.stringify(value).length;
    }

    return {
      totalEntries: cache.size,
      totalSize,
      oldestEntry: oldestTime,
      newestEntry: newestTime
    };
  }, [cache]);

  const value: AssociationsCacheContextType = {
    getCachedData,
    setCachedData,
    clearCache,
    clearAllCache,
    isCacheValid,
    getCacheAge,
    getCacheStats
  };

  return (
    <AssociationsCacheContext.Provider value={value}>
      {children}
    </AssociationsCacheContext.Provider>
  );
};

// Hook to use the associations cache
export const useAssociationsCache = () => {
  const context = useContext(AssociationsCacheContext);
  if (context === undefined) {
    throw new Error('useAssociationsCache must be used within an AssociationsCacheProvider');
  }
  return context;
};

// Utility function to generate entity key
export const generateEntityKey = (entityType: string, entityId: string, tenantId: string): string => {
  return `${tenantId}:${entityType}:${entityId}`;
}; 