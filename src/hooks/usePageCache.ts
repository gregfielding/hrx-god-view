import { useState, useEffect, useCallback } from 'react';

export interface PageCacheState {
  search?: string;
  filter?: string;
  locationStateFilter?: string;
  showFavoritesOnly?: boolean;
  /** Companies page: 'all' | 'my'. Job orders page: 'all' | company name string. */
  companyFilter?: string;
  contactFilter?: 'all' | 'my';
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  /** Recruiter Users table client pagination */
  usersTablePage?: number;
  usersTableRowsPerPage?: number;
  // Cached results data
  cachedResults?: any[];
  cachedResultsTimestamp?: number;
  [key: string]: any; // Allow additional fields
}

interface UsePageCacheOptions {
  pageKey: string; // Unique key for this page (e.g., 'companies', 'contacts', 'users')
  defaultState?: PageCacheState;
}

export const usePageCache = ({ pageKey, defaultState = {} }: UsePageCacheOptions) => {
  const storageKey = `pageCache_${pageKey}`;

  // Load initial state from sessionStorage
  const loadCachedState = useCallback((): PageCacheState => {
    try {
      const cached = sessionStorage.getItem(storageKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.warn(`[usePageCache] Failed to load cache for ${pageKey}:`, error);
    }
    return defaultState;
  }, [storageKey, defaultState]);

  const [cacheState, setCacheState] = useState<PageCacheState>(loadCachedState);

  // Save to sessionStorage whenever cacheState changes
  useEffect(() => {
    try {
      // Only save if there's meaningful state (not just defaults)
      const hasState = Object.keys(cacheState).some(key => {
        const value = cacheState[key];
        if (value === undefined || value === null || value === '') return false;
        if (key === 'showFavoritesOnly' && value === false) return false;
        if (key === 'companyFilter' && value === 'all') return false;
        if (key === 'contactFilter' && value === 'all') return false;
        if (key === 'locationStateFilter' && value === 'all') return false;
        if (key === 'filter' && value === 'all') return false;
        return true;
      });

      if (hasState) {
        sessionStorage.setItem(storageKey, JSON.stringify(cacheState));
      } else {
        // Clear if no meaningful state
        sessionStorage.removeItem(storageKey);
      }
    } catch (error) {
      console.warn(`[usePageCache] Failed to save cache for ${pageKey}:`, error);
    }
  }, [cacheState, storageKey]);

  const updateCache = useCallback((updates: Partial<PageCacheState>) => {
    setCacheState(prev => {
      const newState = { ...prev, ...updates };
      // If caching results, also store timestamp
      if (updates.cachedResults !== undefined) {
        newState.cachedResultsTimestamp = Date.now();
      }
      return newState;
    });
  }, []);
  
  // Helper to get cached results if they're still fresh (within 5 minutes)
  const getCachedResults = useCallback((): any[] | null => {
    const cached = cacheState.cachedResults;
    const timestamp = cacheState.cachedResultsTimestamp;
    if (!cached || !timestamp) return null;
    
    // Consider cache stale after 5 minutes
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    if (Date.now() - timestamp > CACHE_TTL) {
      return null;
    }
    
    return cached;
  }, [cacheState.cachedResults, cacheState.cachedResultsTimestamp]);

  const clearCache = useCallback(() => {
    setCacheState(defaultState);
    try {
      sessionStorage.removeItem(storageKey);
    } catch (error) {
      console.warn(`[usePageCache] Failed to clear cache for ${pageKey}:`, error);
    }
  }, [storageKey, defaultState]);

  const hasCachedState = useCallback((): boolean => {
    try {
      const cached = sessionStorage.getItem(storageKey);
      return !!cached;
    } catch {
      return false;
    }
  }, [storageKey]);

  return {
    cacheState,
    updateCache,
    clearCache,
    hasCachedState: hasCachedState(),
    getCachedResults,
  };
};
