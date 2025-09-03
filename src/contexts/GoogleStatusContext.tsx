import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { CallableCache } from '../utils/callableCache';

interface GoogleStatus {
  gmail: {
    connected: boolean;
    email?: string;
    lastSync?: any;
    syncStatus: string;
  };
  calendar: {
    connected: boolean;
    email?: string;
    lastSync?: any;
    syncStatus: string;
  };
}

interface GoogleStatusContextType {
  googleStatus: GoogleStatus;
  loading: boolean;
  error: string | null;
  refreshStatus: () => Promise<void>;
  isOAuthInProgress: boolean;
  setIsOAuthInProgress: (value: boolean) => void;
}

const GoogleStatusContext = createContext<GoogleStatusContextType | undefined>(undefined);

export const useGoogleStatus = () => {
  const context = useContext(GoogleStatusContext);
  if (!context) {
    throw new Error('useGoogleStatus must be used within a GoogleStatusProvider');
  }
  return context;
};

interface GoogleStatusProviderProps {
  children: React.ReactNode;
  tenantId: string;
}

export const GoogleStatusProvider: React.FC<GoogleStatusProviderProps> = ({ children, tenantId }) => {
  const { user } = useAuth();
  const functions = getFunctions();
  const clientCacheRef = useRef(new CallableCache(90 * 60 * 1000));
  
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus>({
    gmail: { connected: false, syncStatus: 'not_synced' },
    calendar: { connected: false, syncStatus: 'not_synced' }
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOAuthInProgress, setIsOAuthInProgress] = useState(false);
  const [lastLoadTime, setLastLoadTime] = useState(0);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const DEBOUNCE_DELAY = 60 * 60 * 1000; // 60 minutes debounce (aggressively increased)

  // Lightweight in-memory cache to dedupe calls across components
  const STATUS_CACHE_TTL_MS = 90 * 60 * 1000; // 90 minutes
  let lastStatusCache: { data: GoogleStatus; at: number; userId: string } | null = null;
  const LS_KEY = 'googleStatus.cache.v1';

  // Load Google status with debouncing
  const loadGoogleStatus = useCallback(async () => {
    if (!user?.uid) return;

    // Serve from cache when fresh
    if (
      lastStatusCache &&
      lastStatusCache.userId === user.uid &&
      Date.now() - lastStatusCache.at < STATUS_CACHE_TTL_MS
    ) {
      setGoogleStatus(lastStatusCache.data);
      return;
    }
    // Try persistent cache shared across tabs
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed && parsed.userId === user.uid &&
          typeof parsed.at === 'number' && Date.now() - parsed.at < STATUS_CACHE_TTL_MS && parsed.data
        ) {
          setGoogleStatus(parsed.data as GoogleStatus);
          lastStatusCache = { data: parsed.data, at: parsed.at, userId: user.uid };
          return;
        }
      }
    } catch {}
    // Debounce rapid calls
    const now = Date.now();
    if (now - lastLoadTime < DEBOUNCE_DELAY) {
      console.log('Skipping Google status load - too soon since last call');
      return;
    }
    setLastLoadTime(now);

    setLoading(true);
    setError(null);

    try {
      // Use optimized functions with client-side dedupe + TTL
      const getCalendarStatus = httpsCallable(functions, 'getCalendarStatusOptimized');
      const getGmailStatus = httpsCallable(functions, 'getGmailStatusOptimized');

      const cache = clientCacheRef.current;
      const calendarData = await cache.getOrFetch<any>(`calendar:${user.uid}`, async () => {
        const res = await getCalendarStatus({ userId: user.uid });
        return res.data as any;
      });
      const gmailData = await cache.getOrFetch<any>(`gmail:${user.uid}`, async () => {
        const res = await getGmailStatus({ userId: user.uid });
        return res.data as any;
      });

      const newStatus: GoogleStatus = {
        gmail: {
          connected: !!(gmailData?.connected),
          email: gmailData?.email,
          lastSync: gmailData?.lastSync,
          syncStatus: gmailData?.syncStatus || 'not_synced'
        },
        calendar: {
          connected: !!(calendarData?.connected),
          email: calendarData?.email,
          lastSync: calendarData?.lastSync,
          syncStatus: calendarData?.syncStatus || 'not_synced'
        }
      };

      setGoogleStatus(newStatus);
      lastStatusCache = { data: newStatus, at: Date.now(), userId: user.uid };
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(lastStatusCache));
      } catch {}

      // If OAuth was in progress and we detect a successful connection, stop polling
      if (isOAuthInProgress && (newStatus.gmail.connected || newStatus.calendar.connected)) {
        setIsOAuthInProgress(false);
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      }

    } catch (error) {
      console.error('Error loading Google status:', error);
      setError('Failed to load Google connection status');
    } finally {
      setLoading(false);
    }
  }, [user?.uid, tenantId, isOAuthInProgress, lastLoadTime, functions]);

  // Only poll during OAuth. Otherwise, no background polling.
  const startStatusPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    // Poll every 20 seconds for up to 2 minutes (reduced again)
    let pollCount = 0;
    const maxPolls = 6; // 2 minutes max (6 * 20 seconds)

    pollingIntervalRef.current = setInterval(async () => {
      pollCount++;
      if (pollCount >= maxPolls) {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        setIsOAuthInProgress(false);
        return;
      }
      await loadGoogleStatus();
    }, 20000);
  }, [loadGoogleStatus]);

  // Refresh status function for manual refresh
  const refreshStatus = useCallback(async () => {
    if (user?.uid) {
      // Invalidate client cache to force a fresh fetch
      clientCacheRef.current.invalidate(`calendar:${user.uid}`);
      clientCacheRef.current.invalidate(`gmail:${user.uid}`);
      lastStatusCache = null;
      setLastLoadTime(0);
    }
    await loadGoogleStatus();
  }, [loadGoogleStatus, user?.uid]);

  // Start polling when OAuth is in progress
  useEffect(() => {
    if (isOAuthInProgress) {
      startStatusPolling();
    } else if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, [isOAuthInProgress, startStatusPolling]);

  // Initial load (only when tab is visible to avoid background churn)
  useEffect(() => {
    if (!user?.uid) return;
    const run = () => loadGoogleStatus();
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      const onVisible = () => {
        if (document.visibilityState === 'visible') {
          run();
          document.removeEventListener('visibilitychange', onVisible);
        }
      };
      document.addEventListener('visibilitychange', onVisible);
    } else {
      run();
    }
  }, [user?.uid, loadGoogleStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  const value: GoogleStatusContextType = {
    googleStatus,
    loading,
    error,
    refreshStatus,
    isOAuthInProgress,
    setIsOAuthInProgress
  };

  return (
    <GoogleStatusContext.Provider value={value}>
      {children}
    </GoogleStatusContext.Provider>
  );
};
