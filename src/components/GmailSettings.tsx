import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardActions,
  Button,
  Switch,
  FormControlLabel,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Alert,
  Grid,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemSecondaryAction,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
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
import { useAuth } from '../contexts/AuthContext';
import { getFunctions, httpsCallable } from 'firebase/functions';

interface GmailSettingsProps {
  tenantId: string;
}

interface GmailConfig {
  enabled: boolean;
  accountEmail?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: Date;
  labels?: string[];
  autoSync: boolean;
  syncInterval: number;
  dealIntelligenceEnabled: boolean;
  emailTemplates?: {
    id: string;
    name: string;
    subject: string;
    body: string;
    dealStage: string;
    triggerType: 'manual' | 'automatic';
  }[];
  lastSync?: Date;
  status: 'active' | 'inactive' | 'error' | 'authenticating';
  errorMessage?: string;
  syncStats?: {
    emailsSynced: number;
    emailsSent: number;
    contactsLinked: number;
    dealsUpdated: number;
    lastSyncTime: Date;
  };
}

const GmailSettings: React.FC<GmailSettingsProps> = ({ tenantId }) => {
  const { user } = useAuth();
  const functions = getFunctions();
  
  // State for Gmail configuration
  const [gmailConfig, setGmailConfig] = useState<GmailConfig | null>(null);
  const [gmailForm, setGmailForm] = useState<GmailConfig>({
    enabled: false,
    autoSync: true,
    syncInterval: 15,
    dealIntelligenceEnabled: true,
    emailTemplates: [],
    status: 'inactive'
  });
  
  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showGmailDialog, setShowGmailDialog] = useState(false);

  // Firebase Functions
  const getGmailConfigFn = httpsCallable(functions, 'getGmailConfig');
  const updateGmailConfigFn = httpsCallable(functions, 'updateGmailConfig');
  const authenticateGmailFn = httpsCallable(functions, 'authenticateGmail');
  const syncGmailEmailsFn = httpsCallable(functions, 'syncGmailEmails');

  // Load Gmail configuration
  const loadGmailConfig = async () => {
    if (!tenantId) return;
    
    setLoading(true);
    try {
      const result = await getGmailConfigFn({ tenantId });
      const config = (result.data as any).config;
      setGmailConfig(config);
      
      // Only update form if config exists, otherwise keep default values
      if (config) {
        setGmailForm({
          enabled: config.enabled || false,
          autoSync: config.autoSync !== undefined ? config.autoSync : true,
          syncInterval: config.syncInterval || 15,
          dealIntelligenceEnabled: config.dealIntelligenceEnabled !== undefined ? config.dealIntelligenceEnabled : true,
          emailTemplates: config.emailTemplates || [],
          status: config.status || 'inactive'
        });
      }
    } catch (error: any) {
      console.error('Error loading Gmail config:', error);
      setError(`Failed to load Gmail configuration: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGmailConfig();
  }, [tenantId]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircleIcon color="success" />;
      case 'error':
        return <ErrorIcon color="error" />;
      case 'authenticating':
        return <CircularProgress size={20} />;
      default:
        return <WarningIcon color="warning" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'success';
      case 'error':
        return 'error';
      case 'authenticating':
        return 'warning';
      default:
        return 'default';
    }
  };

  const handleGmailAuth = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await authenticateGmailFn({ tenantId });
      const data = result.data as any;
      
      // Check if setup is required
      if (data.error && data.setupRequired) {
        setError(`${data.message}\n\nSetup Instructions:\n${data.setupInstructions.join('\n')}`);
        return;
      }
      
      // Check if there was an error
      if (data.error) {
        setError(data.message || 'Failed to authenticate Gmail');
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
      
      // Refresh config after a delay to check if auth was completed
      setTimeout(() => {
        loadGmailConfig();
      }, 5000);
      
    } catch (error: any) {
      console.error('Error authenticating Gmail:', error);
      setError(`Failed to authenticate Gmail: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleGmailSync = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await syncGmailEmailsFn({ tenantId });
      const { syncedCount, linkedContacts, updatedDeals } = result.data as any;
      
      setSuccess(`Gmail sync completed! Synced ${syncedCount} emails, linked ${linkedContacts} contacts, updated ${updatedDeals} deals.`);
      
      // Refresh Gmail config to get updated stats
      await loadGmailConfig();
      
    } catch (error: any) {
      console.error('Error syncing Gmail:', error);
      setError(`Failed to sync Gmail: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateGmailConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      await updateGmailConfigFn({ tenantId, config: gmailForm });
      setSuccess('Gmail configuration updated successfully.');
      await loadGmailConfig();
    } catch (error: any) {
      console.error('Error updating Gmail config:', error);
      setError(`Failed to update Gmail configuration: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Gmail Integration
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Connect Gmail to enable email automation based on deal intelligence and track email communications with CRM contacts.
      </Typography>

      {/* Error and Success Messages */}
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

      {/* Gmail Status Card */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box display="flex" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
            <Typography variant="h6" component="div">
              Gmail Connection Status
            </Typography>
            {getStatusIcon(gmailConfig?.status || 'inactive')}
          </Box>
          
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Status: <Chip 
              label={gmailConfig?.enabled ? (gmailConfig?.status || 'inactive') : 'not configured'} 
              size="small" 
              color={getStatusColor(gmailConfig?.status || 'inactive') as any}
            />
          </Typography>
          
          {gmailConfig?.enabled ? (
            <>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Connected Account: {gmailConfig.accountEmail || 'Not configured'}
              </Typography>
              {gmailConfig?.lastSync ? (
                <Typography variant="caption" display="block">
                  Last sync: {new Date(gmailConfig.lastSync).toLocaleString()}
                </Typography>
              ) : (
                <Typography variant="caption" display="block" color="text.secondary">
                  Not synced yet
                </Typography>
              )}
            </>
          ) : (
            <Typography variant="caption" display="block" color="text.secondary">
              Click "Connect Gmail" to set up integration
            </Typography>
          )}
          
          {gmailConfig?.errorMessage && (
            <Typography variant="caption" color="error" display="block" sx={{ mt: 1 }}>
              Error: {gmailConfig.errorMessage}
            </Typography>
          )}
        </CardContent>
        <CardActions>
          <Button 
            size="small" 
            onClick={handleGmailAuth}
            disabled={loading}
            startIcon={<EmailIcon />}
          >
            {gmailConfig?.enabled ? 'Reconnect Gmail' : 'Connect Gmail'}
          </Button>
          {gmailConfig?.enabled && (
            <Button 
              size="small" 
              onClick={handleGmailSync}
              disabled={loading}
              startIcon={<SyncIcon />}
            >
              Sync Now
            </Button>
          )}
        </CardActions>
      </Card>

      {/* Gmail Configuration */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Gmail Configuration
          </Typography>
          
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={gmailForm.autoSync ?? true}
                    onChange={(e) => setGmailForm(prev => ({ ...prev, autoSync: e.target.checked }))}
                    disabled={!gmailConfig?.enabled}
                  />
                }
                label="Auto-sync emails"
                sx={{ mb: 2 }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={gmailForm.dealIntelligenceEnabled ?? true}
                    onChange={(e) => setGmailForm(prev => ({ ...prev, dealIntelligenceEnabled: e.target.checked }))}
                    disabled={!gmailConfig?.enabled}
                  />
                }
                label="Enable deal intelligence automation"
                sx={{ mb: 2 }}
              />

              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>Sync Interval (minutes)</InputLabel>
                <Select 
                  value={gmailForm.syncInterval ?? 15}
                  onChange={(e) => setGmailForm(prev => ({ ...prev, syncInterval: e.target.value as number }))}
                  label="Sync Interval (minutes)"
                  disabled={!gmailConfig?.enabled}
                >
                  <MenuItem value={5}>5 minutes</MenuItem>
                  <MenuItem value={15}>15 minutes</MenuItem>
                  <MenuItem value={30}>30 minutes</MenuItem>
                  <MenuItem value={60}>1 hour</MenuItem>
                </Select>
              </FormControl>

              <Button
                variant="contained"
                onClick={handleUpdateGmailConfig}
                disabled={loading || !gmailConfig?.enabled}
                sx={{ mr: 1 }}
              >
                Save Configuration
              </Button>
            </Grid>

            <Grid item xs={12} md={6}>
              <Typography variant="subtitle2" gutterBottom>
                Email Automation Features
              </Typography>
              
              {gmailConfig?.enabled ? (
                <List dense>
                  <ListItem>
                    <ListItemIcon>
                      <SendIcon />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Email Tracking"
                      secondary="Automatically save emails sent to CRM contacts"
                    />
                    <ListItemSecondaryAction>
                      <Chip label="Active" size="small" color="success" />
                    </ListItemSecondaryAction>
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <DraftsIcon />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Deal Intelligence Automation"
                      secondary="Send automated emails based on deal stage and intelligence"
                    />
                    <ListItemSecondaryAction>
                      <Chip 
                        label={gmailForm.dealIntelligenceEnabled ? "Active" : "Inactive"} 
                        size="small" 
                        color={gmailForm.dealIntelligenceEnabled ? "success" : "default"} 
                      />
                    </ListItemSecondaryAction>
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <LabelIcon />
                    </ListItemIcon>
                    <ListItemText 
                      primary="Email Templates"
                      secondary={`${gmailForm.emailTemplates?.length || 0} templates configured`}
                    />
                    <ListItemSecondaryAction>
                      <Button size="small" variant="outlined">
                        Manage
                      </Button>
                    </ListItemSecondaryAction>
                  </ListItem>
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Gmail integration must be configured first to access email automation features.
                </Typography>
              )}
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Sync Statistics */}
      {gmailConfig?.enabled && gmailConfig?.syncStats && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Sync Statistics
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" display="block" color="text.secondary">
                  Emails Synced
                </Typography>
                <Typography variant="h6">
                  {gmailConfig.syncStats.emailsSynced || 0}
                </Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" display="block" color="text.secondary">
                  Contacts Linked
                </Typography>
                <Typography variant="h6">
                  {gmailConfig.syncStats.contactsLinked || 0}
                </Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" display="block" color="text.secondary">
                  Deals Updated
                </Typography>
                <Typography variant="h6">
                  {gmailConfig.syncStats.dealsUpdated || 0}
                </Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" display="block" color="text.secondary">
                  Emails Sent
                </Typography>
                <Typography variant="h6">
                  {gmailConfig.syncStats.emailsSent || 0}
                </Typography>
              </Grid>
            </Grid>
            {gmailConfig.syncStats.lastSyncTime && (
              <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                Last sync: {new Date(gmailConfig.syncStats.lastSyncTime).toLocaleString()}
              </Typography>
            )}
          </CardContent>
        </Card>
      )}

      {/* Gmail Dialog */}
      <Dialog open={showGmailDialog} onClose={() => setShowGmailDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>Gmail Integration</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Connect your Gmail account to enable email automation and tracking.
          </Typography>
          {/* Additional Gmail configuration options could go here */}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowGmailDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleGmailAuth}>Connect Gmail</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default GmailSettings; 