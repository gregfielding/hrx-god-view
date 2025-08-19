import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Alert,
  CircularProgress,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Google as GoogleIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Refresh as RefreshIcon,
  CloudDone as CloudDoneIcon,
  Link as LinkIcon,
  LinkOff as LinkOffIcon,
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';

interface GoogleConnectionChipProps {
  tenantId: string;
}

interface GoogleStatus {
  gmail: {
    connected: boolean;
    email?: string;
    lastSync?: Date;
    syncStatus: 'not_synced' | 'syncing' | 'synced' | 'error';
  };
  calendar: {
    connected: boolean;
    email?: string;
    lastSync?: Date;
    syncStatus: 'not_synced' | 'syncing' | 'synced' | 'error';
  };
}

const GoogleConnectionChip: React.FC<GoogleConnectionChipProps> = ({ tenantId }) => {
  const { user } = useAuth();
  const functions = getFunctions();
  
  // Firebase Functions
  const getGmailStatusFn = httpsCallable(functions, 'getGmailStatus');
  const getCalendarStatusFn = httpsCallable(functions, 'getCalendarStatus');
  const getGmailAuthUrlFn = httpsCallable(functions, 'getGmailAuthUrl');
  const disconnectGmailFn = httpsCallable(functions, 'disconnectGmail');
  const disconnectCalendarFn = httpsCallable(functions, 'disconnectCalendar');
  const clearExpiredTokensFn = httpsCallable(functions, 'clearExpiredTokens');
  const testCalendarTokenValidityFn = httpsCallable(functions, 'testCalendarTokenValidity');
  const listCalendarEventsFn = httpsCallable(functions, 'listCalendarEvents');
  const createCalendarEventFn = httpsCallable(functions, 'createCalendarEvent');
  
  // State for Google services status
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus>({
    gmail: { connected: false, syncStatus: 'not_synced' },
    calendar: { connected: false, syncStatus: 'not_synced' }
  });
  
  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [isOAuthInProgress, setIsOAuthInProgress] = useState(false);

  // Refs for cleanup
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const oauthWindowRef = useRef<Window | null>(null);

  // Load Google status
  const loadGoogleStatus = useCallback(async () => {
    if (!user?.uid) return;
    
    setLoading(true);
    try {
      // Check both Gmail and Calendar status separately
      const getCalendarStatus = httpsCallable(functions, 'getCalendarStatus');
      const getGmailStatus = httpsCallable(functions, 'getGmailStatus');
      
      const [calendarResult, gmailResult] = await Promise.all([
        getCalendarStatus({ userId: user.uid, tenantId }),
        getGmailStatus({ userId: user.uid, tenantId })
      ]);
      
      const calendarData = calendarResult.data as any;
      const gmailData = gmailResult.data as any;
      
      if (process.env.NODE_ENV === 'development') {
        console.log('Calendar status:', calendarData);
        console.log('Gmail status:', gmailData);
      }
      
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
  }, [user?.uid, tenantId, isOAuthInProgress]);

  // Start polling for status updates during OAuth
  const startStatusPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
    
    // Poll every 2 seconds for up to 2 minutes
    let pollCount = 0;
    const maxPolls = 60; // 2 minutes max
    
    pollingIntervalRef.current = setInterval(async () => {
      pollCount++;
      
      if (pollCount >= maxPolls) {
        // Stop polling after 2 minutes
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        setIsOAuthInProgress(false);
        return;
      }
      
      await loadGoogleStatus();
    }, 2000);
  }, [loadGoogleStatus]);

  // Real-time listener for user document changes
  useEffect(() => {
    if (!user?.uid) return;

    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userRef, (doc) => {
      if (doc.exists()) {
        const userData = doc.data();
        const gmailConnected = !!(userData?.gmailConnected && userData?.gmailTokens?.access_token);
        const calendarConnected = !!(userData?.calendarConnected && userData?.calendarTokens?.access_token);
        
        // Update status if there's a change
        setGoogleStatus(prev => {
          const newStatus = {
            gmail: {
              ...prev.gmail,
              connected: gmailConnected,
              email: userData?.gmailTokens?.email || userData?.email
            },
            calendar: {
              ...prev.calendar,
              connected: calendarConnected,
              email: userData?.calendarTokens?.email || userData?.email
            }
          };
          
          // If OAuth was in progress and we detect a successful connection, stop polling
          if (isOAuthInProgress && (gmailConnected || calendarConnected)) {
            setIsOAuthInProgress(false);
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
          }
          
          return newStatus;
        });
      }
    }, (error) => {
      console.error('Error listening to user document:', error);
    });

    return () => unsubscribe();
  }, [user?.uid, isOAuthInProgress]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      if (oauthWindowRef.current && !oauthWindowRef.current.closed) {
        oauthWindowRef.current.close();
      }
    };
  }, []);

  // Handle Google OAuth
  const handleGoogleAuth = async () => {
    if (!user?.uid) return;
    
    setLoading(true);
    setIsOAuthInProgress(true);
    try {
      const getGmailAuthUrlFn = httpsCallable(functions, 'getGmailAuthUrl');
      const result = await getGmailAuthUrlFn({ 
        userId: user.uid,
        tenantId: tenantId 
      });
      
      const data = result.data as any;
      if (data.error) {
        setError(data.message || 'Failed to get Google auth URL');
        setIsOAuthInProgress(false);
        return;
      }
      
      const { authUrl } = data;
      
      if (!authUrl) {
        setError('No authentication URL received from server');
        setIsOAuthInProgress(false);
        return;
      }
      
      // Open Google OAuth URL in new window
      oauthWindowRef.current = window.open(authUrl, '_blank', 'width=600,height=600');
      
      // Start polling for status updates
      startStatusPolling();
      
      // Note: We can't check window.closed due to COOP policy, so we'll rely on polling and real-time updates
      // The real-time listener and polling will handle OAuth completion detection
      
    } catch (error: any) {
      console.error('Error getting Google auth URL:', error);
      setError(`Failed to initiate Google authentication: ${error.message}`);
      setIsOAuthInProgress(false);
    } finally {
      setLoading(false);
    }
  };

  // Handle disconnect
  const handleDisconnect = async () => {
    if (!user?.uid) return;
    
    setLoading(true);
    try {
      const disconnectAllGoogleServices = httpsCallable(functions, 'disconnectAllGoogleServices');
      await disconnectAllGoogleServices({ userId: user.uid, tenantId });
      
      // Reload status
      await loadGoogleStatus();
      setShowDialog(false);
    } catch (error) {
      console.error('Error disconnecting Google:', error);
      setError('Failed to disconnect Google account');
    } finally {
      setLoading(false);
    }
  };

  // Handle clearing expired tokens
  const handleClearExpiredTokens = async () => {
    if (!user?.uid) return;
    
    setLoading(true);
    try {
      await clearExpiredTokensFn({ userId: user.uid, tenantId });
      
      // Reload status
      await loadGoogleStatus();
      setShowDialog(false);
    } catch (error) {
      console.error('Error clearing expired tokens:', error);
      setError('Failed to clear expired tokens');
    } finally {
      setLoading(false);
    }
  };

  // Handle testing and fixing token validity
  const handleTestAndFixTokens = async () => {
    if (!user?.uid) return;
    
    setLoading(true);
    try {
      const result = await testCalendarTokenValidityFn({ userId: user.uid, tenantId });
      const data = result.data as any;
      
      if (data.valid) {
        setSuccessMsg('Tokens are valid - no action needed');
        setError(null);
      } else if (data.needsReauth) {
        // Clear the invalid tokens and reload status
        await clearExpiredTokensFn({ userId: user.uid, tenantId });
        await loadGoogleStatus();
        setError('Invalid tokens cleared. Please reconnect your Google account.');
        setSuccessMsg(null);
      } else {
        setError(`Token issue: ${data.reason}`);
        setSuccessMsg(null);
      }
    } catch (error) {
      console.error('Error testing token validity:', error);
      setError('Failed to test token validity');
      setSuccessMsg(null);
    } finally {
      setLoading(false);
    }
  };

  // Handle enable calendar sync
  const handleEnableCalendarSync = async () => {
    if (!user?.uid) return;
    
    setLoading(true);
    setIsOAuthInProgress(true);
    try {
      const enableCalendarSync = httpsCallable(functions, 'enableCalendarSync');
      await enableCalendarSync({ userId: user.uid, tenantId });
      
      // Reload status
      await loadGoogleStatus();
      setShowDialog(false);
    } catch (error) {
      console.error('Error enabling Calendar sync:', error);
      const message = (error as any)?.message || '';
      if (message.includes('Calendar scope missing') || message.includes('invalid_grant')) {
        // Start OAuth to add calendar scope
        const getCalendarAuthUrl = httpsCallable(functions, 'getCalendarAuthUrl');
        const resp = await getCalendarAuthUrl({ userId: user?.uid, tenantId });
        const url = (resp.data as any)?.authUrl;
        if (url) {
          oauthWindowRef.current = window.open(url, '_blank');
          startStatusPolling();
          setError('Please complete Google consent to add Calendar access, then click Refresh.');
          return;
        }
      }
      setError('Failed to enable Calendar sync. Please try reconnecting.');
      setIsOAuthInProgress(false);
    } finally {
      setLoading(false);
    }
  };

  // Load status on mount
  useEffect(() => {
    loadGoogleStatus();
  }, [user?.uid, tenantId]);

  // Determine connection status
  const isFullyConnected = googleStatus.calendar.connected && googleStatus.gmail.connected;
  const isPartiallyConnected = !isFullyConnected && (googleStatus.calendar.connected || googleStatus.gmail.connected);
  const isConnected = isFullyConnected || isPartiallyConnected; // retains backward compat for click behavior
  const connectedEmail = googleStatus.calendar.email || googleStatus.gmail.email;
  const connectionCount = (googleStatus.calendar.connected ? 1 : 0) + (googleStatus.gmail.connected ? 1 : 0);
  const partialServiceLabel = googleStatus.gmail.connected && !googleStatus.calendar.connected
    ? 'Gmail only'
    : (!googleStatus.gmail.connected && googleStatus.calendar.connected ? 'Calendar only' : undefined);

  // Debug logging - only in development
  if (process.env.NODE_ENV === 'development') {
    console.log('GoogleConnectionChip Debug:', {
      isConnected,
      connectedEmail,
      connectionCount,
      googleStatus,
      user: user?.uid,
      isOAuthInProgress
    });
  }

  // Handle chip click
  const handleChipClick = () => {
    if (isConnected) {
      setShowDialog(true);
    } else {
      handleGoogleAuth();
    }
  };

  // Handle manual refresh
  const handleRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await loadGoogleStatus();
  };

  // Enhanced tooltip content
  const getTooltipContent = () => {
    if (loading || isOAuthInProgress) return 'Checking connection status...';
    if (isFullyConnected) {
      return `Connected to Gmail and Calendar${connectedEmail ? ` (${connectedEmail})` : ''}`;
    }
    if (isPartiallyConnected) {
      return `Partially connected: ${partialServiceLabel}${connectedEmail ? ` (${connectedEmail})` : ''}. Click to manage connections.`;
    }
    return 'Click to connect your Google account for Calendar and Gmail integration';
  };

  return (
    <>
      <Tooltip title={getTooltipContent()} arrow>
        <Chip
          icon={
            loading || isOAuthInProgress ? (
              <CircularProgress size={16} />
            ) : isFullyConnected ? (
              <LinkIcon sx={{ color: 'white' }} />
            ) : isPartiallyConnected ? (
              <LinkIcon />
            ) : (
              <LinkOffIcon />
            )
          }
          label={
            isFullyConnected
              ? (connectedEmail ? `${connectedEmail.split('@')[0]} ✓` : `Connected (${connectionCount}) ✓`)
              : isPartiallyConnected
                ? (connectedEmail ? `${connectedEmail.split('@')[0]} • ${partialServiceLabel}` : `Partially connected • ${partialServiceLabel}`)
                : isOAuthInProgress
                  ? 'Connecting...'
                  : 'Connect Google'
          }
          onClick={handleChipClick}
          color={isFullyConnected ? 'success' : (isPartiallyConnected ? 'warning' : 'default')}
          variant={isFullyConnected ? 'filled' : 'outlined'}
          size="small"
          disabled={isOAuthInProgress}
          sx={{
            cursor: isOAuthInProgress ? 'not-allowed' : 'pointer',
            '&:hover': {
              opacity: isOAuthInProgress ? 1 : 0.9,
              transform: isOAuthInProgress ? 'none' : 'scale(1.02)',
              transition: 'all 0.2s ease-in-out',
            },
            maxWidth: 200,
            '& .MuiChip-label': {
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontWeight: isConnected ? 600 : 400,
            },
            '& .MuiChip-icon': {
              fontSize: isConnected ? '18px' : '16px',
            },
            // Enhanced connected styling
            ...(isConnected && {
              bgcolor: '#2e7d32',
              color: 'white',
              border: '2px solid #4caf50',
              boxShadow: '0 2px 8px rgba(76, 175, 80, 0.3)',
              '&:hover': {
                bgcolor: '#1b5e20',
                boxShadow: '0 4px 12px rgba(76, 175, 80, 0.4)',
                transform: 'scale(1.05)',
              }
            }),
            // Enhanced disconnected styling
            ...(!isConnected && {
              borderColor: 'grey.400',
              borderWidth: '1px',
              bgcolor: 'transparent',
              '&:hover': {
                borderColor: 'primary.main',
                bgcolor: 'primary.50',
                borderWidth: '2px',
                transform: 'scale(1.05)',
              }
            })
          }}
        />
      </Tooltip>

      {/* Connection Details Dialog */}
      <Dialog open={showDialog} onClose={() => setShowDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <GoogleIcon color="primary" />
            <Typography variant="h6">Google Account Status</Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {successMsg && !error && (
              <Alert severity="success" onClose={() => setSuccessMsg(null)}>
                {successMsg}
              </Alert>
            )}
            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
            
            {/* Connection Summary */}
            <Box sx={{ 
              p: 2, 
              bgcolor: 'success.50', 
              borderRadius: 1, 
              border: '1px solid',
              borderColor: 'success.200'
            }}>
              <Typography variant="body1" fontWeight="medium" color="success.dark">
                ✓ Connected to {connectionCount} Google service{connectionCount > 1 ? 's' : ''}
              </Typography>
              {connectedEmail && (
                <Typography variant="body2" color="success.dark">
                  Account: {connectedEmail}
                </Typography>
              )}
            </Box>
            
            {/* Calendar Status */}
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 2,
              p: 2,
              bgcolor: googleStatus.calendar.connected ? 'success.50' : 'grey.50',
              borderRadius: 1,
              border: '1px solid',
              borderColor: googleStatus.calendar.connected ? 'success.200' : 'grey.300'
            }}>
              {googleStatus.calendar.connected ? (
                <CheckCircleIcon color="success" sx={{ fontSize: 24 }} />
              ) : (
                <ErrorIcon color="disabled" sx={{ fontSize: 24 }} />
              )}
              <Box sx={{ flex: 1 }}>
                <Typography variant="body1" fontWeight="medium">
                  Google Calendar
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {googleStatus.calendar.connected 
                    ? `Connected as ${googleStatus.calendar.email}`
                    : 'Not connected'
                  }
                </Typography>
              </Box>
            </Box>

            {/* Gmail Status */}
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 2,
              p: 2,
              bgcolor: googleStatus.gmail.connected ? 'success.50' : 'grey.50',
              borderRadius: 1,
              border: '1px solid',
              borderColor: googleStatus.gmail.connected ? 'success.200' : 'grey.300'
            }}>
              {googleStatus.gmail.connected ? (
                <CheckCircleIcon color="success" sx={{ fontSize: 24 }} />
              ) : (
                <ErrorIcon color="disabled" sx={{ fontSize: 24 }} />
              )}
              <Box sx={{ flex: 1 }}>
                <Typography variant="body1" fontWeight="medium">
                  Gmail
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {googleStatus.gmail.connected 
                    ? `Connected as ${googleStatus.gmail.email}`
                    : 'Not connected'
                  }
                </Typography>
              </Box>
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              Your CRM tasks and appointments will automatically sync to your Google Calendar and Tasks.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDialog(false)} disabled={loading}>
            Close
          </Button>
          <Button 
            onClick={handleTestAndFixTokens} 
            disabled={loading}
            color="warning"
            variant="outlined"
          >
            Test & Fix Tokens
          </Button>
          <Button 
            onClick={handleDisconnect} 
            disabled={loading}
            color="error"
            variant="contained"
          >
            Disconnect All
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default GoogleConnectionChip;
