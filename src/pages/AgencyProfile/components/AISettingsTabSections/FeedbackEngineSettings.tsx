import React, { useState, useEffect } from 'react';
import {
  Paper,
  Typography,
  Grid,
  Button,
  Snackbar,
  Alert,
  Tooltip,
  IconButton,
  Box,
  Switch,
  FormControlLabel,
  TextField,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Slider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { db } from '../../../../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../../../firebase';
import { LoggableSlider, LoggableTextField, LoggableSelect, LoggableSwitch } from '../../../../components/LoggableField';

interface FeedbackEngineSettingsProps {
  tenantId: string;
}

const FeedbackEngineSettings: React.FC<FeedbackEngineSettingsProps> = ({ tenantId }) => {
  const [settings, setSettings] = useState({
    sentimentScoring: {
      enabled: true,
      confidenceThreshold: 0.7,
      updateFrequency: 'realtime',
    },
    managerAccess: {
      enabled: true,
      requireOptIn: true,
      anonymizeData: false,
      accessLevel: 'summary', // 'summary' | 'detailed' | 'full'
    },
    aiFollowUp: {
      enabled: true,
      triggerThreshold: 0.6,
      maxFollowUps: 3,
      followUpDelay: 24, // hours
    },
    anonymity: {
      defaultAnonymous: false,
      allowWorkerChoice: true,
      anonymizeInReports: true,
    },
    notifications: {
      enableAlerts: true,
      alertThreshold: 0.8,
      notifyManagers: true,
      notifyHR: false,
    },
  });
  const [originalSettings, setOriginalSettings] = useState(settings);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const feedbackRef = doc(db, 'tenants', tenantId, 'aiSettings', 'feedback');
        const feedbackSnap = await getDoc(feedbackRef);
        if (feedbackSnap.exists()) {
          const data = feedbackSnap.data();
          setSettings((data as typeof settings) || settings);
          setOriginalSettings((data as typeof settings) || settings);
        }
      } catch (err) {
        setError('Failed to fetch feedback engine settings');
      }
    };
    fetchSettings();
  }, [tenantId]);

  const handleSettingChange = (section: string, field: string, value: any) => {
    setSettings((prev) => ({
      ...prev,
      [section]: {
        ...prev[section as keyof typeof prev],
        [field]: value,
      },
    }));
  };

  const handleSave = async () => {
    try {
      const functions = getFunctions(app, 'us-central1');
      const updateFn = httpsCallable(functions, 'updateAgencyAISettings');
      await updateFn({ tenantId, settingsType: 'feedback', settings });
      setOriginalSettings({ ...settings });
      setSuccess(true);
    } catch (err) {
      setError('Failed to save feedback engine settings');
    }
  };

  const isChanged = JSON.stringify(settings) !== JSON.stringify(originalSettings);

  return (
    <Paper sx={{ p: 3, mb: 4 }}>
      <Typography variant="h6" gutterBottom>
        Feedback Engine Settings
        <Tooltip title="Configure how the AI analyzes and responds to worker feedback and sentiment.">
          <IconButton size="small" sx={{ ml: 1 }}>
            <HelpOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Typography>

      {/* Sentiment Scoring */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Sentiment Scoring</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <LoggableSwitch
                fieldPath={`tenants:${tenantId}.aiSettings.feedback.sentimentScoring.enabled`}
                trigger="update"
                destinationModules={['FeedbackEngine', 'ContextEngine']}
                value={settings.sentimentScoring.enabled}
                onChange={(value: boolean) =>
                  handleSettingChange('sentimentScoring', 'enabled', value)
                }
                label="Enable Sentiment Scoring"
                contextType="feedback"
                urgencyScore={4}
                description="Agency feedback sentiment scoring enabled"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <LoggableSlider
                fieldPath={`tenants:${tenantId}.aiSettings.feedback.sentimentScoring.confidenceThreshold`}
                trigger="update"
                destinationModules={['FeedbackEngine', 'ContextEngine']}
                value={settings.sentimentScoring.confidenceThreshold}
                onChange={(valueOrEvent: any, maybeValue?: any) => {
                  const value = typeof valueOrEvent === 'number' ? valueOrEvent : maybeValue;
                  handleSettingChange('sentimentScoring', 'confidenceThreshold', value);
                }}
                min={0.1}
                max={1}
                step={0.1}
                label="Confidence Threshold"
                contextType="feedback"
                urgencyScore={4}
                description="Agency feedback sentiment confidence threshold"
                disabled={!settings.sentimentScoring.enabled}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <LoggableSelect
                fieldPath={`tenants:${tenantId}.aiSettings.feedback.sentimentScoring.updateFrequency`}
                trigger="update"
                destinationModules={['FeedbackEngine', 'ContextEngine']}
                value={settings.sentimentScoring.updateFrequency}
                onChange={(value: string) =>
                  handleSettingChange('sentimentScoring', 'updateFrequency', value)
                }
                label="Update Frequency"
                options={[
                  { value: 'realtime', label: 'Real-time' },
                  { value: 'hourly', label: 'Hourly' },
                  { value: 'daily', label: 'Daily' }
                ]}
                contextType="feedback"
                urgencyScore={3}
                description="Agency feedback sentiment update frequency"
                disabled={!settings.sentimentScoring.enabled}
              />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Manager Access */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Manager Access</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <LoggableSwitch
                fieldPath={`tenants:${tenantId}.aiSettings.feedback.managerAccess.enabled`}
                trigger="update"
                destinationModules={['FeedbackEngine', 'ContextEngine']}
                value={settings.managerAccess.enabled}
                onChange={(value: boolean) =>
                  handleSettingChange('managerAccess', 'enabled', value)
                }
                label="Enable Manager Access to Feedback Results"
                contextType="feedback"
                urgencyScore={4}
                description="Agency feedback manager access enabled"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <LoggableSwitch
                fieldPath={`tenants:${tenantId}.aiSettings.feedback.managerAccess.requireOptIn`}
                trigger="update"
                destinationModules={['FeedbackEngine', 'ContextEngine']}
                value={settings.managerAccess.requireOptIn}
                onChange={(value: boolean) =>
                  handleSettingChange('managerAccess', 'requireOptIn', value)
                }
                label="Require Worker Opt-in"
                contextType="feedback"
                urgencyScore={4}
                description="Agency feedback require worker opt-in"
                disabled={!settings.managerAccess.enabled}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <LoggableSelect
                fieldPath={`tenants:${tenantId}.aiSettings.feedback.managerAccess.accessLevel`}
                trigger="update"
                destinationModules={['FeedbackEngine', 'ContextEngine']}
                value={settings.managerAccess.accessLevel}
                onChange={(value: string) =>
                  handleSettingChange('managerAccess', 'accessLevel', value)
                }
                label="Access Level"
                options={[
                  { value: 'summary', label: 'Summary Only' },
                  { value: 'detailed', label: 'Detailed Analysis' },
                  { value: 'full', label: 'Full Access' }
                ]}
                contextType="feedback"
                urgencyScore={4}
                description="Agency feedback manager access level"
                disabled={!settings.managerAccess.enabled}
              />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* AI Follow-up */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>AI Follow-up</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.aiFollowUp.enabled}
                    onChange={(e) => handleSettingChange('aiFollowUp', 'enabled', e.target.checked)}
                  />
                }
                label="Enable AI-managed Follow-up"
              />
              <Tooltip title="AI will automatically follow up with workers based on sentiment analysis">
                <IconButton size="small" sx={{ ml: 1 }}>
                  <HelpOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography gutterBottom>
                Trigger Threshold: {settings.aiFollowUp.triggerThreshold}
              </Typography>
              <Slider
                value={settings.aiFollowUp.triggerThreshold}
                min={0.1}
                max={1}
                step={0.1}
                onChange={(valueOrEvent: any, maybeValue?: any) => {
                  const value = typeof valueOrEvent === 'number' ? valueOrEvent : maybeValue;
                  handleSettingChange('aiFollowUp', 'triggerThreshold', value);
                }}
                disabled={!settings.aiFollowUp.enabled}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                label="Max Follow-ups"
                type="number"
                value={settings.aiFollowUp.maxFollowUps}
                onChange={(e) =>
                  handleSettingChange('aiFollowUp', 'maxFollowUps', parseInt(e.target.value))
                }
                fullWidth
                inputProps={{ min: 1, max: 10 }}
                disabled={!settings.aiFollowUp.enabled}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                label="Follow-up Delay (hours)"
                type="number"
                value={settings.aiFollowUp.followUpDelay}
                onChange={(e) =>
                  handleSettingChange('aiFollowUp', 'followUpDelay', parseInt(e.target.value))
                }
                fullWidth
                inputProps={{ min: 1, max: 168 }}
                disabled={!settings.aiFollowUp.enabled}
              />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Anonymity Settings */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Anonymity Settings</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.anonymity.defaultAnonymous}
                    onChange={(e) =>
                      handleSettingChange('anonymity', 'defaultAnonymous', e.target.checked)
                    }
                  />
                }
                label="Default to Anonymous Feedback"
              />
              <Tooltip title="New feedback submissions will be anonymous by default">
                <IconButton size="small" sx={{ ml: 1 }}>
                  <HelpOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.anonymity.allowWorkerChoice}
                    onChange={(e) =>
                      handleSettingChange('anonymity', 'allowWorkerChoice', e.target.checked)
                    }
                  />
                }
                label="Allow Workers to Choose Anonymity"
              />
              <Tooltip title="Workers can choose whether their feedback is anonymous or not">
                <IconButton size="small" sx={{ ml: 1 }}>
                  <HelpOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.anonymity.anonymizeInReports}
                    onChange={(e) =>
                      handleSettingChange('anonymity', 'anonymizeInReports', e.target.checked)
                    }
                  />
                }
                label="Anonymize Data in Reports"
              />
              <Tooltip title="Remove identifying information from feedback reports and analytics">
                <IconButton size="small" sx={{ ml: 1 }}>
                  <HelpOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Notifications */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Notifications</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.notifications.enableAlerts}
                    onChange={(e) =>
                      handleSettingChange('notifications', 'enableAlerts', e.target.checked)
                    }
                  />
                }
                label="Enable Feedback Alerts"
              />
              <Tooltip title="Receive notifications for concerning feedback patterns">
                <IconButton size="small" sx={{ ml: 1 }}>
                  <HelpOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography gutterBottom>
                Alert Threshold: {settings.notifications.alertThreshold}
              </Typography>
              <Slider
                value={settings.notifications.alertThreshold}
                min={0.1}
                max={1}
                step={0.1}
                onChange={(valueOrEvent: any, maybeValue?: any) => {
                  const value = typeof valueOrEvent === 'number' ? valueOrEvent : maybeValue;
                  handleSettingChange('notifications', 'alertThreshold', value);
                }}
                disabled={!settings.notifications.enableAlerts}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.notifications.notifyManagers}
                    onChange={(e) =>
                      handleSettingChange('notifications', 'notifyManagers', e.target.checked)
                    }
                    disabled={!settings.notifications.enableAlerts}
                  />
                }
                label="Notify Managers"
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.notifications.notifyHR}
                    onChange={(e) =>
                      handleSettingChange('notifications', 'notifyHR', e.target.checked)
                    }
                    disabled={!settings.notifications.enableAlerts}
                  />
                }
                label="Notify HR"
              />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      <Button variant="contained" onClick={handleSave} disabled={!isChanged} sx={{ mt: 3 }}>
        Save Feedback Engine Settings
      </Button>

      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Feedback engine settings updated!
        </Alert>
      </Snackbar>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export default FeedbackEngineSettings;
