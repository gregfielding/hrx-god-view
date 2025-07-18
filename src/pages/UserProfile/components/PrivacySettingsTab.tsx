import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Switch,
  FormControlLabel,
  FormGroup,
  Divider,
  Alert,
  Button,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  TextField,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Snackbar,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  LocationOn as LocationIcon,
  Notifications as NotificationIcon,
  Security as SecurityIcon,
  Save as SaveIcon,
} from '@mui/icons-material';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';

interface PrivacySettingsTabProps {
  uid: string;
}

interface PrivacySettings {
  locationSettings: {
    locationSharingEnabled: boolean;
    locationGranularity: 'disabled' | 'coarse' | 'fine' | 'precise';
    locationUpdateFrequency: 'manual' | 'hourly' | 'realtime';
    shareWithManagers: boolean;
    shareWithCompanion: boolean;
    lastLocationUpdate?: Date;
  };
  notificationSettings: {
    pushNotifications: boolean;
    emailNotifications: boolean;
    smsNotifications: boolean;
    companionMessages: boolean;
    shiftReminders: boolean;
    safetyAlerts: boolean;
    performanceUpdates: boolean;
    quietHours: {
      enabled: boolean;
      startTime: string;
      endTime: string;
    };
  };
  privacySettings: {
    profileVisibility: 'public' | 'managers' | 'private';
    showContactInfo: boolean;
    showLocation: boolean;
    showPerformanceMetrics: boolean;
    allowDataAnalytics: boolean;
    allowAIInsights: boolean;
  };
}

const PrivacySettingsTab: React.FC<PrivacySettingsTabProps> = ({ uid }) => {
  const { user, securityLevel } = useAuth();
  const [settings, setSettings] = useState<PrivacySettings>({
    locationSettings: {
      locationSharingEnabled: false,
      locationGranularity: 'disabled',
      locationUpdateFrequency: 'manual',
      shareWithManagers: false,
      shareWithCompanion: false,
    },
    notificationSettings: {
      pushNotifications: true,
      emailNotifications: true,
      smsNotifications: false,
      companionMessages: true,
      shiftReminders: true,
      safetyAlerts: true,
      performanceUpdates: false,
      quietHours: {
        enabled: false,
        startTime: '22:00',
        endTime: '08:00',
      },
    },
    privacySettings: {
      profileVisibility: 'managers',
      showContactInfo: true,
      showLocation: false,
      showPerformanceMetrics: false,
      allowDataAnalytics: true,
      allowAIInsights: true,
    },
  });

  const [originalSettings, setOriginalSettings] = useState<PrivacySettings>(settings);
  const [message, setMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [loading, setLoading] = useState(false);

  // Check if user can edit these settings
  const canEditSettings = () => {
    // Users can always edit their own settings
    if (user?.uid === uid) return true;
    
    // Managers and admins can edit any user's settings (security level 5 or higher)
    const userLevel = parseInt(securityLevel || '0');
    if (userLevel >= 5) return true;
    
    return false;
  };

  useEffect(() => {
    if (!uid) return;

    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        
        const currentSettings: PrivacySettings = {
          locationSettings: {
            locationSharingEnabled: data.locationSettings?.locationSharingEnabled || false,
            locationGranularity: data.locationSettings?.locationGranularity || 'disabled',
            locationUpdateFrequency: data.locationSettings?.locationUpdateFrequency || 'manual',
            shareWithManagers: data.locationSettings?.shareWithManagers || false,
            shareWithCompanion: data.locationSettings?.shareWithCompanion || false,
            lastLocationUpdate: data.locationSettings?.lastLocationUpdate?.toDate() || undefined,
          },
          notificationSettings: {
            pushNotifications: data.notificationSettings?.pushNotifications !== false,
            emailNotifications: data.notificationSettings?.emailNotifications !== false,
            smsNotifications: data.notificationSettings?.smsNotifications || false,
            companionMessages: data.notificationSettings?.companionMessages !== false,
            shiftReminders: data.notificationSettings?.shiftReminders !== false,
            safetyAlerts: data.notificationSettings?.safetyAlerts !== false,
            performanceUpdates: data.notificationSettings?.performanceUpdates || false,
            quietHours: {
              enabled: data.notificationSettings?.quietHours?.enabled || false,
              startTime: data.notificationSettings?.quietHours?.startTime || '22:00',
              endTime: data.notificationSettings?.quietHours?.endTime || '08:00',
            },
          },
          privacySettings: {
            profileVisibility: data.privacySettings?.profileVisibility || 'managers',
            showContactInfo: data.privacySettings?.showContactInfo !== false,
            showLocation: data.privacySettings?.showLocation || false,
            showPerformanceMetrics: data.privacySettings?.showPerformanceMetrics || false,
            allowDataAnalytics: data.privacySettings?.allowDataAnalytics !== false,
            allowAIInsights: data.privacySettings?.allowAIInsights !== false,
          },
        };

        setSettings(currentSettings);
        setOriginalSettings(currentSettings);
      }
    });

    return () => unsubscribe();
  }, [uid]);

  const handleLocationSettingChange = (field: keyof PrivacySettings['locationSettings'], value: any) => {
    setSettings(prev => ({
      ...prev,
      locationSettings: {
        ...prev.locationSettings,
        [field]: value,
      },
    }));
  };

  const handleNotificationSettingChange = (field: keyof PrivacySettings['notificationSettings'], value: any) => {
    setSettings(prev => ({
      ...prev,
      notificationSettings: {
        ...prev.notificationSettings,
        [field]: value,
      },
    }));
  };

  const handlePrivacySettingChange = (field: keyof PrivacySettings['privacySettings'], value: any) => {
    setSettings(prev => ({
      ...prev,
      privacySettings: {
        ...prev.privacySettings,
        [field]: value,
      },
    }));
  };

  const handleQuietHoursChange = (field: keyof PrivacySettings['notificationSettings']['quietHours'], value: any) => {
    setSettings(prev => ({
      ...prev,
      notificationSettings: {
        ...prev.notificationSettings,
        quietHours: {
          ...prev.notificationSettings.quietHours,
          [field]: value,
        },
      },
    }));
  };

  const handleSave = async () => {
    if (!canEditSettings()) return;

    setLoading(true);
    try {
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        locationSettings: settings.locationSettings,
        notificationSettings: settings.notificationSettings,
        privacySettings: settings.privacySettings,
        updatedAt: new Date(),
      });

      setMessage('Privacy settings updated successfully');
      setShowToast(true);
      setOriginalSettings(settings);
    } catch (error) {
      console.error('Error updating privacy settings:', error);
      setMessage('Failed to update privacy settings');
      setShowToast(true);
    } finally {
      setLoading(false);
    }
  };

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(originalSettings);

  if (!canEditSettings()) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">
          <Typography variant="h6">Access Restricted</Typography>
          <Typography variant="body2">
            You don't have permission to view or edit privacy settings for this user.
          </Typography>
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      <Typography variant="h5" gutterBottom>
        Privacy & Notification Settings
      </Typography>
      
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Control how your information is shared and when you receive notifications.
      </Typography>

      {/* Location Sharing Settings */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <LocationIcon sx={{ mr: 1 }} />
          <Typography variant="h6">Location Sharing</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.locationSettings.locationSharingEnabled}
                    onChange={(e) => handleLocationSettingChange('locationSharingEnabled', e.target.checked)}
                    disabled={!canEditSettings()}
                  />
                }
                label="Enable Location Sharing"
              />
              <Typography variant="caption" display="block" sx={{ ml: 4, color: 'text.secondary' }}>
                Allow the app to access and share your location for safety and scheduling purposes
              </Typography>
            </Grid>

            {settings.locationSettings.locationSharingEnabled && (
              <>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Location Precision</InputLabel>
                    <Select
                      value={settings.locationSettings.locationGranularity}
                      onChange={(e) => handleLocationSettingChange('locationGranularity', e.target.value)}
                      label="Location Precision"
                    >
                      <MenuItem value="coarse">Coarse (City/Area)</MenuItem>
                      <MenuItem value="fine">Fine (Neighborhood)</MenuItem>
                      <MenuItem value="precise">Precise (Exact Location)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Update Frequency</InputLabel>
                    <Select
                      value={settings.locationSettings.locationUpdateFrequency}
                      onChange={(e) => handleLocationSettingChange('locationUpdateFrequency', e.target.value)}
                      label="Update Frequency"
                    >
                      <MenuItem value="manual">Manual Only</MenuItem>
                      <MenuItem value="hourly">Hourly</MenuItem>
                      <MenuItem value="realtime">Real-time</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12}>
                  <FormGroup>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={settings.locationSettings.shareWithManagers}
                          onChange={(e) => handleLocationSettingChange('shareWithManagers', e.target.checked)}
                        />
                      }
                      label="Share with Managers"
                    />
                    <FormControlLabel
                      control={
                        <Switch
                          checked={settings.locationSettings.shareWithCompanion}
                          onChange={(e) => handleLocationSettingChange('shareWithCompanion', e.target.checked)}
                        />
                      }
                      label="Share with AI Companion"
                    />
                  </FormGroup>
                </Grid>

                {settings.locationSettings.lastLocationUpdate && (
                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary">
                      Last location update: {settings.locationSettings.lastLocationUpdate.toLocaleString()}
                    </Typography>
                  </Grid>
                )}
              </>
            )}
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Notification Settings */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <NotificationIcon sx={{ mr: 1 }} />
          <Typography variant="h6">Notification Preferences</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Typography variant="subtitle1" gutterBottom>Notification Channels</Typography>
              <FormGroup>
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.notificationSettings.pushNotifications}
                      onChange={(e) => handleNotificationSettingChange('pushNotifications', e.target.checked)}
                    />
                  }
                  label="Push Notifications"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.notificationSettings.emailNotifications}
                      onChange={(e) => handleNotificationSettingChange('emailNotifications', e.target.checked)}
                    />
                  }
                  label="Email Notifications"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.notificationSettings.smsNotifications}
                      onChange={(e) => handleNotificationSettingChange('smsNotifications', e.target.checked)}
                    />
                  }
                  label="SMS Notifications"
                />
              </FormGroup>
            </Grid>

            <Grid item xs={12}>
              <Typography variant="subtitle1" gutterBottom>Notification Types</Typography>
              <FormGroup>
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.notificationSettings.companionMessages}
                      onChange={(e) => handleNotificationSettingChange('companionMessages', e.target.checked)}
                    />
                  }
                  label="AI Companion Messages"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.notificationSettings.shiftReminders}
                      onChange={(e) => handleNotificationSettingChange('shiftReminders', e.target.checked)}
                    />
                  }
                  label="Shift Reminders"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.notificationSettings.safetyAlerts}
                      onChange={(e) => handleNotificationSettingChange('safetyAlerts', e.target.checked)}
                    />
                  }
                  label="Safety Alerts"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.notificationSettings.performanceUpdates}
                      onChange={(e) => handleNotificationSettingChange('performanceUpdates', e.target.checked)}
                    />
                  }
                  label="Performance Updates"
                />
              </FormGroup>
            </Grid>

            <Grid item xs={12}>
              <Typography variant="subtitle1" gutterBottom>Quiet Hours</Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.notificationSettings.quietHours.enabled}
                    onChange={(e) => handleQuietHoursChange('enabled', e.target.checked)}
                  />
                }
                label="Enable Quiet Hours"
              />
              
              {settings.notificationSettings.quietHours.enabled && (
                <Grid container spacing={2} sx={{ mt: 1 }}>
                  <Grid item xs={6}>
                    <TextField
                      fullWidth
                      type="time"
                      label="Start Time"
                      value={settings.notificationSettings.quietHours.startTime}
                      onChange={(e) => handleQuietHoursChange('startTime', e.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                  <Grid item xs={6}>
                    <TextField
                      fullWidth
                      type="time"
                      label="End Time"
                      value={settings.notificationSettings.quietHours.endTime}
                      onChange={(e) => handleQuietHoursChange('endTime', e.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                </Grid>
              )}
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Privacy Settings */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <SecurityIcon sx={{ mr: 1 }} />
          <Typography variant="h6">Privacy Controls</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Profile Visibility</InputLabel>
                <Select
                  value={settings.privacySettings.profileVisibility}
                  onChange={(e) => handlePrivacySettingChange('profileVisibility', e.target.value)}
                  label="Profile Visibility"
                >
                  <MenuItem value="public">Public (All Users)</MenuItem>
                  <MenuItem value="managers">Managers Only</MenuItem>
                  <MenuItem value="private">Private (Self Only)</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12}>
              <Typography variant="subtitle1" gutterBottom>Information Sharing</Typography>
              <FormGroup>
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.privacySettings.showContactInfo}
                      onChange={(e) => handlePrivacySettingChange('showContactInfo', e.target.checked)}
                    />
                  }
                  label="Show Contact Information"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.privacySettings.showLocation}
                      onChange={(e) => handlePrivacySettingChange('showLocation', e.target.checked)}
                    />
                  }
                  label="Show Location Information"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.privacySettings.showPerformanceMetrics}
                      onChange={(e) => handlePrivacySettingChange('showPerformanceMetrics', e.target.checked)}
                    />
                  }
                  label="Show Performance Metrics"
                />
              </FormGroup>
            </Grid>

            <Grid item xs={12}>
              <Typography variant="subtitle1" gutterBottom>Data & Analytics</Typography>
              <FormGroup>
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.privacySettings.allowDataAnalytics}
                      onChange={(e) => handlePrivacySettingChange('allowDataAnalytics', e.target.checked)}
                    />
                  }
                  label="Allow Data Analytics"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.privacySettings.allowAIInsights}
                      onChange={(e) => handlePrivacySettingChange('allowAIInsights', e.target.checked)}
                    />
                  }
                  label="Allow AI Insights Generation"
                />
              </FormGroup>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {hasChanges && canEditSettings() && (
        <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </Box>
      )}

      <Snackbar open={showToast} autoHideDuration={3000} onClose={() => setShowToast(false)}>
        <Alert 
          onClose={() => setShowToast(false)} 
          severity={message.includes('successfully') ? 'success' : 'error'} 
          sx={{ width: '100%' }}
        >
          {message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default PrivacySettingsTab; 