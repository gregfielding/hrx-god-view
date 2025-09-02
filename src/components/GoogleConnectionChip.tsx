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
import { useGoogleStatus } from '../contexts/GoogleStatusContext';
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
  const { googleStatus, loading, error, refreshStatus, isOAuthInProgress, setIsOAuthInProgress } = useGoogleStatus();
  const functions = getFunctions();
  
  // Firebase Functions
  const getGmailAuthUrlFn = httpsCallable(functions, 'getGmailAuthUrl');
  const disconnectGmailFn = httpsCallable(functions, 'disconnectGmail');
  const disconnectCalendarFn = httpsCallable(functions, 'disconnectCalendar');
  const clearExpiredTokensFn = httpsCallable(functions, 'clearExpiredTokens');
  const testCalendarTokenValidityFn = httpsCallable(functions, 'testCalendarTokenValidity');
  const listCalendarEventsFn = httpsCallable(functions, 'listCalendarEvents');
  const createCalendarEventFn = httpsCallable(functions, 'createCalendarEvent');
  
  // Gmail Email Capture Functions
  const testGmailEmailCaptureFn = httpsCallable(functions, 'testGmailEmailCapture');
  const testGmailTokenValidityFn = httpsCallable(functions, 'testGmailTokenValidity');
  
  // UI state
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [busy, setBusy] = useState(false);

  // Refs for cleanup
  const oauthWindowRef = useRef<Window | null>(null);

  // Use shared context for status loading
  const loadGoogleStatus = useCallback(async () => {
    await refreshStatus();
  }, [refreshStatus]);

  // Use GoogleStatusContext's OAuth polling; remove local interval to avoid duplicates
  const startStatusPolling = useCallback(() => {
    // Delegate to context: just trigger an immediate refresh once
    refreshStatus();
    return () => {};
  }, [refreshStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (oauthWindowRef.current && !oauthWindowRef.current.closed) {
        oauthWindowRef.current.close();
      }
    };
  }, []);

  // Handle Google OAuth
  const handleGoogleAuth = async () => {
    if (!user?.uid) return;
    
    setIsOAuthInProgress(true);
    try {
      const getGmailAuthUrlFn = httpsCallable(functions, 'getGmailAuthUrl');
      const result = await getGmailAuthUrlFn({ 
        userId: user.uid,
        tenantId: tenantId 
      });
      
      const data = result.data as any;
      if (data.error) {
        console.error('Failed to get Google auth URL:', data.message);
        setIsOAuthInProgress(false);
        return;
      }
      
      const { authUrl } = data;
      
      if (!authUrl) {
        console.error('No authentication URL received from server');
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
      setIsOAuthInProgress(false);
    }
  };

  // Handle disconnect
  const handleDisconnect = async () => {
    if (!user?.uid) return;
    
    setBusy(true);
    try {
      const disconnectAllGoogleServices = httpsCallable(functions, 'disconnectAllGoogleServices');
      await disconnectAllGoogleServices({ userId: user.uid, tenantId });
      
      // Reload status
      await loadGoogleStatus();
      setShowDialog(false);
    } catch (error) {
      console.error('Error disconnecting Google:', error);
      setErrorMsg('Failed to disconnect Google account');
    } finally {
      setBusy(false);
    }
  };

  // Handle clearing expired tokens
  const handleClearExpiredTokens = async () => {
    if (!user?.uid) return;
    
    setBusy(true);
    try {
      await clearExpiredTokensFn({ userId: user.uid, tenantId });
      
      // Reload status
      await loadGoogleStatus();
      setShowDialog(false);
    } catch (error) {
      console.error('Error clearing expired tokens:', error);
      setErrorMsg('Failed to clear expired tokens');
    } finally {
      setBusy(false);
    }
  };

  // Handle testing and fixing token validity
  const handleTestAndFixTokens = async () => {
    if (!user?.uid) return;
    
    setBusy(true);
    try {
      // Test both Calendar and Gmail tokens
      const [calendarResult, gmailResult] = await Promise.all([
        testCalendarTokenValidityFn({ userId: user.uid, tenantId }),
        testGmailTokenValidityFn({ userId: user.uid, tenantId })
      ]);
      
      const calendarData = calendarResult.data as any;
      const gmailData = gmailResult.data as any;
      
      console.log('Calendar token test result:', calendarData);
      console.log('Gmail token test result:', gmailData);
      
      // Check if both tokens are valid
      if (calendarData.valid && gmailData.valid) {
        setSuccessMsg('All tokens are valid - no action needed');
        setErrorMsg(null);
      } else if (calendarData.needsReauth || gmailData.needsReauth) {
        // Clear the invalid tokens and reload status
        await clearExpiredTokensFn({ userId: user.uid, tenantId });
        await loadGoogleStatus();
        
        const issues = [];
        if (calendarData.needsReauth) issues.push('Calendar');
        if (gmailData.needsReauth) issues.push('Gmail');
        
        setErrorMsg(`Invalid ${issues.join(' and ')} tokens cleared. Please reconnect your Google account.`);
        setSuccessMsg(null);
      } else {
        const issues = [];
        if (!calendarData.valid) issues.push(`Calendar: ${calendarData.reason}`);
        if (!gmailData.valid) issues.push(`Gmail: ${gmailData.reason}`);
        
        setErrorMsg(`Token issues: ${issues.join('; ')}`);
        setSuccessMsg(null);
      }
    } catch (error) {
      console.error('Error testing token validity:', error);
      setErrorMsg('Failed to test token validity');
      setSuccessMsg(null);
    } finally {
      setBusy(false);
    }
  };

  // Handle enable calendar sync
  const handleEnableCalendarSync = async () => {
    if (!user?.uid) return;
    
    setBusy(true);
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
          setErrorMsg('Please complete Google consent to add Calendar access, then click Refresh.');
          return;
        }
      }
      setErrorMsg('Failed to enable Calendar sync');
    } finally {
      setBusy(false);
      setIsOAuthInProgress(false);
    }
  };

  // Handle Gmail email capture test
  const handleTestGmailEmailCapture = async () => {
    if (!user?.uid) return;
    
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const result = await testGmailEmailCaptureFn({ 
        userId: user.uid, 
        tenantId,
        maxResults: 10 
      });
      const data = result.data as any;
      if (data.success) {
        const totalMessages = data.totalMessagesFound || 0;
        const contactsFound = data.testResults?.reduce((sum: number, result: any) => sum + (result.contactsFound || 0), 0) || 0;
        setSuccessMsg(`Test completed: ${totalMessages} emails found, ${contactsFound} contacts matched in CRM`);
      } else {
        setErrorMsg(data.message || 'Test failed');
      }
    } catch (error: any) {
      console.error('Error testing Gmail email capture:', error);
      setErrorMsg(error?.message || 'Failed to test Gmail email capture');
    } finally {
      setBusy(false);
    }
  };

  // Manual monitoring removed to avoid duplicate importing; scheduled job handles ingestion


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
            {successMsg && !errorMsg && (
              <Alert severity="success" onClose={() => setSuccessMsg(null)}>
                {successMsg}
              </Alert>
            )}
            {errorMsg && (
              <Alert severity="error" onClose={() => setErrorMsg(null)}>
                {errorMsg}
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
              {googleStatus.gmail.connected && (
                <span> Gmail emails sent to contacts are automatically captured and logged as activities.</span>
              )}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDialog(false)} disabled={busy}>
            Close
          </Button>
          {googleStatus.gmail.connected && (
            <Button 
              onClick={handleTestGmailEmailCapture} 
              disabled={busy}
              color="info"
              variant="outlined"
            >
              Test Email Capture
            </Button>
          )}
          <Button 
            onClick={handleTestAndFixTokens} 
            disabled={busy}
            color="warning"
            variant="outlined"
          >
            Test & Fix Tokens
          </Button>
          <Button 
            onClick={handleDisconnect} 
            disabled={busy}
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
