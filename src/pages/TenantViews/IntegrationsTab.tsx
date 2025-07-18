import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
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
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Autocomplete,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemSecondaryAction
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  Refresh as RefreshIcon,
  Settings as SettingsIcon,
  Security as SecurityIcon,
  Sync as SyncIcon,
  CloudUpload as CloudUploadIcon,
  Chat as ChatIcon,
  Science as ScienceIcon,
  Download as DownloadIcon,
  Upload as UploadIcon,
  Key as KeyIcon,
  Group as GroupIcon,
  Person as PersonIcon,
  Business as BusinessIcon
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { getFunctions, httpsCallable } from 'firebase/functions';

interface IntegrationsTabProps {
  tenantId: string;
}

interface IntegrationStatus {
  id: string;
  name: string;
  type: 'sso' | 'scim' | 'hris' | 'slack';
  status: 'connected' | 'disconnected' | 'error' | 'testing';
  lastSync?: Date;
  errorCount?: number;
  config?: any;
}

interface SSOConfig {
  enabled: boolean;
  provider: 'saml' | 'oauth2' | 'azure' | 'okta' | 'google';
  entityId?: string;
  ssoUrl?: string;
  certificate?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUrl?: string;
  scopes?: string[];
  lastSync?: Date;
  status: 'active' | 'inactive' | 'error';
  errorMessage?: string;
}

interface SCIMConfig {
  enabled: boolean;
  endpoint?: string;
  token?: string;
  syncInterval: number;
  lastSync?: Date;
  status: 'active' | 'inactive' | 'error';
  errorMessage?: string;
  syncStats?: {
    usersCreated: number;
    usersUpdated: number;
    usersDeleted: number;
    lastSyncTime: Date;
  };
}

interface HRISConfig {
  enabled: boolean;
  provider: 'workday' | 'bamboo' | 'adp' | 'paychex' | 'custom';
  apiUrl?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  syncInterval: number;
  lastSync?: Date;
  status: 'active' | 'inactive' | 'error';
  errorMessage?: string;
  syncStats?: {
    employeesSynced: number;
    departmentsSynced: number;
    lastSyncTime: Date;
  };
}

interface SlackConfig {
  enabled: boolean;
  workspaceId?: string;
  botToken?: string;
  appToken?: string;
  signingSecret?: string;
  channels?: string[];
  companionAIEnabled: boolean;
  lastSync?: Date;
  status: 'active' | 'inactive' | 'error';
  errorMessage?: string;
  syncStats?: {
    channelsConnected: number;
    messagesProcessed: number;
    lastSyncTime: Date;
  };
}

const IntegrationsTab: React.FC<IntegrationsTabProps> = ({ tenantId }) => {
  const { user } = useAuth();
  const functions = getFunctions();
  
  // State for configurations
  const [ssoConfig, setSsoConfig] = useState<SSOConfig | null>(null);
  const [scimConfig, setScimConfig] = useState<SCIMConfig | null>(null);
  const [hrisConfig, setHrisConfig] = useState<HRISConfig | null>(null);
  const [slackConfig, setSlackConfig] = useState<SlackConfig | null>(null);
  
  // UI state
  const [loading, setLoading] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | false>('sso');
  const [showSSODialog, setShowSSODialog] = useState(false);
  const [showSCIMDialog, setShowSCIMDialog] = useState(false);
  const [showHRISDialog, setShowHRISDialog] = useState(false);
  const [showSlackDialog, setShowSlackDialog] = useState(false);
  const [syncLogs, setSyncLogs] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form states for configurations
  const [ssoForm, setSsoForm] = useState<SSOConfig>({
    enabled: false,
    provider: 'okta',
    status: 'inactive'
  });
  const [scimForm, setScimForm] = useState<SCIMConfig>({
    enabled: false,
    syncInterval: 60,
    status: 'inactive'
  });
  const [hrisForm, setHrisForm] = useState<HRISConfig>({
    enabled: false,
    provider: 'workday',
    syncInterval: 120,
    status: 'inactive'
  });
  const [slackForm, setSlackForm] = useState<SlackConfig>({
    enabled: false,
    channels: [],
    companionAIEnabled: false,
    status: 'inactive'
  });

  // Firebase Functions
  const getSSOConfigFn = httpsCallable(functions, 'getSSOConfig');
  const updateSSOConfigFn = httpsCallable(functions, 'updateSSOConfig');
  const testSSOConnectionFn = httpsCallable(functions, 'testSSOConnection');
  const getSCIMConfigFn = httpsCallable(functions, 'getSCIMConfig');
  const updateSCIMConfigFn = httpsCallable(functions, 'updateSCIMConfig');
  const syncSCIMUsersFn = httpsCallable(functions, 'syncSCIMUsers');
  const getHRISConfigFn = httpsCallable(functions, 'getHRISConfig');
  const updateHRISConfigFn = httpsCallable(functions, 'updateHRISConfig');
  const syncHRISDataFn = httpsCallable(functions, 'syncHRISData');
  const getSlackConfigFn = httpsCallable(functions, 'getSlackConfig');
  const updateSlackConfigFn = httpsCallable(functions, 'updateSlackConfig');
  const testSlackConnectionFn = httpsCallable(functions, 'testSlackConnection');
  const getIntegrationLogsFn = httpsCallable(functions, 'getIntegrationLogs');
  const manualSyncFn = httpsCallable(functions, 'manualSync');
  const getIntegrationStatusesFn = httpsCallable(functions, 'getIntegrationStatuses');

  // Load configurations on mount
  useEffect(() => {
    if (tenantId) {
      loadAllConfigurations();
      loadIntegrationLogs();
    }
  }, [tenantId]);

  const loadAllConfigurations = async () => {
    setLoading(true);
    setError(null); // Clear any previous errors
    try {
      const [ssoResult, scimResult, hrisResult, slackResult] = await Promise.all([
        getSSOConfigFn({ tenantId }),
        getSCIMConfigFn({ tenantId }),
        getHRISConfigFn({ tenantId }),
        getSlackConfigFn({ tenantId })
      ]);

      const ssoData = (ssoResult.data as any).config;
      const scimData = (scimResult.data as any).config;
      const hrisData = (hrisResult.data as any).config;
      const slackData = (slackResult.data as any).config;

      setSsoConfig(ssoData);
      setScimConfig(scimData);
      setHrisConfig(hrisData);
      setSlackConfig(slackData);

      // Update form states
      setSsoForm(ssoData || { enabled: false, provider: 'okta', status: 'inactive' });
      setScimForm(scimData || { enabled: false, syncInterval: 60, status: 'inactive' });
      setHrisForm(hrisData || { enabled: false, provider: 'workday', syncInterval: 120, status: 'inactive' });
      setSlackForm(slackData || { enabled: false, channels: [], companionAIEnabled: false, status: 'inactive' });
      
      console.log('Integration configurations loaded successfully:', {
        sso: ssoData,
        scim: scimData,
        hris: hrisData,
        slack: slackData
      });
    } catch (error: any) {
      console.error('Error loading configurations:', error);
      // Don't show error for default configurations - this is expected behavior
      if (error.message && !error.message.includes('Failed to get')) {
        setError('Failed to load integration configurations');
      }
    } finally {
      setLoading(false);
    }
  };

  const loadIntegrationLogs = async () => {
    try {
      const result = await getIntegrationLogsFn({ tenantId, limit: 20 });
      setSyncLogs((result.data as any).logs || []);
    } catch (error: any) {
      console.error('Error loading integration logs:', error);
    }
  };

  const handleSectionChange = (section: string) => (event: React.SyntheticEvent, isExpanded: boolean) => {
    setExpandedSection(isExpanded ? section : false);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected':
        return <CheckCircleIcon color="success" />;
      case 'error':
        return <ErrorIcon color="error" />;
      case 'testing':
        return <CircularProgress size={20} />;
      default:
        return <WarningIcon color="warning" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected':
        return 'success';
      case 'error':
        return 'error';
      case 'testing':
        return 'info';
      default:
        return 'warning';
    }
  };

  const handleTestIntegration = async (integrationType: string) => {
    setLoading(true);
    setError(null);
    try {
      let result;
      switch (integrationType) {
        case 'sso':
          result = await testSSOConnectionFn({ tenantId });
          break;
        case 'slack':
          result = await testSlackConnectionFn({ tenantId });
          break;
        default:
          throw new Error('Unsupported integration type for testing');
      }
      
      const syncResult = result.data as any;
      if (syncResult.success) {
        setSuccess(`${integrationType.toUpperCase()} connection test successful`);
        await loadAllConfigurations(); // Refresh configs
      } else {
        setError(syncResult.message || 'Test failed');
      }
    } catch (error: any) {
      console.error('Test integration error:', error);
      setError(error.message || 'Test failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncNow = async (integrationType: string) => {
    setLoading(true);
    setError(null);
    try {
      let result;
      switch (integrationType) {
        case 'scim':
          result = await syncSCIMUsersFn({ tenantId });
          break;
        case 'hris':
          result = await syncHRISDataFn({ tenantId });
          break;
        default:
          result = await manualSyncFn({ tenantId, integrationType });
      }
      
      const syncResult = result.data as any;
      if (syncResult.success) {
        setSuccess(`${integrationType.toUpperCase()} sync completed successfully`);
        await loadAllConfigurations(); // Refresh configs
        await loadIntegrationLogs(); // Refresh logs
      } else {
        setError(syncResult.message || 'Sync failed');
      }
    } catch (error: any) {
      console.error('Sync error:', error);
      setError(error.message || 'Sync failed');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateConfig = async (integrationType: string, config: any) => {
    setLoading(true);
    setError(null);
    try {
      let result;
      switch (integrationType) {
        case 'sso':
          result = await updateSSOConfigFn({ tenantId, config });
          setSsoConfig((result.data as any).config);
          break;
        case 'scim':
          result = await updateSCIMConfigFn({ tenantId, config });
          setScimConfig((result.data as any).config);
          break;
        case 'hris':
          result = await updateHRISConfigFn({ tenantId, config });
          setHrisConfig((result.data as any).config);
          break;
        case 'slack':
          result = await updateSlackConfigFn({ tenantId, config });
          setSlackConfig((result.data as any).config);
          break;
        default:
          throw new Error('Unsupported integration type');
      }
      
      setSuccess(`${integrationType.toUpperCase()} configuration updated successfully`);
    } catch (error: any) {
      console.error('Update config error:', error);
      setError(error.message || 'Failed to update configuration');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 0 }}>
      <Typography variant="h6" gutterBottom>
        Enterprise Integrations
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Connect your enterprise identity systems, HRIS, and communication platforms for seamless user management.
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

      {/* Integration Status Overview */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Typography variant="h6" component="div">
                  SSO
                </Typography>
                {getStatusIcon(ssoConfig?.status === 'active' ? 'connected' : ssoConfig?.status === 'error' ? 'error' : 'disconnected')}
              </Box>
              <Typography variant="body2" color="text.secondary" component="div">
                Status: <Chip 
                  label={ssoConfig?.enabled ? (ssoConfig?.status || 'inactive') : 'not configured'} 
                  size="small" 
                  color={getStatusColor(ssoConfig?.status === 'active' ? 'connected' : ssoConfig?.status === 'error' ? 'error' : 'disconnected') as any}
                />
              </Typography>
              {ssoConfig?.enabled ? (
                ssoConfig?.lastSync ? (
                  <Typography variant="caption" display="block">
                    Last sync: {new Date(ssoConfig.lastSync).toLocaleString()}
                  </Typography>
                ) : (
                  <Typography variant="caption" display="block" color="text.secondary">
                    Not synced yet
                  </Typography>
                )
              ) : (
                <Typography variant="caption" display="block" color="text.secondary">
                  Click "Configure SSO" to set up
                </Typography>
              )}
              {ssoConfig?.errorMessage && (
                <Typography variant="caption" color="error" display="block">
                  Error: {ssoConfig.errorMessage}
                </Typography>
              )}
            </CardContent>
            <CardActions>
              <Button 
                size="small" 
                onClick={() => handleTestIntegration('sso')}
                disabled={loading}
              >
                <ScienceIcon sx={{ mr: 1 }} />
                Test
              </Button>
            </CardActions>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Typography variant="h6" component="div">
                  SCIM
                </Typography>
                {getStatusIcon(scimConfig?.status === 'active' ? 'connected' : scimConfig?.status === 'error' ? 'error' : 'disconnected')}
              </Box>
              <Typography variant="body2" color="text.secondary" component="div">
                Status: <Chip 
                  label={scimConfig?.enabled ? (scimConfig?.status || 'inactive') : 'not configured'} 
                  size="small" 
                  color={getStatusColor(scimConfig?.status === 'active' ? 'connected' : scimConfig?.status === 'error' ? 'error' : 'disconnected') as any}
                />
              </Typography>
              {scimConfig?.enabled ? (
                scimConfig?.lastSync ? (
                  <Typography variant="caption" display="block">
                    Last sync: {new Date(scimConfig.lastSync).toLocaleString()}
                  </Typography>
                ) : (
                  <Typography variant="caption" display="block" color="text.secondary">
                    Not synced yet
                  </Typography>
                )
              ) : (
                <Typography variant="caption" display="block" color="text.secondary">
                  Click "Configure SCIM" to set up
                </Typography>
              )}
              {scimConfig?.syncStats && scimConfig?.enabled && (
                <Typography variant="caption" display="block">
                  Users: {scimConfig.syncStats.usersCreated + scimConfig.syncStats.usersUpdated}
                </Typography>
              )}
            </CardContent>
            <CardActions>
              <Button 
                size="small" 
                onClick={() => handleSyncNow('scim')}
                disabled={loading || !scimConfig?.enabled}
              >
                <SyncIcon sx={{ mr: 1 }} />
                Sync Now
              </Button>
            </CardActions>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Typography variant="h6" component="div">
                  HRIS
                </Typography>
                {getStatusIcon(hrisConfig?.status === 'active' ? 'connected' : hrisConfig?.status === 'error' ? 'error' : 'disconnected')}
              </Box>
              <Typography variant="body2" color="text.secondary" component="div">
                Status: <Chip 
                  label={hrisConfig?.enabled ? (hrisConfig?.status || 'inactive') : 'not configured'} 
                  size="small" 
                  color={getStatusColor(hrisConfig?.status === 'active' ? 'connected' : hrisConfig?.status === 'error' ? 'error' : 'disconnected') as any}
                />
              </Typography>
              {hrisConfig?.enabled ? (
                hrisConfig?.lastSync ? (
                  <Typography variant="caption" display="block">
                    Last sync: {new Date(hrisConfig.lastSync).toLocaleString()}
                  </Typography>
                ) : (
                  <Typography variant="caption" display="block" color="text.secondary">
                    Not synced yet
                  </Typography>
                )
              ) : (
                <Typography variant="caption" display="block" color="text.secondary">
                  Click "Configure HRIS" to set up
                </Typography>
              )}
              {hrisConfig?.syncStats && hrisConfig?.enabled && (
                <Typography variant="caption" display="block">
                  Employees: {hrisConfig.syncStats.employeesSynced}
                </Typography>
              )}
            </CardContent>
            <CardActions>
              <Button 
                size="small" 
                onClick={() => handleSyncNow('hris')}
                disabled={loading || !hrisConfig?.enabled}
              >
                <SyncIcon sx={{ mr: 1 }} />
                Sync Now
              </Button>
            </CardActions>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Typography variant="h6" component="div">
                  Slack
                </Typography>
                {getStatusIcon(slackConfig?.status === 'active' ? 'connected' : slackConfig?.status === 'error' ? 'error' : 'disconnected')}
              </Box>
              <Typography variant="body2" color="text.secondary" component="div">
                Status: <Chip 
                  label={slackConfig?.enabled ? (slackConfig?.status || 'inactive') : 'not configured'} 
                  size="small" 
                  color={getStatusColor(slackConfig?.status === 'active' ? 'connected' : slackConfig?.status === 'error' ? 'error' : 'disconnected') as any}
                />
              </Typography>
              {slackConfig?.enabled ? (
                slackConfig?.lastSync ? (
                  <Typography variant="caption" display="block">
                    Last sync: {new Date(slackConfig.lastSync).toLocaleString()}
                  </Typography>
                ) : (
                  <Typography variant="caption" display="block" color="text.secondary">
                    Not synced yet
                  </Typography>
                )
              ) : (
                <Typography variant="caption" display="block" color="text.secondary">
                  Click "Configure Slack" to set up
                </Typography>
              )}
              {slackConfig?.syncStats && slackConfig?.enabled && (
                <Typography variant="caption" display="block">
                  Channels: {slackConfig.syncStats.channelsConnected}
                </Typography>
              )}
            </CardContent>
            <CardActions>
              <Button 
                size="small" 
                onClick={() => handleTestIntegration('slack')}
                disabled={loading || !slackConfig?.enabled}
              >
                <ScienceIcon sx={{ mr: 1 }} />
                Test
              </Button>
            </CardActions>
          </Card>
        </Grid>
      </Grid>

      {/* Integration Configuration Sections */}
      <Accordion expanded={expandedSection === 'sso'} onChange={handleSectionChange('sso')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <SecurityIcon sx={{ mr: 1 }} />
          <Typography variant="subtitle1">Single Sign-On (SSO)</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom>
                SSO Configuration
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Enable secure single sign-on with your enterprise identity provider.
              </Typography>
              
              <FormControlLabel
                control={
                  <Switch
                    checked={ssoForm.enabled}
                    onChange={(e) => setSsoForm(prev => ({ ...prev, enabled: e.target.checked }))}
                  />
                }
                label="Enable SSO"
                sx={{ mb: 2 }}
              />

              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>SSO Provider</InputLabel>
                <Select 
                  value={ssoForm.provider}
                  onChange={(e) => setSsoForm(prev => ({ ...prev, provider: e.target.value as any }))}
                  label="SSO Provider"
                >
                  <MenuItem value="okta">Okta</MenuItem>
                  <MenuItem value="azure">Microsoft Entra ID</MenuItem>
                  <MenuItem value="google">Google Workspace</MenuItem>
                  <MenuItem value="saml">Custom SAML</MenuItem>
                  <MenuItem value="oauth2">Custom OAuth2</MenuItem>
                </Select>
              </FormControl>

              <TextField
                fullWidth
                label="Entity ID / Domain"
                value={ssoForm.entityId || ''}
                onChange={(e) => setSsoForm(prev => ({ ...prev, entityId: e.target.value }))}
                placeholder="company.okta.com"
                sx={{ mb: 2 }}
              />

              <TextField
                fullWidth
                label="SSO URL"
                value={ssoForm.ssoUrl || ''}
                onChange={(e) => setSsoForm(prev => ({ ...prev, ssoUrl: e.target.value }))}
                placeholder="https://company.okta.com/app/..."
                sx={{ mb: 2 }}
              />

              <TextField
                fullWidth
                label="Client ID"
                value={ssoForm.clientId || ''}
                onChange={(e) => setSsoForm(prev => ({ ...prev, clientId: e.target.value }))}
                placeholder="Enter your client ID"
                sx={{ mb: 2 }}
              />

              <TextField
                fullWidth
                label="Client Secret"
                type="password"
                value={ssoForm.clientSecret || ''}
                onChange={(e) => setSsoForm(prev => ({ ...prev, clientSecret: e.target.value }))}
                placeholder="Enter your client secret"
                sx={{ mb: 2 }}
              />

              <Button
                variant="contained"
                onClick={() => handleUpdateConfig('sso', ssoForm)}
                disabled={loading}
                sx={{ mr: 1 }}
              >
                Save Configuration
              </Button>
              <Button
                variant="outlined"
                startIcon={<UploadIcon />}
                onClick={() => setShowSSODialog(true)}
                sx={{ mr: 1 }}
              >
                Upload Metadata
              </Button>
              <Button variant="outlined" startIcon={<DownloadIcon />}>
                Download HRX Metadata
              </Button>
            </Grid>

            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom>
                Group Mapping
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Map your SSO groups to HRX access roles.
              </Typography>

              {ssoConfig?.enabled ? (
                <>
                  <List>
                    <ListItem>
                      <ListItemIcon>
                        <GroupIcon />
                      </ListItemIcon>
                      <ListItemText 
                        primary="Default: Managers" 
                        secondary="Maps to: HRX Admin Role"
                      />
                      <ListItemSecondaryAction>
                        <Chip label="Active" size="small" color="success" />
                      </ListItemSecondaryAction>
                    </ListItem>
                    <ListItem>
                      <ListItemIcon>
                        <GroupIcon />
                      </ListItemIcon>
                      <ListItemText 
                        primary="Default: Workers" 
                        secondary="Maps to: HRX Worker Role"
                      />
                      <ListItemSecondaryAction>
                        <Chip label="Active" size="small" color="success" />
                      </ListItemSecondaryAction>
                    </ListItem>
                  </List>

                  <Button variant="outlined" startIcon={<SettingsIcon />} sx={{ mt: 2 }}>
                    Configure Group Mapping
                  </Button>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  SSO integration must be configured first to manage group mappings.
                </Typography>
              )}
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      <Accordion expanded={expandedSection === 'scim'} onChange={handleSectionChange('scim')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <SyncIcon sx={{ mr: 1 }} />
          <Typography variant="subtitle1">SCIM User Sync</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom>
                SCIM Configuration
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Configure SCIM 2.0 for automated user provisioning and updates.
              </Typography>

              {scimConfig?.enabled ? (
                <>
                  <TextField
                    fullWidth
                    label="SCIM Endpoint URL"
                    value={scimConfig.endpoint || 'Not configured'}
                    sx={{ mb: 2 }}
                    InputProps={{ readOnly: true }}
                  />

                  <TextField
                    fullWidth
                    label="Access Token"
                    type="password"
                    value={scimConfig.token ? '••••••••••••••••' : 'Not configured'}
                    sx={{ mb: 2 }}
                    InputProps={{ readOnly: true }}
                  />

                  <Button
                    variant="contained"
                    startIcon={<RefreshIcon />}
                    onClick={() => setShowSCIMDialog(true)}
                    sx={{ mr: 1 }}
                  >
                    Regenerate Token
                  </Button>
                  <Button variant="outlined" startIcon={<DownloadIcon />}>
                    Download SCIM Schema
                  </Button>
                </>
              ) : (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    SCIM integration is not configured. Click the button below to set it up.
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={<RefreshIcon />}
                    onClick={() => setShowSCIMDialog(true)}
                  >
                    Configure SCIM
                  </Button>
                </>
              )}
            </Grid>

            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom>
                Sync Settings
              </Typography>
              
              <FormControlLabel
                control={<Switch defaultChecked />}
                label="Auto-create new users"
                sx={{ mb: 1 }}
              />
              <FormControlLabel
                control={<Switch defaultChecked />}
                label="Auto-update existing users"
                sx={{ mb: 1 }}
              />
              <FormControlLabel
                control={<Switch />}
                label="Auto-deactivate removed users"
                sx={{ mb: 1 }}
              />
              <FormControlLabel
                control={<Switch defaultChecked />}
                label="Sync group membership"
                sx={{ mb: 1 }}
              />

              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Sync frequency: Every 15 minutes
              </Typography>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      <Accordion expanded={expandedSection === 'hris'} onChange={handleSectionChange('hris')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <BusinessIcon sx={{ mr: 1 }} />
          <Typography variant="subtitle1">HRIS Integration</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom>
                HRIS Configuration
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Connect your HRIS system to enrich user data and sync organizational structure.
              </Typography>

              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>HRIS Provider</InputLabel>
                <Select defaultValue="" label="HRIS Provider">
                  <MenuItem value="workday">Workday</MenuItem>
                  <MenuItem value="bamboohr">BambooHR</MenuItem>
                  <MenuItem value="adp">ADP</MenuItem>
                  <MenuItem value="gusto">Gusto</MenuItem>
                  <MenuItem value="custom">Custom API</MenuItem>
                </Select>
              </FormControl>

              <TextField
                fullWidth
                label="API Base URL"
                placeholder="https://api.workday.com/v1"
                sx={{ mb: 2 }}
              />

              <TextField
                fullWidth
                label="API Key"
                type="password"
                placeholder="Enter your API key"
                sx={{ mb: 2 }}
              />

              <Button variant="contained" startIcon={<KeyIcon />}>
                Test Connection
              </Button>
            </Grid>

            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom>
                Data Mapping
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Configure which HRIS fields to sync to HRX.
              </Typography>

              <List>
                <ListItem>
                  <ListItemIcon>
                    <PersonIcon />
                  </ListItemIcon>
                  <ListItemText 
                    primary="Job Title" 
                    secondary="Maps from: Workday Position"
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon>
                    <BusinessIcon />
                  </ListItemIcon>
                  <ListItemText 
                    primary="Department" 
                    secondary="Maps from: Workday Organization"
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon>
                    <PersonIcon />
                  </ListItemIcon>
                  <ListItemText 
                    primary="Manager" 
                    secondary="Maps from: Workday Supervisor"
                  />
                </ListItem>
              </List>

              <Button variant="outlined" startIcon={<SettingsIcon />}>
                Configure Field Mapping
              </Button>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      <Accordion expanded={expandedSection === 'slack'} onChange={handleSectionChange('slack')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <ChatIcon sx={{ mr: 1 }} />
          <Typography variant="subtitle1">Slack Integration</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom>
                Slack Configuration
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Connect Slack to enable Companion AI chat with workers directly in Slack channels.
              </Typography>

              {slackConfig?.enabled ? (
                <>
                  <TextField
                    fullWidth
                    label="Slack Workspace"
                    value={slackConfig.workspaceId || 'Not configured'}
                    sx={{ mb: 2 }}
                    InputProps={{ readOnly: true }}
                  />

                  <TextField
                    fullWidth
                    label="Bot Token"
                    type="password"
                    value={slackConfig.botToken ? '••••••••••••••••' : 'Not configured'}
                    sx={{ mb: 2 }}
                    InputProps={{ readOnly: true }}
                  />

                  <Button
                    variant="contained"
                    startIcon={<ChatIcon />}
                    onClick={() => setShowSlackDialog(true)}
                    sx={{ mr: 1 }}
                  >
                    Reconnect Slack
                  </Button>
                  <Button variant="outlined" startIcon={<SettingsIcon />}>
                    Configure Channels
                  </Button>
                </>
              ) : (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Slack integration is not configured. Click the button below to set it up.
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={<ChatIcon />}
                    onClick={() => setShowSlackDialog(true)}
                  >
                    Configure Slack
                  </Button>
                </>
              )}
            </Grid>

            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom>
                Connected Channels
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Channels where Companion AI is active.
              </Typography>

              {slackConfig?.enabled && slackConfig?.channels && slackConfig.channels.length > 0 ? (
                <List>
                  {slackConfig.channels.map((channel, index) => (
                    <ListItem key={index}>
                      <ListItemIcon>
                        <ChatIcon />
                      </ListItemIcon>
                      <ListItemText 
                        primary={`#${channel}`}
                        secondary="Companion AI active"
                      />
                      <ListItemSecondaryAction>
                        <Chip label="Active" size="small" color="success" />
                      </ListItemSecondaryAction>
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {slackConfig?.enabled 
                    ? 'No channels configured yet. Use the "Configure Channels" button to add channels.'
                    : 'Slack integration must be configured first to manage channels.'
                  }
                </Typography>
              )}
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Sync Logs */}
      <Accordion expanded={expandedSection === 'logs'} onChange={handleSectionChange('logs')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <InfoIcon sx={{ mr: 1 }} />
          <Typography variant="subtitle1">Sync Logs & Status</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Timestamp</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Message</TableCell>
                  <TableCell>Details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {syncLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>{log.timestamp.toLocaleString()}</TableCell>
                    <TableCell>
                      <Chip label={log.type} size="small" />
                    </TableCell>
                    <TableCell>
                      <Chip 
                        label={log.status} 
                        size="small" 
                        color={log.status === 'success' ? 'success' : 'error'}
                      />
                    </TableCell>
                    <TableCell>{log.message}</TableCell>
                    <TableCell>
                      <Tooltip title={JSON.stringify(log.details, null, 2)}>
                        <IconButton size="small">
                          <InfoIcon />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </AccordionDetails>
      </Accordion>

      {/* Dialogs for configuration */}
      <Dialog open={showSSODialog} onClose={() => setShowSSODialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>Configure SSO</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Upload your SAML metadata file or enter configuration manually.
          </Typography>
          {/* SSO configuration form would go here */}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowSSODialog(false)}>Cancel</Button>
          <Button variant="contained">Save Configuration</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showSCIMDialog} onClose={() => setShowSCIMDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>SCIM Configuration</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Configure SCIM settings and regenerate access tokens.
          </Typography>
          {/* SCIM configuration form would go here */}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowSCIMDialog(false)}>Cancel</Button>
          <Button variant="contained">Save Configuration</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showSlackDialog} onClose={() => setShowSlackDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>Slack Integration</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Connect your Slack workspace to enable Companion AI chat.
          </Typography>
          {/* Slack configuration form would go here */}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowSlackDialog(false)}>Cancel</Button>
          <Button variant="contained">Connect Slack</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default IntegrationsTab; 