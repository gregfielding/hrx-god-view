import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { getFunctions, httpsCallable } from 'firebase/functions';

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
  
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus>({
    gmail: { connected: false, syncStatus: 'not_synced' },
    calendar: { connected: false, syncStatus: 'not_synced' }
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOAuthInProgress, setIsOAuthInProgress] = useState(false);
  const [lastLoadTime, setLastLoadTime] = useState(0);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const DEBOUNCE_DELAY = 2000; // 2 seconds debounce

  // Load Google status with debouncing
  const loadGoogleStatus = useCallback(async () => {
    if (!user?.uid) return;
    
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
      const getCalendarStatus = httpsCallable(functions, 'getCalendarStatus');
      const getGmailStatus = httpsCallable(functions, 'getGmailStatus');
      
      const [calendarResult, gmailResult] = await Promise.all([
        getCalendarStatus({ userId: user.uid, tenantId }),
        getGmailStatus({ userId: user.uid, tenantId })
      ]);
      
      const calendarData = calendarResult.data as any;
      const gmailData = gmailResult.data as any;
      
      const newStatus = {
        gmail: {
          connected: gmailData?.connected || false,
          email: gmailData?.email,
          lastSync: gmailData?.lastSync,
          syncStatus: gmailData?.syncStatus || 'not_synced'
        },
        calendar: {
          connected: calendarData?.connected || false,
          email: calendarData?.email,
          lastSync: calendarData?.lastSync,
          syncStatus: calendarData?.syncStatus || 'not_synced'
        }
      };
      
      setGoogleStatus(newStatus);
      
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

  // Start polling for status updates during OAuth
  const startStatusPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
    
    // Poll every 5 seconds for up to 1 minute (reduced frequency and duration)
    let pollCount = 0;
    const maxPolls = 12; // 1 minute max (12 * 5 seconds)
    
    pollingIntervalRef.current = setInterval(async () => {
      pollCount++;
      
      if (pollCount >= maxPolls) {
        // Stop polling after 1 minute
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        setIsOAuthInProgress(false);
        return;
      }
      
      await loadGoogleStatus();
    }, 5000);
  }, [loadGoogleStatus]);

  // Refresh status function for manual refresh
  const refreshStatus = useCallback(async () => {
    await loadGoogleStatus();
  }, [loadGoogleStatus]);

  // Start polling when OAuth is in progress
  useEffect(() => {
    if (isOAuthInProgress) {
      startStatusPolling();
    } else if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, [isOAuthInProgress, startStatusPolling]);

  // Initial load
  useEffect(() => {
    if (user?.uid) {
      loadGoogleStatus();
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
