import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  TextField,
  MenuItem,
  FormControlLabel,
  Switch,
  Card,
  CardHeader,
  CardContent,
  Button,
  Stack,
  FormControl,
  InputLabel,
  Select,
  FormGroup,
  Snackbar,
  Alert,
} from '@mui/material';
import {
  Security as SecurityIcon,
  LocationOn as LocationIcon,
  Notifications as NotificationIcon,
  Save as SaveIcon,
} from '@mui/icons-material';
import { doc, getDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { db, auth } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import EmailSignatureTab from './EmailSignatureTab';

type Props = {
  uid: string;
};

interface PrivacySettings {
  locationSettings: {
    locationSharingEnabled: boolean;
    locationGranularity: 'disabled' | 'coarse' | 'fine' | 'precise';
    locationUpdateFrequency: 'manual' | 'hourly' | 'realtime';
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

const SystemAccessTab: React.FC<Props> = ({ uid }) => {
  const { tenantId, activeTenant, user, securityLevel } = useAuth();
  const effectiveTenantId = activeTenant?.id || tenantId;
  
  const [systemAccess, setSystemAccess] = useState({
    uid: uid,
    securityLevel: '2',
    recruiter: false,
    crm_sales: false,
  });
  const [originalAccess, setOriginalAccess] = useState(systemAccess);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  // Privacy settings state
  const [privacySettings, setPrivacySettings] = useState<PrivacySettings>({
    locationSettings: {
      locationSharingEnabled: true,
      locationGranularity: 'precise',
      locationUpdateFrequency: 'realtime',
    },
    notificationSettings: {
      pushNotifications: true,
      emailNotifications: true,
      smsNotifications: true,
      companionMessages: true,
      shiftReminders: true,
      safetyAlerts: true,
      performanceUpdates: true,
      quietHours: {
        enabled: false,
        startTime: '22:00',
        endTime: '08:00',
      },
    },
    privacySettings: {
      profileVisibility: 'managers',
      showContactInfo: true,
      showLocation: true,
      showPerformanceMetrics: true,
      allowDataAnalytics: true,
      allowAIInsights: true,
    },
  });
  const [originalPrivacySettings, setOriginalPrivacySettings] = useState<PrivacySettings>(privacySettings);
  const [privacyMessage, setPrivacyMessage] = useState('');
  const [showPrivacyToast, setShowPrivacyToast] = useState(false);
  const [privacyLoading, setPrivacyLoading] = useState(false);

  useEffect(() => {
    if (effectiveTenantId) {
      loadSystemAccess();
    }
  }, [uid, effectiveTenantId]);

  useEffect(() => {
    if (!uid) return;

    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        
        const currentSettings: PrivacySettings = {
          locationSettings: {
            locationSharingEnabled: data.locationSettings?.locationSharingEnabled ?? true,
            locationGranularity: data.locationSettings?.locationGranularity ?? 'precise',
            locationUpdateFrequency: data.locationSettings?.locationUpdateFrequency ?? 'realtime',
            lastLocationUpdate: data.locationSettings?.lastLocationUpdate?.toDate() || undefined,
          },
          notificationSettings: {
            pushNotifications: data.notificationSettings?.pushNotifications !== false,
            emailNotifications: data.notificationSettings?.emailNotifications !== false,
            smsNotifications: data.notificationSettings?.smsNotifications ?? true,
            companionMessages: data.notificationSettings?.companionMessages !== false,
            shiftReminders: data.notificationSettings?.shiftReminders !== false,
            safetyAlerts: data.notificationSettings?.safetyAlerts !== false,
            performanceUpdates: data.notificationSettings?.performanceUpdates ?? true,
            quietHours: {
              enabled: data.notificationSettings?.quietHours?.enabled || false,
              startTime: data.notificationSettings?.quietHours?.startTime || '22:00',
              endTime: data.notificationSettings?.quietHours?.endTime || '08:00',
            },
          },
          privacySettings: {
            profileVisibility: 'managers', // Always managers, never public or private
            showContactInfo: true, // Always true
            showLocation: true, // Always true
            showPerformanceMetrics: data.privacySettings?.showPerformanceMetrics ?? true,
            allowDataAnalytics: data.privacySettings?.allowDataAnalytics ?? true,
            allowAIInsights: data.privacySettings?.allowAIInsights ?? true,
          },
        };

        setPrivacySettings(currentSettings);
        setOriginalPrivacySettings(currentSettings);
      }
    });

    return () => unsubscribe();
  }, [uid]);

  const loadSystemAccess = async () => {
    try {
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const data = userSnap.data();
        
        // Get tenant-specific data first, then fallback to top-level
        const tenantData = effectiveTenantId && data.tenantIds?.[effectiveTenantId] ? data.tenantIds[effectiveTenantId] : {};
        
        // Debug logging
        console.log('SystemAccessTab - Loading data:', {
          effectiveTenantId,
          hasTenantIds: !!data.tenantIds,
          tenantData,
          topLevelSecurityLevel: data.securityLevel,
        });
        
        const access = {
          uid: uid,
          securityLevel: (() => {
            // Read from tenant-specific field first, then fallback to top-level
            const level = tenantData.securityLevel ?? data.securityLevel ?? '2';
            // Return the actual security level value (0-7)
            // Handle both string and number types
            const levelNum = typeof level === 'number' ? level : parseInt(String(level), 10);
            // Clamp to valid range 0-7
            if (isNaN(levelNum) || levelNum < 0) return '0';
            if (levelNum > 7) return '7';
            return String(levelNum);
          })(),
          recruiter: tenantData.recruiter ?? data.recruiter ?? false,
          crm_sales: tenantData.crm_sales ?? data.crm_sales ?? false,
        };
        
        console.log('SystemAccessTab - Loaded access:', access);
        
        setSystemAccess(access);
        setOriginalAccess(access);
      }
    } catch (error) {
      console.error('Error loading system access:', error);
    }
  };

  const handleSave = async () => {
    if (!effectiveTenantId) {
      alert('No tenant ID available. Cannot save system access.');
      return;
    }
    
    try {
      const userRef = doc(db, 'users', uid);
      
      // Get current user document to check tenantIds structure
      const userDoc = await getDoc(userRef);
      const userData = userDoc.data();
      
      // Ensure tenantIds object exists
      if (!userData?.tenantIds) {
        // Initialize tenantIds if it doesn't exist
        await updateDoc(userRef, {
          tenantIds: {},
        });
      }
      
      // Update tenant-specific fields using nested path syntax
      // Firestore will automatically create nested structure if needed
      const updateData: any = {
        [`tenantIds.${effectiveTenantId}.securityLevel`]: systemAccess.securityLevel,
        [`tenantIds.${effectiveTenantId}.recruiter`]: systemAccess.recruiter,
        [`tenantIds.${effectiveTenantId}.crm_sales`]: systemAccess.crm_sales,
        [`tenantIds.${effectiveTenantId}.updatedAt`]: new Date(),
      };
      
      await updateDoc(userRef, updateData);

      setOriginalAccess(systemAccess);
      alert('System access updated successfully');
      
      // Reload to reflect changes
      await loadSystemAccess();
    } catch (error) {
      console.error('Error updating system access:', error);
      alert('Failed to update system access');
    }
  };

  const handlePasswordReset = async () => {
    try {
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const email = userSnap.data().email;
        if (email) {
          await sendPasswordResetEmail(auth, email);
          setResetEmailSent(true);
          setTimeout(() => setResetEmailSent(false), 3000);
        }
      }
    } catch (error) {
      console.error('Error sending password reset:', error);
      alert('Failed to send password reset email');
    }
  };

  // Privacy settings handlers
  const canEditPrivacySettings = () => {
    if (user?.uid === uid) return true;
    const userLevel = parseInt(securityLevel || '0', 10);
    if (userLevel >= 5) return true;
    return false;
  };

  const handleLocationSettingChange = (field: keyof PrivacySettings['locationSettings'], value: any) => {
    setPrivacySettings(prev => ({
      ...prev,
      locationSettings: {
        ...prev.locationSettings,
        [field]: value,
      },
    }));
  };

  const handleNotificationSettingChange = (field: keyof PrivacySettings['notificationSettings'], value: any) => {
    setPrivacySettings(prev => ({
      ...prev,
      notificationSettings: {
        ...prev.notificationSettings,
        [field]: value,
      },
    }));
  };

  const handlePrivacySettingChange = (field: keyof PrivacySettings['privacySettings'], value: any) => {
    setPrivacySettings(prev => ({
      ...prev,
      privacySettings: {
        ...prev.privacySettings,
        [field]: value,
      },
    }));
  };

  const handleQuietHoursChange = (field: keyof PrivacySettings['notificationSettings']['quietHours'], value: any) => {
    setPrivacySettings(prev => ({
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

  const handleSavePrivacySettings = async () => {
    if (!canEditPrivacySettings()) return;

    setPrivacyLoading(true);
    try {
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        locationSettings: privacySettings.locationSettings,
        notificationSettings: privacySettings.notificationSettings,
        privacySettings: {
          ...privacySettings.privacySettings,
          profileVisibility: 'managers', // Always managers, never public or private
          showContactInfo: true, // Always true
          showLocation: true, // Always true
        },
        updatedAt: new Date(),
      });

      setPrivacyMessage('Privacy settings updated successfully');
      setShowPrivacyToast(true);
      setOriginalPrivacySettings(privacySettings);
    } catch (error) {
      console.error('Error updating privacy settings:', error);
      setPrivacyMessage('Failed to update privacy settings');
      setShowPrivacyToast(true);
    } finally {
      setPrivacyLoading(false);
    }
  };

  const hasSystemAccessChanges = JSON.stringify(systemAccess) !== JSON.stringify(originalAccess);
  const hasPrivacyChanges = JSON.stringify(privacySettings) !== JSON.stringify(originalPrivacySettings);

  return (
    <Box sx={{ p: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* System Access Card */}
      <Card variant="outlined">
        <CardContent sx={{ px: 3, py: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
            <SecurityIcon sx={{ mr: 1 }} color="primary" />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>System Access</Typography>
          </Box>
          
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" color="text.secondary">User ID</Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{systemAccess.uid}</Typography>
          </Box>

          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                select
                label="Security Level"
                value={systemAccess.securityLevel}
                onChange={(e) => setSystemAccess({ ...systemAccess, securityLevel: e.target.value })}
              >
                <MenuItem value="7">7 - Admin</MenuItem>
                <MenuItem value="6">6 - Manager</MenuItem>
                <MenuItem value="5">5 - Worker</MenuItem>
                <MenuItem value="4">4 - Hired Staff</MenuItem>
                <MenuItem value="3">3 - Flex</MenuItem>
                <MenuItem value="2">2 - Applicant</MenuItem>
                <MenuItem value="1">1 - Dismissed</MenuItem>
                <MenuItem value="0">0 - Suspended</MenuItem>
              </TextField>
            </Grid>

            {parseInt(systemAccess.securityLevel, 10) >= 5 && parseInt(systemAccess.securityLevel, 10) <= 7 && (
              <>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                    Module Access
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
                    Note: Jobs Board access is included with Recruiter access
                  </Typography>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={systemAccess.recruiter}
                        onChange={(e) => setSystemAccess({ ...systemAccess, recruiter: e.target.checked })}
                      />
                    }
                    label="Recruiter Access"
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={systemAccess.crm_sales}
                        onChange={(e) => setSystemAccess({ ...systemAccess, crm_sales: e.target.checked })}
                      />
                    }
                    label="CRM/Sales Access"
                  />
                </Grid>

                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, mt: 2 }}>
                    Account Management
                  </Typography>
                </Grid>

                <Grid item xs={12}>
                  <Button
                    variant="outlined"
                    onClick={handlePasswordReset}
                    disabled={resetEmailSent}
                  >
                    {resetEmailSent ? 'Password Reset Email Sent' : 'Send Password Reset Email'}
                  </Button>
                </Grid>
              </>
            )}
          </Grid>

          {hasSystemAccessChanges && (
            <Stack direction="row" justifyContent="flex-end" sx={{ mt: 3 }}>
              <Button variant="contained" onClick={handleSave}>
                Save Changes
              </Button>
            </Stack>
          )}
        </CardContent>
      </Card>

      {/* Privacy & Notification Settings */}
      {canEditPrivacySettings() && (
        <>
          {/* Location Sharing Settings */}
          <Card variant="outlined">
            <CardHeader 
              title={
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <LocationIcon sx={{ mr: 1 }} />
                  <span>Location Sharing</span>
                </Box>
              }
              titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
            />
            <CardContent sx={{ p: 2 }}>
              <Grid container spacing={3}>
                    <Grid item xs={12}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={privacySettings.locationSettings.locationSharingEnabled}
                            onChange={(e) => handleLocationSettingChange('locationSharingEnabled', e.target.checked)}
                            disabled={!canEditPrivacySettings()}
                          />
                        }
                        label="Enable Location Sharing"
                      />
                      <Typography variant="caption" display="block" sx={{ ml: 4, color: 'text.secondary' }}>
                        Allow the app to access and share your location for safety and scheduling purposes
                      </Typography>
                    </Grid>

                    {privacySettings.locationSettings.locationSharingEnabled && (
                      <>
                        <Grid item xs={12} sm={6}>
                          <FormControl fullWidth>
                            <InputLabel>Location Precision</InputLabel>
                            <Select
                              value={privacySettings.locationSettings.locationGranularity}
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
                              value={privacySettings.locationSettings.locationUpdateFrequency}
                              onChange={(e) => handleLocationSettingChange('locationUpdateFrequency', e.target.value)}
                              label="Update Frequency"
                            >
                              <MenuItem value="manual">Manual Only</MenuItem>
                              <MenuItem value="hourly">Hourly</MenuItem>
                              <MenuItem value="realtime">Real-time</MenuItem>
                            </Select>
                          </FormControl>
                        </Grid>

                        {privacySettings.locationSettings.lastLocationUpdate && (
                          <Grid item xs={12}>
                            <Typography variant="body2" color="text.secondary">
                              Last location update: {privacySettings.locationSettings.lastLocationUpdate.toLocaleString()}
                            </Typography>
                          </Grid>
                        )}
                      </>
                    )}
                  </Grid>
            </CardContent>
          </Card>

          {/* Notification Settings */}
          <Card variant="outlined">
            <CardHeader 
              title={
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <NotificationIcon sx={{ mr: 1 }} />
                  <span>Notification Preferences</span>
                </Box>
              }
              titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
            />
            <CardContent sx={{ p: 2 }}>
              <Grid container spacing={3}>
                    <Grid item xs={12}>
                      <Typography variant="subtitle1" gutterBottom>Notification Channels</Typography>
                      <FormGroup>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={privacySettings.notificationSettings.pushNotifications}
                              onChange={(e) => handleNotificationSettingChange('pushNotifications', e.target.checked)}
                            />
                          }
                          label="Push Notifications"
                        />
                        <FormControlLabel
                          control={
                            <Switch
                              checked={privacySettings.notificationSettings.emailNotifications}
                              onChange={(e) => handleNotificationSettingChange('emailNotifications', e.target.checked)}
                            />
                          }
                          label="Email Notifications"
                        />
                        <FormControlLabel
                          control={
                            <Switch
                              checked={privacySettings.notificationSettings.smsNotifications}
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
                              checked={privacySettings.notificationSettings.companionMessages}
                              onChange={(e) => handleNotificationSettingChange('companionMessages', e.target.checked)}
                            />
                          }
                          label="AI Companion Messages"
                        />
                        <FormControlLabel
                          control={
                            <Switch
                              checked={privacySettings.notificationSettings.shiftReminders}
                              onChange={(e) => handleNotificationSettingChange('shiftReminders', e.target.checked)}
                            />
                          }
                          label="Shift Reminders"
                        />
                        <FormControlLabel
                          control={
                            <Switch
                              checked={privacySettings.notificationSettings.safetyAlerts}
                              onChange={(e) => handleNotificationSettingChange('safetyAlerts', e.target.checked)}
                            />
                          }
                          label="Safety Alerts"
                        />
                        <FormControlLabel
                          control={
                            <Switch
                              checked={privacySettings.notificationSettings.performanceUpdates}
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
                            checked={privacySettings.notificationSettings.quietHours.enabled}
                            onChange={(e) => handleQuietHoursChange('enabled', e.target.checked)}
                          />
                        }
                        label="Enable Quiet Hours"
                      />
                      
                      {privacySettings.notificationSettings.quietHours.enabled && (
                        <Grid container spacing={2} sx={{ mt: 1 }}>
                          <Grid item xs={6}>
                            <TextField
                              fullWidth
                              type="time"
                              label="Start Time"
                              value={privacySettings.notificationSettings.quietHours.startTime}
                              onChange={(e) => handleQuietHoursChange('startTime', e.target.value)}
                              InputLabelProps={{ shrink: true }}
                            />
                          </Grid>
                          <Grid item xs={6}>
                            <TextField
                              fullWidth
                              type="time"
                              label="End Time"
                              value={privacySettings.notificationSettings.quietHours.endTime}
                              onChange={(e) => handleQuietHoursChange('endTime', e.target.value)}
                              InputLabelProps={{ shrink: true }}
                            />
                          </Grid>
                        </Grid>
                      )}
                    </Grid>
                  </Grid>
            </CardContent>
          </Card>

          {/* Privacy Controls */}
          <Card variant="outlined">
            <CardHeader 
              title={
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <SecurityIcon sx={{ mr: 1 }} />
                  <span>Privacy Controls</span>
                </Box>
              }
              titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
            />
            <CardContent sx={{ p: 2 }}>
              <Grid container spacing={3}>
                    <Grid item xs={12}>
                      <Typography variant="subtitle1" gutterBottom>Information Sharing</Typography>
                      <FormGroup>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={privacySettings.privacySettings.showPerformanceMetrics}
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
                              checked={privacySettings.privacySettings.allowDataAnalytics}
                              onChange={(e) => handlePrivacySettingChange('allowDataAnalytics', e.target.checked)}
                            />
                          }
                          label="Allow Data Analytics"
                        />
                        <FormControlLabel
                          control={
                            <Switch
                              checked={privacySettings.privacySettings.allowAIInsights}
                              onChange={(e) => handlePrivacySettingChange('allowAIInsights', e.target.checked)}
                            />
                          }
                          label="Allow AI Insights Generation"
                        />
                      </FormGroup>
                    </Grid>
                  </Grid>
            </CardContent>
          </Card>

          {hasPrivacyChanges && canEditPrivacySettings() && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={handleSavePrivacySettings}
                disabled={privacyLoading}
              >
                {privacyLoading ? 'Saving...' : 'Save Privacy Settings'}
              </Button>
            </Box>
          )}
        </>
      )}

      {/* Email Signature Section - Only for users with security level 5-7 */}
      {(() => {
        const targetUserLevel = parseInt(systemAccess.securityLevel || '0', 10);
        return targetUserLevel >= 5 && targetUserLevel <= 7;
      })() && (
        <EmailSignatureTab uid={uid} />
      )}

      <Snackbar open={showPrivacyToast} autoHideDuration={3000} onClose={() => setShowPrivacyToast(false)}>
        <Alert 
          onClose={() => setShowPrivacyToast(false)} 
          severity={privacyMessage.includes('successfully') ? 'success' : 'error'} 
          sx={{ width: '100%' }}
        >
          {privacyMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default SystemAccessTab;
