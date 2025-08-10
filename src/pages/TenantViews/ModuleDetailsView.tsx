import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Grid,
  Switch,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Chip,
  Avatar,
  Divider,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  ArrowBack,
  Settings,
  Business,
  Psychology,
  Analytics,
  Notifications,
  Campaign,
  TrendingUp,
  Assignment,
  People,
  Assessment,
  Work,
  School,
} from '@mui/icons-material';
import { doc, setDoc } from 'firebase/firestore';

import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

interface ModuleDetailsViewProps {
  module: any;
  tenantId: string;
  onBack: () => void;
  onModuleUpdate: (updatedModule: any) => void;
}

const ModuleDetailsView: React.FC<ModuleDetailsViewProps> = ({
  module,
  tenantId,
  onBack,
  onModuleUpdate,
}) => {
  const { currentUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [localModule, setLocalModule] = useState(module);

  const getModuleIcon = (moduleId: string) => {
    const iconMap: { [key: string]: any } = {
      'hrx-companion': <Business />,
      'hrx-intelligence': <Psychology />,
      'hrx-traits-engine': <Analytics />,
      'hrx-moments-engine': <Notifications />,
      'hrx-campaigns': <Campaign />,
      'hrx-broadcasts': <TrendingUp />,
      'hrx-flex': <Assignment />,
      'hrx-recruiter': <People />,
      'hrx-insight-reports': <Assessment />,
      'job-satisfaction-insights': <Assessment />,
      'work-life-balance': <Work />,
      'daily-motivation': <School />,
      'reset-mode': <Work />,
      'mini-learning-boosts': <School />,
      'professional-growth': <Work />,
    };
    return iconMap[moduleId] || <Settings />;
  };

  const handleSettingChange = (key: string, value: any) => {
    setLocalModule((prev: any) => {
      if (key === 'isEnabled') {
        return { ...prev, isEnabled: value };
      } else if (key === 'customSettings') {
        return {
          ...prev,
          customSettings: value,
        };
      }
      return {
        ...prev,
        settings: { ...prev.settings, [key]: value },
      };
    });
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    setError('');
    setSuccess(false);
    
    try {
      // Update the module in Firestore subcollection
      const moduleRef = doc(db, 'tenants', tenantId, 'modules', localModule.id);
      await setDoc(moduleRef, {
        isEnabled: localModule.isEnabled,
        settings: localModule.settings,
        customSettings: localModule.customSettings || {},
        lastUpdated: new Date().toISOString(),
      }, { merge: true });
      
      // Log the change
      await setDoc(doc(db, 'ai_logs', `${tenantId}_ModuleSettings_${Date.now()}`), {
        tenantId: tenantId,
        section: 'ModuleDetailsView',
        changed: 'module_settings',
        moduleId: localModule.id,
        oldValue: module,
        newValue: localModule,
        timestamp: new Date().toISOString(),
        eventType: 'module_settings_update',
        userId: currentUser?.uid || null,
        sourceModule: 'ModuleDetailsView',
      });
      
      onModuleUpdate(localModule);
      setSuccess(true);
      setSettingsOpen(false);
    } catch (err) {
      console.error('Error saving module settings:', err);
      setError('Failed to save module settings');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleModule = async () => {
    if (localModule.isCore) return; // Core modules cannot be disabled
    
    const updatedModule = { ...localModule, isEnabled: !localModule.isEnabled };
    setLocalModule(updatedModule);
    
    try {
      // Save to Firestore subcollection
      const moduleRef = doc(db, 'tenants', tenantId, 'modules', localModule.id);
      await setDoc(moduleRef, {
        isEnabled: updatedModule.isEnabled,
        settings: updatedModule.settings,
        customSettings: updatedModule.customSettings || {},
        lastUpdated: new Date().toISOString(),
      }, { merge: true });
      
      // Log the change
      await setDoc(doc(db, 'ai_logs', `${tenantId}_ModuleToggle_${Date.now()}`), {
        tenantId: tenantId,
        section: 'ModuleDetailsView',
        changed: 'module_toggle',
        moduleId: localModule.id,
        newEnabled: updatedModule.isEnabled,
        timestamp: new Date().toISOString(),
        eventType: 'module_toggle',
        userId: currentUser?.uid || null,
        sourceModule: 'ModuleDetailsView',
      });
      
      onModuleUpdate(updatedModule);
    } catch (err) {
      console.error('Error saving module toggle:', err);
      setError('Failed to save module status');
      // Revert the change
      setLocalModule(module);
    }
  };

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      {/* Header */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Box display="flex" alignItems="center" gap={2}>
          <Typography variant="h4" component="h1">
            {localModule.name}
          </Typography>
          <Chip
            label={localModule.isCore ? "Core" : localModule.isEnabled ? "Active" : "Inactive"}
            color={localModule.isCore ? "primary" : localModule.isEnabled ? "success" : "default"}
            size="small"
            variant={localModule.isCore ? "outlined" : localModule.isEnabled ? "filled" : "outlined"}
            sx={{ 
              fontSize: '0.7rem', 
              height: 20,
              backgroundColor: localModule.isCore ? 'transparent' : (localModule.isEnabled ? '#4caf50' : 'transparent'),
              color: localModule.isCore ? 'primary.main' : (localModule.isEnabled ? 'white' : '#9e9e9e'),
              borderColor: localModule.isCore ? 'primary.main' : (localModule.isEnabled ? '#4caf50' : '#9e9e9e')
            }}
          />
        </Box>
        <Button
          startIcon={<ArrowBack />}
          onClick={onBack}
          variant="outlined"
          size="small"
        >
          Back to Modules
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      
      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Module settings saved successfully!
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Module Overview Card */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={2} mb={2}>
                <Avatar
                  sx={{
                    width: 60,
                    height: 60,
                    bgcolor: localModule.isCore ? 'primary.main' : localModule.isComingSoon ? 'grey.400' : 'grey.200',
                    color: localModule.isCore ? 'white' : 'grey.700',
                  }}
                >
                  {getModuleIcon(localModule.id)}
                </Avatar>
                <Box>
                  <Typography variant="h6" fontWeight="bold">
                    {localModule.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {localModule.isCore ? 'Core Module' : localModule.isComingSoon ? 'Coming Soon' : (localModule.isEnabled ? 'Active Module' : 'Inactive Module')}
                  </Typography>
                </Box>
              </Box>
              
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {localModule.description}
              </Typography>

              <Divider sx={{ my: 2 }} />

              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="body2" fontWeight="medium">
                  Module Status
                </Typography>
                {!localModule.isCore && !localModule.isComingSoon && (
                  <Switch
                    checked={!!localModule.isEnabled}
                    onChange={handleToggleModule}
                    color="primary"
                  />
                )}
                {localModule.isCore && (
                  <Chip label="Always Enabled" color="primary" size="small" />
                )}
                {localModule.isComingSoon && (
                  <Chip label="Coming Soon" color="default" size="small" />
                )}
              </Box>

              {/* Additional Toggles for Flex Engine */}
              {localModule.id === 'hrx-flex' && localModule.isEnabled && (
                <>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                    <Typography variant="body2" fontWeight="medium">
                      Timesheets
                    </Typography>
                    <Switch
                      checked={localModule.settings?.enableTimesheets || false}
                      onChange={async (e) => {
                        const newValue = e.target.checked;
                        handleSettingChange('enableTimesheets', newValue);
                        
                        // Auto-save to Firestore
                        try {
                          const moduleRef = doc(db, 'tenants', tenantId, 'modules', localModule.id);
                          await setDoc(moduleRef, {
                            isEnabled: localModule.isEnabled,
                            settings: { ...localModule.settings, enableTimesheets: newValue },
                            customSettings: localModule.customSettings || {},
                            lastUpdated: new Date().toISOString(),
                          }, { merge: true });
                          
                          // Log the change
                          await setDoc(doc(db, 'ai_logs', `${tenantId}_TimesheetsToggle_${Date.now()}`), {
                            tenantId: tenantId,
                            section: 'ModuleDetailsView',
                            changed: 'timesheets_setting',
                            moduleId: localModule.id,
                            newValue: newValue,
                            timestamp: new Date().toISOString(),
                            eventType: 'timesheets_toggle',
                            userId: currentUser?.uid || null,
                            sourceModule: 'ModuleDetailsView',
                          });
                          
                          setSuccess(true);
                          setTimeout(() => setSuccess(false), 3000);
                        } catch (err) {
                          console.error('Error saving timesheets setting:', err);
                          setError('Failed to save timesheets setting');
                          // Revert the change
                          handleSettingChange('enableTimesheets', !newValue);
                        }
                      }}
                      color="primary"
                    />
                  </Box>
                  

                </>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Module Details */}
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Module Details
              </Typography>
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="text.secondary">
                    Module ID
                  </Typography>
                  <Typography variant="body1" fontWeight="medium">
                    {localModule.id}
                  </Typography>
                </Grid>
                
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" color="text.secondary">
                    Category
                  </Typography>
                  <Typography variant="body1" fontWeight="medium">
                    {localModule.isCore ? 'Core' : localModule.isComingSoon ? 'Coming Soon' : 'Optional'}
                  </Typography>
                </Grid>
                
                <Grid item xs={12}>
                  <Typography variant="body2" color="text.secondary">
                    Description
                  </Typography>
                  <Typography variant="body1">
                    {localModule.description}
                  </Typography>
                </Grid>
              </Grid>

              <Divider sx={{ my: 3 }} />

              <Typography variant="h6" gutterBottom>
                Current Settings
              </Typography>
              
              <Grid container spacing={2}>
                {Object.entries(localModule.settings).map(([key, value]) => (
                  <Grid item xs={12} sm={6} key={key}>
                    <Typography variant="body2" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </Typography>
                    <Typography variant="body1" fontWeight="medium">
                      {typeof value === 'boolean' ? (value ? 'Enabled' : 'Disabled') : String(value)}
                    </Typography>
                  </Grid>
                ))}
              </Grid>

              {localModule.customSettings && Object.keys(localModule.customSettings).length > 0 && (
                <>
                  <Divider sx={{ my: 3 }} />
                  
                  <Typography variant="h6" gutterBottom>
                    Custom Settings
                  </Typography>
                  
                  <Grid container spacing={2}>
                    {Object.entries(localModule.customSettings).map(([key, value]) => (
                      <Grid item xs={12} sm={6} key={key}>
                        <Typography variant="body2" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                          {key.replace(/([A-Z])/g, ' $1').trim()}
                        </Typography>
                        <Typography variant="body1" fontWeight="medium">
                          {typeof value === 'boolean' ? (value ? 'Enabled' : 'Disabled') : String(value)}
                        </Typography>
                      </Grid>
                    ))}
                  </Grid>
                </>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {localModule.name} Settings
          {localModule.isCore && (
            <Chip 
              label="Core Module" 
              color="primary" 
              size="small" 
              sx={{ ml: 2 }}
            />
          )}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            {/* Module Enabled Toggle - Only for non-core modules */}
            {!localModule.isCore && (
              <Box display="flex" alignItems="center" mb={3}>
                <Switch
                  checked={!!localModule.isEnabled}
                  onChange={e => handleSettingChange('isEnabled', e.target.checked)}
                  color="primary"
                  inputProps={{ 'aria-label': 'Enable module' }}
                />
                <Typography variant="subtitle1" sx={{ ml: 1 }}>
                  Module Enabled
                </Typography>
              </Box>
            )}
            
            {/* Core module notice */}
            {localModule.isCore && (
              <Alert severity="info" sx={{ mb: 3 }}>
                This is a core module that cannot be disabled. Core modules provide essential HRX functionality.
              </Alert>
            )}
            
            <Grid container spacing={3}>
              {Object.entries(localModule.settings).map(([key, value]) => (
                <Grid item xs={12} sm={6} key={key}>
                  {typeof value === 'boolean' ? (
                    <FormControl fullWidth>
                      <InputLabel>{key.replace(/([A-Z])/g, ' $1').trim()}</InputLabel>
                      <Select
                        value={value ? 'true' : 'false'}
                        label={key.replace(/([A-Z])/g, ' $1').trim()}
                        onChange={(e) =>
                          handleSettingChange(key, e.target.value === 'true')
                        }
                      >
                        <MenuItem value="true">Enabled</MenuItem>
                        <MenuItem value="false">Disabled</MenuItem>
                      </Select>
                    </FormControl>
                  ) : typeof value === 'string' ? (
                    <TextField
                      label={key.replace(/([A-Z])/g, ' $1').trim()}
                      value={value}
                      onChange={(e) => handleSettingChange(key, e.target.value)}
                      fullWidth
                    />
                  ) : typeof value === 'number' ? (
                    <TextField
                      label={key.replace(/([A-Z])/g, ' $1').trim()}
                      type="number"
                      value={value}
                      onChange={(e) => handleSettingChange(key, Number(e.target.value))}
                      fullWidth
                    />
                  ) : null}
                </Grid>
              ))}
            </Grid>

            {localModule.customSettings && Object.keys(localModule.customSettings).length > 0 && (
              <>
                <Divider sx={{ my: 3 }} />
                <Typography variant="h6" gutterBottom>
                  Custom Settings
                </Typography>
                <Grid container spacing={3}>
                  {Object.entries(localModule.customSettings).map(([key, value]) => (
                    <Grid item xs={12} sm={6} key={key}>
                      {typeof value === 'boolean' ? (
                        <FormControl fullWidth>
                          <InputLabel>{key.replace(/([A-Z])/g, ' $1').trim()}</InputLabel>
                          <Select
                            value={value ? 'true' : 'false'}
                            label={key.replace(/([A-Z])/g, ' $1').trim()}
                            onChange={(e) =>
                              handleSettingChange('customSettings', {
                                ...localModule.customSettings,
                                [key]: e.target.value === 'true'
                              })
                            }
                          >
                            <MenuItem value="true">Enabled</MenuItem>
                            <MenuItem value="false">Disabled</MenuItem>
                          </Select>
                        </FormControl>
                      ) : typeof value === 'string' ? (
                        <TextField
                          label={key.replace(/([A-Z])/g, ' $1').trim()}
                          value={value}
                          onChange={(e) => handleSettingChange('customSettings', {
                            ...localModule.customSettings,
                            [key]: e.target.value
                          })}
                          fullWidth
                        />
                      ) : typeof value === 'number' ? (
                        <TextField
                          label={key.replace(/([A-Z])/g, ' $1').trim()}
                          type="number"
                          value={value}
                          onChange={(e) => handleSettingChange('customSettings', {
                            ...localModule.customSettings,
                            [key]: Number(e.target.value)
                          })}
                          fullWidth
                        />
                      ) : null}
                    </Grid>
                  ))}
                </Grid>
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveSettings} variant="contained" disabled={saving}>
            {saving ? <CircularProgress size={20} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ModuleDetailsView; 