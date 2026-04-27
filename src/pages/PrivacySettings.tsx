import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Typography,
  Switch,
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
  FormControl,
  Select,
  MenuItem,
} from '@mui/material';
import {
  Notifications,
  Email,
  Phone,
  Security,
  Visibility,
  VisibilityOff,
  Save,
  CheckCircle,
  Info,
  Language,
} from '@mui/icons-material';
import { doc, updateDoc, getDoc } from 'firebase/firestore';

import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { setLanguage, useT } from '../i18n';
import { writeLocalLanguage } from '../utils/languagePreference';

interface NotificationSettings {
  emailNotifications: boolean;
  pushNotifications: boolean;
  smsNotifications: boolean;
  scheduleUpdates: boolean;
  assignmentUpdates: boolean;
  systemUpdates: boolean;
  marketingEmails: boolean;
}
// scheduleUpdates, assignmentUpdates, systemUpdates are stored for backward compat but not shown in UI (not wired to messaging backend).

interface PrivacySettings {
  profileVisibility: 'public' | 'private' | 'team';
  showContactInfo: boolean;
  showSchedule: boolean;
  allowDataAnalytics: boolean;
  allowLocationSharing: boolean;
}

const PrivacySettings: React.FC = () => {
  const t = useT();
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

  const [preferredLanguage, setPreferredLanguage] = useState<'en' | 'es'>('en');

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
        
        // SMS toggle is driven by backend opt-in: smsOptIn and smsBlockedSystem (STOP keyword).
        // So the toggle matches Twilio STOP/START and can be re-enabled here after STOP.
        const smsEnabled =
          userData.smsOptIn !== false &&
          userData.smsBlockedSystem !== true;

        // Load notification settings; override SMS from source of truth
        setNotificationSettings(prev => ({
          ...prev,
          ...(userData.notificationSettings || {}),
          smsNotifications: smsEnabled,
        }));
        
        // Load privacy settings
        if (userData.privacySettings) {
          setPrivacySettings(prev => ({
            ...prev,
            ...userData.privacySettings,
          }));
        }

        // Load preferred message language
        if (userData.preferredLanguage === 'es' || userData.preferredLanguage === 'en') {
          setPreferredLanguage(userData.preferredLanguage);
          if (user?.uid === userData.uid) {
            writeLocalLanguage(userData.preferredLanguage);
          }
        }
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      showSnackbar(t('workerSettings.errorLoading'), 'error');
    }
  };

  const saveSettings = async () => {
    if (!user?.uid) return;

    setLoading(true);
    try {
      const userRef = doc(db, 'users', user.uid);
      const updates: Record<string, unknown> = {
        notificationSettings,
        privacySettings,
        preferredLanguage,
        updatedAt: new Date(),
      };
      // Keep SMS opt-in in sync with backend (STOP/START and other checks use these)
      updates.smsOptIn = notificationSettings.smsNotifications;
      if (notificationSettings.smsNotifications) {
        updates.smsBlockedSystem = false; // Re-enabling from UI clears STOP state
      }
      await updateDoc(userRef, updates);
      setLanguage(preferredLanguage);
      writeLocalLanguage(preferredLanguage, { markChangedThisSession: true });
      
      showSnackbar(t('workerSettings.savedSuccess'), 'success');
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
        {t('workerSettings.pageTitle')}
      </Typography>

      {/* Notification Settings — channels (Email, Push, SMS) and Marketing Emails are shown; Schedule/Assignment/System toggles removed (not wired to backend). */}
      <Card sx={{ mb: 4 }}>
        <CardHeader
          title={t('workerSettings.notificationPreferences')}
          avatar={<Notifications />}
          action={
            <Chip
              icon={<CheckCircle />}
              label={t('workerSettings.active')}
              color="success"
              size="small"
            />
          }
        />
        <CardContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('workerSettings.notificationIntro')}
          </Typography>

          <List>
            <ListItem>
              <ListItemIcon>
                <Language />
              </ListItemIcon>
              <ListItemText
                primary={t('workerSettings.preferredMessageLanguage')}
                secondary={t('workerSettings.preferredMessageLanguageSecondary')}
              />
              <ListItemSecondaryAction>
                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <Select
                    value={preferredLanguage}
                    onChange={(e) => setPreferredLanguage(e.target.value as 'en' | 'es')}
                    displayEmpty
                  >
                    <MenuItem value="en">{t('workerSettings.english')}</MenuItem>
                    <MenuItem value="es">{t('workerSettings.spanish')}</MenuItem>
                  </Select>
                </FormControl>
              </ListItemSecondaryAction>
            </ListItem>
            <Divider sx={{ my: 2 }} />
            <ListItem>
              <ListItemIcon>
                <Email />
              </ListItemIcon>
              <ListItemText
                primary={t('workerSettings.emailNotifications')}
                secondary={t('workerSettings.emailNotificationsSecondary')}
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
                primary={t('workerSettings.pushNotifications')}
                secondary={t('workerSettings.pushNotificationsSecondary')}
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
                primary={t('workerSettings.smsNotifications')}
                secondary={t('workerSettings.smsNotificationsSecondary')}
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
                primary={t('workerSettings.marketingEmails')}
                secondary={t('workerSettings.marketingEmailsSecondary')}
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

      {/* Privacy Settings — stored in Firestore; profile visibility / show contact / show schedule / data analytics / location are for future use (not yet enforced everywhere). */}
      <Card sx={{ mb: 4 }}>
        <CardHeader
          title={t('workerSettings.privacySettings')}
          avatar={<Security />}
        />
        <CardContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('workerSettings.privacyIntro')}
          </Typography>

          <List>
            <ListItem>
              <ListItemIcon>
                {getVisibilityIcon(privacySettings.profileVisibility)}
              </ListItemIcon>
              <ListItemText
                primary={t('workerSettings.profileVisibility')}
                secondary={`${t('workerSettings.profileVisibilitySecondary')} ${t(`workerSettings.${privacySettings.profileVisibility}`)}`}
              />
              <ListItemSecondaryAction>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Chip
                    label={t('workerSettings.public')}
                    size="small"
                    variant={privacySettings.profileVisibility === 'public' ? 'filled' : 'outlined'}
                    onClick={() => handlePrivacyChange('profileVisibility', 'public')}
                  />
                  <Chip
                    label={t('workerSettings.team')}
                    size="small"
                    variant={privacySettings.profileVisibility === 'team' ? 'filled' : 'outlined'}
                    onClick={() => handlePrivacyChange('profileVisibility', 'team')}
                  />
                  <Chip
                    label={t('workerSettings.private')}
                    size="small"
                    variant={privacySettings.profileVisibility === 'private' ? 'filled' : 'outlined'}
                    onClick={() => handlePrivacyChange('profileVisibility', 'private')}
                  />
                </Box>
              </ListItemSecondaryAction>
            </ListItem>

            <ListItem>
              <ListItemText
                primary={t('workerSettings.showContactInfo')}
                secondary={t('workerSettings.showContactInfoSecondary')}
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
                primary={t('workerSettings.showSchedule')}
                secondary={t('workerSettings.showScheduleSecondary')}
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
                primary={t('workerSettings.dataAnalytics')}
                secondary={t('workerSettings.dataAnalyticsSecondary')}
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
                primary={t('workerSettings.locationSharing')}
                secondary={t('workerSettings.locationSharingSecondary')}
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
          {t('workerSettings.noteRequiredByRole')}
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
          {loading ? t('workerSettings.saving') : t('workerSettings.saveSettings')}
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