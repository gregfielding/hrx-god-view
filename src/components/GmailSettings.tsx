import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Chip,
  Alert,
  Grid,
  CircularProgress,
  Switch,
  FormControlLabel,
  Tooltip,
} from '@mui/material';
import {
  Email as EmailIcon,
  Sync as SyncIcon,
  Send as SendIcon,
  Drafts as DraftsIcon,
  Label as LabelIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Bolt as BoltIcon,
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';

import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useGoogleStatus } from '../contexts/GoogleStatusContext';

interface GmailSettingsProps {
  tenantId: string;
}

interface GmailStatus {
  connected: boolean;
  email?: string;
  lastSync?: Date;
  syncStatus: 'not_synced' | 'syncing' | 'synced' | 'error';
  errorMessage?: string;
}

const GmailSettings: React.FC<GmailSettingsProps> = ({ tenantId }) => {
  const { user } = useAuth();
  const functions = getFunctions();
  const { googleStatus, refreshStatus } = useGoogleStatus();
  
  // Gmail status now provided by context
  
  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [authUrl, setAuthUrl] = useState<string>('');

  // Firebase Functions
  // Status fetched via context; keep other callables
  const getGmailAuthUrlFn = httpsCallable(functions, 'getGmailAuthUrl');
  const disconnectGmailFn = httpsCallable(functions, 'disconnectGmail');
  const syncGmailEmailsFn = httpsCallable(functions, 'syncGmailEmails');
  const startGmailWatchFn = httpsCallable(functions, 'startGmailWatch');
  const stopGmailWatchFn = httpsCallable(functions, 'stopGmailWatch');

  // Push notification (real-time sync) state — sourced from user doc, updated via onSnapshot
  const [pushState, setPushState] = useState<{
    enabled: boolean;
    expiration: number | null;
    lastPushAt: Date | null;
    lastError: string | null;
    lastErrorAt: Date | null;
  }>({
    enabled: false,
    expiration: null,
    lastPushAt: null,
    lastError: null,
    lastErrorAt: null,
  });
  const [pushBusy, setPushBusy] = useState(false);

  // Subscribe to user doc for push status changes (fires live when startGmailWatch completes, or when a push arrives)
  useEffect(() => {
    if (!user?.uid) return;
    const userRef = doc(db, 'users', user.uid);
    const unsub = onSnapshot(
      userRef,
      (snap) => {
        const d: any = snap.data() || {};
        const toDate = (v: any): Date | null => {
          if (!v) return null;
          if (v instanceof Timestamp) return v.toDate();
          if (v instanceof Date) return v;
          if (typeof v === 'number') return new Date(v);
          if (typeof v?.toDate === 'function') return v.toDate();
          return null;
        };
        setPushState({
          enabled: !!d.gmailPushEnabled,
          expiration:
            typeof d.gmailWatchExpiration === 'number'
              ? d.gmailWatchExpiration
              : d.gmailWatchExpiration?.toMillis
                ? d.gmailWatchExpiration.toMillis()
                : null,
          lastPushAt: toDate(d.gmailLastPushAt),
          lastError: typeof d.gmailWatchLastError === 'string' ? d.gmailWatchLastError : null,
          lastErrorAt: toDate(d.gmailWatchLastErrorAt),
        });
      },
      (err) => {
        console.warn('GmailSettings: user doc onSnapshot failed', err);
      }
    );
    return () => {
      try {
        unsub();
      } catch {
        /* noop */
      }
    };
  }, [user?.uid]);

  const handleTogglePushSync = async (nextEnabled: boolean) => {
    if (!user?.uid) {
      setError('User not authenticated');
      return;
    }
    setPushBusy(true);
    setError(null);
    try {
      if (nextEnabled) {
        const res: any = await startGmailWatchFn({});
        const data = res?.data || {};
        if (data?.skipped === 'no_tokens') {
          setError(
            'Real-time sync could not start because Gmail tokens were not found. Disconnect and reconnect Gmail, then try again.'
          );
        } else if (data?.success) {
          setSuccess('Real-time sync enabled.');
        } else {
          setError('Could not enable real-time sync.');
        }
      } else {
        const res: any = await stopGmailWatchFn({});
        const data = res?.data || {};
        if (data?.success) {
          setSuccess('Real-time sync disabled. You will still receive emails via the periodic sync.');
        } else {
          setError(`Could not disable real-time sync${data?.reason ? `: ${data.reason}` : ''}.`);
        }
      }
    } catch (err: any) {
      console.error('Error toggling Gmail push sync:', err);
      setError(`Real-time sync toggle failed: ${err?.message || 'unknown error'}`);
    } finally {
      setPushBusy(false);
    }
  };

  const formatRelative = (d: Date | null): string => {
    if (!d) return '—';
    const diffMs = Date.now() - d.getTime();
    if (diffMs < 0) return d.toLocaleString();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    return d.toLocaleString();
  };

  // Load Gmail status
  const loadGmailStatus = async () => {
    if (!user?.uid) return;
    
    setLoading(true);
    try {
      await refreshStatus(true);
    } catch (error: any) {
      console.error('Error loading Gmail status:', error);
      setError(`Failed to load Gmail status: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGmailStatus();
  }, [user?.uid]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'synced':
        return <CheckCircleIcon color="success" />;
      case 'error':
        return <ErrorIcon color="error" />;
      case 'syncing':
        return <CircularProgress size={20} />;
      default:
        return <WarningIcon color="warning" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'synced':
        return 'success';
      case 'error':
        return 'error';
      case 'syncing':
        return 'warning';
      default:
        return 'default';
    }
  };

  const handleGmailAuth = async () => {
    if (!user?.uid) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await getGmailAuthUrlFn({ 
        userId: user.uid,
        tenantId: tenantId 
      });
      const data = result.data as any;
      
      if (data.error) {
        setError(data.message || 'Failed to get Gmail auth URL');
        return;
      }
      
      const { authUrl } = data;
      
      if (!authUrl) {
        setError('No authentication URL received from server');
        return;
      }
      
      // Open Gmail OAuth URL in new window
      window.open(authUrl, '_blank', 'width=600,height=600');
      
      setSuccess('Gmail authentication initiated. Please complete the OAuth flow in the popup window.');
      // Rely on GoogleStatusContext polling; single refresh is enough as a backup
      setTimeout(() => { loadGmailStatus(); }, 5000);
      
    } catch (error: any) {
      console.error('Error getting Gmail auth URL:', error);
      setError(`Failed to initiate Gmail authentication: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleGmailSync = async () => {
    if (!user?.uid) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await syncGmailEmailsFn({ 
        userId: user.uid,
        tenantId: tenantId 
      });
      const data = result.data as any;
      
      if (data.error) {
        setError(data.message || 'Failed to sync Gmail emails');
        return;
      }
      
      setSuccess(`Successfully synced ${data.emailsSynced || 0} emails from Gmail`);
      
      // Refresh status
      await loadGmailStatus();
      
    } catch (error: any) {
      console.error('Error syncing Gmail emails:', error);
      setError(`Failed to sync Gmail emails: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnectGmail = async () => {
    if (!user?.uid) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await disconnectGmailFn({ userId: user.uid });
      const data = result.data as any;
      
      if (data.error) {
        setError(data.message || 'Failed to disconnect Gmail');
        return;
      }
      
      setSuccess('Gmail disconnected successfully');
      
      // Refresh status
      loadGmailStatus();
      
    } catch (error: any) {
      console.error('Error disconnecting Gmail:', error);
      setError(`Failed to disconnect Gmail: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getSyncStatusText = (status: string) => {
    switch (status) {
      case 'synced':
        return 'Synced';
      case 'syncing':
        return 'Syncing...';
      case 'error':
        return 'Sync Error';
      default:
        return 'Not synced yet';
    }
  };

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Gmail Integration
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Connect Gmail to enable email automation based on deal intelligence and track email communications with CRM contacts.
      </Typography>

      {/* Error/Success Messages */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {/* Gmail Connection Status */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Gmail Connection Status
          </Typography>
          
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Box display="flex" alignItems="center" gap={1}>
                {getStatusIcon(googleStatus.gmail.syncStatus)}
                <Chip 
                  label={googleStatus.gmail.connected ? 'Connected' : 'Disconnected'} 
                  color={googleStatus.gmail.connected ? 'success' : 'default'}
                  size="small"
                />
              </Box>
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <Box display="flex" justifyContent="flex-end" gap={1}>
                {googleStatus.gmail.connected ? (
                  <>
                    <Button
                      variant="outlined"
                      startIcon={<SyncIcon />}
                      onClick={handleGmailSync}
                      disabled={loading}
                    >
                      Sync Now
                    </Button>
                    <Button
                      variant="outlined"
                      color="error"
                      onClick={handleDisconnectGmail}
                      disabled={loading}
                    >
                      Disconnect
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="contained"
                    startIcon={<EmailIcon />}
                    onClick={handleGmailAuth}
                    disabled={loading}
                  >
                    Connect Gmail
                  </Button>
                )}
              </Box>
            </Grid>
          </Grid>

          {googleStatus.gmail.connected && (
            <Box mt={2}>
              <Typography variant="body2" color="text.secondary">
                <strong>Connected Account:</strong> {googleStatus.gmail.email || 'Unknown'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <strong>Sync Status:</strong> {getSyncStatusText(googleStatus.gmail.syncStatus)}
              </Typography>
              {googleStatus.gmail.lastSync && (
                <Typography variant="body2" color="text.secondary">
                  <strong>Last Sync:</strong> {new Date(googleStatus.gmail.lastSync as any).toLocaleString()}
                </Typography>
              )}
              {googleStatus.gmail as any && (googleStatus as any).gmail?.errorMessage && (
                <Typography variant="body2" color="error">
                  <strong>Error:</strong> {(googleStatus as any).gmail.errorMessage}
                </Typography>
              )}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Real-time Sync (Gmail Push Notifications) */}
      {googleStatus.gmail.connected && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box display="flex" alignItems="center" gap={1} mb={1}>
              <BoltIcon color={pushState.enabled ? 'primary' : 'disabled'} />
              <Typography variant="h6">Real-time Sync</Typography>
              <Chip
                size="small"
                label={pushState.enabled ? 'On' : 'Off'}
                color={pushState.enabled ? 'success' : 'default'}
                sx={{ ml: 1 }}
              />
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              When enabled, new messages appear instantly via Gmail push notifications — no need to wait for the
              periodic sync. The watch auto-renews daily.
            </Typography>

            <FormControlLabel
              control={
                <Switch
                  checked={pushState.enabled}
                  disabled={pushBusy}
                  onChange={(e) => handleTogglePushSync(e.target.checked)}
                />
              }
              label={pushState.enabled ? 'Enabled' : 'Enable real-time sync'}
            />

            {pushState.enabled && (
              <Box mt={2}>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="body2" color="text.secondary">
                      <strong>Last push received:</strong> {formatRelative(pushState.lastPushAt)}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Tooltip title="Gmail push watches expire after 7 days; we auto-renew daily.">
                      <Typography variant="body2" color="text.secondary">
                        <strong>Watch expires:</strong>{' '}
                        {pushState.expiration
                          ? new Date(pushState.expiration).toLocaleString()
                          : '—'}
                      </Typography>
                    </Tooltip>
                  </Grid>
                </Grid>
              </Box>
            )}

            {pushState.lastError && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                <Typography variant="body2">
                  <strong>Last error:</strong> {pushState.lastError}
                  {pushState.lastErrorAt && (
                    <Box component="span" ml={1} color="text.secondary">
                      ({formatRelative(pushState.lastErrorAt)})
                    </Box>
                  )}
                </Typography>
              </Alert>
            )}

            {pushBusy && (
              <Box mt={2} display="flex" alignItems="center" gap={1}>
                <CircularProgress size={16} />
                <Typography variant="caption" color="text.secondary">
                  Updating real-time sync…
                </Typography>
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      {/* Email Automation Features */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Email Automation Features
          </Typography>
          
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <Box display="flex" alignItems="center" gap={1} mb={1}>
                <SendIcon color="primary" />
                <Typography variant="subtitle2">Email Tracking</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Automatically save emails sent to CRM contacts
              </Typography>
            </Grid>
            
            <Grid item xs={12} md={4}>
              <Box display="flex" alignItems="center" gap={1} mb={1}>
                <DraftsIcon color="primary" />
                <Typography variant="subtitle2">Deal Intelligence Automation</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Send automated emails based on deal stage and intelligence
              </Typography>
            </Grid>
            
            <Grid item xs={12} md={4}>
              <Box display="flex" alignItems="center" gap={1} mb={1}>
                <LabelIcon color="primary" />
                <Typography variant="subtitle2">Email Templates</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                0 templates configured
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Loading Overlay */}
      {loading && (
        <Box
          position="fixed"
          top={0}
          left={0}
          right={0}
          bottom={0}
          bgcolor="rgba(0,0,0,0.3)"
          display="flex"
          alignItems="center"
          justifyContent="center"
          zIndex={9999}
        >
          <CircularProgress />
        </Box>
      )}
    </Box>
  );
};

export default GmailSettings; 