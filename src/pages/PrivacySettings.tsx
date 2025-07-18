import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Typography,
  Paper,
  Switch,
  FormControlLabel,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemSecondaryAction,
  Card,
  CardContent,
  CardHeader,
  Alert,
  Button,
  Snackbar,
  Chip,
} from '@mui/material';
import {
  Notifications,
  NotificationsOff,
  Email,
  Phone,
  Security,
  Visibility,
  VisibilityOff,
  Save,
  CheckCircle,
  Warning,
  Info,
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface NotificationSettings {
  emailNotifications: boolean;
  pushNotifications: boolean;
  smsNotifications: boolean;
  scheduleUpdates: boolean;
  assignmentUpdates: boolean;
  systemUpdates: boolean;
  marketingEmails: boolean;
}

interface PrivacySettings {
  profileVisibility: 'public' | 'private' | 'team';
  showContactInfo: boolean;
  showSchedule: boolean;
  allowDataAnalytics: boolean;
  allowLocationSharing: boolean;
}

const PrivacySettings: React.FC = () => {
  const { user } = useAuth();
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>({
    emailNotifications: true,
    pushNotifications: true,
    smsNotifications: false,
    scheduleUpdates: true,
    assignmentUpdates: true,
    systemUpdates: true,
    marketingEmails: false,
  });

  const [privacySettings, setPrivacySettings] = useState<PrivacySettings>({
    profileVisibility: 'team',
    showContactInfo: true,
    showSchedule: true,
    allowDataAnalytics: true,
    allowLocationSharing: false,
  });

  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info';
  }>({
    open: false,
    message: '',
    severity: 'info',
  });

  useEffect(() => {
    if (user?.uid) {
      loadSettings();
    }
  }, [user]);

  const loadSettings = async () => {
    if (!user?.uid) return;

    try {
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) {
        const userData = userSnap.data();
        
        // Load notification settings
        if (userData.notificationSettings) {
          setNotificationSettings(prev => ({
            ...prev,
            ...userData.notificationSettings,
          }));
        }
        
        // Load privacy settings
        if (userData.privacySettings) {
          setPrivacySettings(prev => ({
            ...prev,
            ...userData.privacySettings,
          }));
        }
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      showSnackbar('Error loading settings', 'error');
    }
  };

  const saveSettings = async () => {
    if (!user?.uid) return;

    setLoading(true);
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        notificationSettings,
        privacySettings,
        updatedAt: new Date(),
      });
      
      showSnackbar('Settings saved successfully!', 'success');
    } catch (error) {
      console.error('Error saving settings:', error);
      showSnackbar('Error saving settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  const showSnackbar = (message: string, severity: 'success' | 'error' | 'info') => {
    setSnackbar({
      open: true,
      message,
      severity,
    });
  };

  const handleNotificationChange = (setting: keyof NotificationSettings) => {
    setNotificationSettings(prev => ({
      ...prev,
      [setting]: !prev[setting],
    }));
  };

  const handlePrivacyChange = (setting: keyof PrivacySettings, value: any) => {
    setPrivacySettings(prev => ({
      ...prev,
      [setting]: value,
    }));
  };

  const getVisibilityIcon = (visibility: string) => {
    switch (visibility) {
      case 'public':
        return <Visibility color="success" />;
      case 'private':
        return <VisibilityOff color="error" />;
      case 'team':
        return <Security color="primary" />;
      default:
        return <Info color="info" />;
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom sx={{ mb: 4 }}>
        Privacy & Notifications
      </Typography>

      {/* Notification Settings */}
      <Card sx={{ mb: 4 }}>
        <CardHeader
          title="Notification Preferences"
          avatar={<Notifications />}
          action={
            <Chip
              icon={<CheckCircle />}
              label="Active"
              color="success"
              size="small"
            />
          }
        />
        <CardContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Choose how you want to receive notifications about your work schedule, assignments, and system updates.
          </Typography>

          <List>
            <ListItem>
              <ListItemIcon>
                <Email />
              </ListItemIcon>
              <ListItemText
                primary="Email Notifications"
                secondary="Receive notifications via email"
              />
              <ListItemSecondaryAction>
                <Switch
                  edge="end"
                  checked={notificationSettings.emailNotifications}
                  onChange={() => handleNotificationChange('emailNotifications')}
                />
              </ListItemSecondaryAction>
            </ListItem>

            <ListItem>
              <ListItemIcon>
                <Notifications />
              </ListItemIcon>
              <ListItemText
                primary="Push Notifications"
                secondary="Receive notifications on your device"
              />
              <ListItemSecondaryAction>
                <Switch
                  edge="end"
                  checked={notificationSettings.pushNotifications}
                  onChange={() => handleNotificationChange('pushNotifications')}
                />
              </ListItemSecondaryAction>
            </ListItem>

            <ListItem>
              <ListItemIcon>
                <Phone />
              </ListItemIcon>
              <ListItemText
                primary="SMS Notifications"
                secondary="Receive notifications via text message"
              />
              <ListItemSecondaryAction>
                <Switch
                  edge="end"
                  checked={notificationSettings.smsNotifications}
                  onChange={() => handleNotificationChange('smsNotifications')}
                />
              </ListItemSecondaryAction>
            </ListItem>

            <Divider sx={{ my: 2 }} />

            <ListItem>
              <ListItemText
                primary="Schedule Updates"
                secondary="Notifications about schedule changes"
              />
              <ListItemSecondaryAction>
                <Switch
                  edge="end"
                  checked={notificationSettings.scheduleUpdates}
                  onChange={() => handleNotificationChange('scheduleUpdates')}
                />
              </ListItemSecondaryAction>
            </ListItem>

            <ListItem>
              <ListItemText
                primary="Assignment Updates"
                secondary="Notifications about new assignments or changes"
              />
              <ListItemSecondaryAction>
                <Switch
                  edge="end"
                  checked={notificationSettings.assignmentUpdates}
                  onChange={() => handleNotificationChange('assignmentUpdates')}
                />
              </ListItemSecondaryAction>
            </ListItem>

            <ListItem>
              <ListItemText
                primary="System Updates"
                secondary="Important system and maintenance notifications"
              />
              <ListItemSecondaryAction>
                <Switch
                  edge="end"
                  checked={notificationSettings.systemUpdates}
                  onChange={() => handleNotificationChange('systemUpdates')}
                />
              </ListItemSecondaryAction>
            </ListItem>

            <ListItem>
              <ListItemText
                primary="Marketing Emails"
                secondary="Receive promotional and marketing content"
              />
              <ListItemSecondaryAction>
                <Switch
                  edge="end"
                  checked={notificationSettings.marketingEmails}
                  onChange={() => handleNotificationChange('marketingEmails')}
                />
              </ListItemSecondaryAction>
            </ListItem>
          </List>
        </CardContent>
      </Card>

      {/* Privacy Settings */}
      <Card sx={{ mb: 4 }}>
        <CardHeader
          title="Privacy Settings"
          avatar={<Security />}
        />
        <CardContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Control who can see your information and how your data is used.
          </Typography>

          <List>
            <ListItem>
              <ListItemIcon>
                {getVisibilityIcon(privacySettings.profileVisibility)}
              </ListItemIcon>
              <ListItemText
                primary="Profile Visibility"
                secondary={`Your profile is currently ${privacySettings.profileVisibility}`}
              />
              <ListItemSecondaryAction>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Chip
                    label="Public"
                    size="small"
                    variant={privacySettings.profileVisibility === 'public' ? 'filled' : 'outlined'}
                    onClick={() => handlePrivacyChange('profileVisibility', 'public')}
                  />
                  <Chip
                    label="Team"
                    size="small"
                    variant={privacySettings.profileVisibility === 'team' ? 'filled' : 'outlined'}
                    onClick={() => handlePrivacyChange('profileVisibility', 'team')}
                  />
                  <Chip
                    label="Private"
                    size="small"
                    variant={privacySettings.profileVisibility === 'private' ? 'filled' : 'outlined'}
                    onClick={() => handlePrivacyChange('profileVisibility', 'private')}
                  />
                </Box>
              </ListItemSecondaryAction>
            </ListItem>

            <ListItem>
              <ListItemText
                primary="Show Contact Information"
                secondary="Allow others to see your email and phone number"
              />
              <ListItemSecondaryAction>
                <Switch
                  edge="end"
                  checked={privacySettings.showContactInfo}
                  onChange={() => handlePrivacyChange('showContactInfo', !privacySettings.showContactInfo)}
                />
              </ListItemSecondaryAction>
            </ListItem>

            <ListItem>
              <ListItemText
                primary="Show Schedule"
                secondary="Allow others to see your work schedule"
              />
              <ListItemSecondaryAction>
                <Switch
                  edge="end"
                  checked={privacySettings.showSchedule}
                  onChange={() => handlePrivacyChange('showSchedule', !privacySettings.showSchedule)}
                />
              </ListItemSecondaryAction>
            </ListItem>

            <ListItem>
              <ListItemText
                primary="Data Analytics"
                secondary="Allow us to use your data for improving our services"
              />
              <ListItemSecondaryAction>
                <Switch
                  edge="end"
                  checked={privacySettings.allowDataAnalytics}
                  onChange={() => handlePrivacyChange('allowDataAnalytics', !privacySettings.allowDataAnalytics)}
                />
              </ListItemSecondaryAction>
            </ListItem>

            <ListItem>
              <ListItemText
                primary="Location Sharing"
                secondary="Share your location for work-related purposes"
              />
              <ListItemSecondaryAction>
                <Switch
                  edge="end"
                  checked={privacySettings.allowLocationSharing}
                  onChange={() => handlePrivacyChange('allowLocationSharing', !privacySettings.allowLocationSharing)}
                />
              </ListItemSecondaryAction>
            </ListItem>
          </List>
        </CardContent>
      </Card>

      {/* Information Alert */}
      <Alert severity="info" sx={{ mb: 4 }}>
        <Typography variant="body2">
          <strong>Note:</strong> Some settings may be required for your role and cannot be disabled. 
          Contact your administrator if you have questions about specific settings.
        </Typography>
      </Alert>

      {/* Save Button */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          startIcon={<Save />}
          onClick={saveSettings}
          disabled={loading}
          size="large"
        >
          {loading ? 'Saving...' : 'Save Settings'}
        </Button>
      </Box>

      {/* Snackbar for feedback */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
      >
        <Alert
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default PrivacySettings; 