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
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';

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

  // Load Gmail status
  const loadGmailStatus = async () => {
    if (!user?.uid) return;
    
    setLoading(true);
    try {
      await refreshStatus();
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