import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Switch,
  FormControlLabel,
  Card,
  CardContent,
  CardHeader,
  Divider,
  Alert,
  Button,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Autocomplete,
  Slider,
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

const RecruiterSettings: React.FC = () => {
  const { tenantId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  const [settings, setSettings] = useState({
    applicationSettings: {
      enableApplications: true,
      requireResume: true,
      allowQuickApply: true,
      autoScreening: true,
      applicationDeadline: 30, // days
      maxApplicationsPerJob: 100,
    },
    aiScoring: {
      enabled: true,
      skillWeight: 70,
      experienceWeight: 20,
      locationWeight: 10,
      minimumScore: 60,
      autoRejectBelow: 30,
    },
    internalMobility: {
      enabled: true,
      allowInternalTransfers: true,
      requireManagerApproval: true,
      skillGapThreshold: 20,
      promotionPathways: true,
      crossDepartmentMoves: true,
    },
    notificationSettings: {
      newApplications: true,
      aiScoreUpdates: true,
      internalMobilityRequests: true,
      managerApprovals: true,
    },
  });

  useEffect(() => {
    loadSettings();
  }, [tenantId]);

  const loadSettings = async () => {
    if (!tenantId) return;
    
    try {
      const settingsRef = doc(db, 'tenants', tenantId, 'settings', 'recruiter');
      const settingsDoc = await getDoc(settingsRef);
      
      if (settingsDoc.exists()) {
        setSettings(prev => ({ ...prev, ...settingsDoc.data() }));
      }
    } catch (error) {
      console.error('Error loading recruiter settings:', error);
      setMessage({ type: 'error', text: 'Failed to load settings' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!tenantId) return;
    
    setSaving(true);
    try {
      const settingsRef = doc(db, 'tenants', tenantId, 'settings', 'recruiter');
      await updateDoc(settingsRef, {
        ...settings,
        updatedAt: new Date(),
      });
      
      setMessage({ type: 'success', text: 'Settings saved successfully' });
    } catch (error) {
      console.error('Error saving recruiter settings:', error);
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const handleSettingChange = (key: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleNestedSettingChange = (parentKey: string, childKey: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [parentKey]: {
        ...(prev as any)[parentKey],
        [childKey]: value,
      },
    }));
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>Loading Recruiter Settings...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        HRX Recruiter Settings
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Configure application settings, AI scoring, and internal mobility logic for your recruitment process.
      </Typography>

      {message && (
        <Alert severity={message.type} sx={{ mb: 3 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Application Settings */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Application Settings" />
            <CardContent>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.applicationSettings.enableApplications}
                    onChange={(e) => handleNestedSettingChange('applicationSettings', 'enableApplications', e.target.checked)}
                  />
                }
                label="Enable Applications"
              />
              
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.applicationSettings.requireResume}
                    onChange={(e) => handleNestedSettingChange('applicationSettings', 'requireResume', e.target.checked)}
                  />
                }
                label="Require Resume"
                sx={{ mt: 1, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.applicationSettings.allowQuickApply}
                    onChange={(e) => handleNestedSettingChange('applicationSettings', 'allowQuickApply', e.target.checked)}
                  />
                }
                label="Allow Quick Apply"
                sx={{ mt: 1, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.applicationSettings.autoScreening}
                    onChange={(e) => handleNestedSettingChange('applicationSettings', 'autoScreening', e.target.checked)}
                  />
                }
                label="Enable Auto-Screening"
                sx={{ mt: 1, display: 'block' }}
              />

              <TextField
                fullWidth
                type="number"
                label="Application Deadline (days)"
                value={settings.applicationSettings.applicationDeadline}
                onChange={(e) => handleNestedSettingChange('applicationSettings', 'applicationDeadline', parseInt(e.target.value))}
                sx={{ mt: 2 }}
              />

              <TextField
                fullWidth
                type="number"
                label="Max Applications Per Job"
                value={settings.applicationSettings.maxApplicationsPerJob}
                onChange={(e) => handleNestedSettingChange('applicationSettings', 'maxApplicationsPerJob', parseInt(e.target.value))}
                sx={{ mt: 2 }}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* AI Scoring */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="AI Scoring" />
            <CardContent>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.aiScoring.enabled}
                    onChange={(e) => handleNestedSettingChange('aiScoring', 'enabled', e.target.checked)}
                  />
                }
                label="Enable AI Scoring"
              />

              <Typography gutterBottom sx={{ mt: 2 }}>
                Skill Weight: {settings.aiScoring.skillWeight}%
              </Typography>
              <Slider
                value={settings.aiScoring.skillWeight}
                onChange={(_, value) => handleNestedSettingChange('aiScoring', 'skillWeight', value)}
                min={0}
                max={100}
                valueLabelDisplay="auto"
                sx={{ mb: 2 }}
              />

              <Typography gutterBottom>
                Experience Weight: {settings.aiScoring.experienceWeight}%
              </Typography>
              <Slider
                value={settings.aiScoring.experienceWeight}
                onChange={(_, value) => handleNestedSettingChange('aiScoring', 'experienceWeight', value)}
                min={0}
                max={100}
                valueLabelDisplay="auto"
                sx={{ mb: 2 }}
              />

              <Typography gutterBottom>
                Location Weight: {settings.aiScoring.locationWeight}%
              </Typography>
              <Slider
                value={settings.aiScoring.locationWeight}
                onChange={(_, value) => handleNestedSettingChange('aiScoring', 'locationWeight', value)}
                min={0}
                max={100}
                valueLabelDisplay="auto"
                sx={{ mb: 2 }}
              />

              <TextField
                fullWidth
                type="number"
                label="Minimum Score"
                value={settings.aiScoring.minimumScore}
                onChange={(e) => handleNestedSettingChange('aiScoring', 'minimumScore', parseInt(e.target.value))}
                sx={{ mb: 2 }}
              />

              <TextField
                fullWidth
                type="number"
                label="Auto-Reject Below Score"
                value={settings.aiScoring.autoRejectBelow}
                onChange={(e) => handleNestedSettingChange('aiScoring', 'autoRejectBelow', parseInt(e.target.value))}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* Internal Mobility */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Internal Mobility" />
            <CardContent>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.internalMobility.enabled}
                    onChange={(e) => handleNestedSettingChange('internalMobility', 'enabled', e.target.checked)}
                  />
                }
                label="Enable Internal Mobility"
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.internalMobility.allowInternalTransfers}
                    onChange={(e) => handleNestedSettingChange('internalMobility', 'allowInternalTransfers', e.target.checked)}
                  />
                }
                label="Allow Internal Transfers"
                sx={{ mt: 1, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.internalMobility.requireManagerApproval}
                    onChange={(e) => handleNestedSettingChange('internalMobility', 'requireManagerApproval', e.target.checked)}
                  />
                }
                label="Require Manager Approval"
                sx={{ mt: 1, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.internalMobility.promotionPathways}
                    onChange={(e) => handleNestedSettingChange('internalMobility', 'promotionPathways', e.target.checked)}
                  />
                }
                label="Enable Promotion Pathways"
                sx={{ mt: 1, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.internalMobility.crossDepartmentMoves}
                    onChange={(e) => handleNestedSettingChange('internalMobility', 'crossDepartmentMoves', e.target.checked)}
                  />
                }
                label="Allow Cross-Department Moves"
                sx={{ mt: 1, display: 'block' }}
              />

              <TextField
                fullWidth
                type="number"
                label="Skill Gap Threshold (%)"
                value={settings.internalMobility.skillGapThreshold}
                onChange={(e) => handleNestedSettingChange('internalMobility', 'skillGapThreshold', parseInt(e.target.value))}
                sx={{ mt: 2 }}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* Notification Settings */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Notification Settings" />
            <CardContent>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.notificationSettings.newApplications}
                    onChange={(e) => handleNestedSettingChange('notificationSettings', 'newApplications', e.target.checked)}
                  />
                }
                label="New Applications"
                sx={{ mt: 1, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.notificationSettings.aiScoreUpdates}
                    onChange={(e) => handleNestedSettingChange('notificationSettings', 'aiScoreUpdates', e.target.checked)}
                  />
                }
                label="AI Score Updates"
                sx={{ mt: 1, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.notificationSettings.internalMobilityRequests}
                    onChange={(e) => handleNestedSettingChange('notificationSettings', 'internalMobilityRequests', e.target.checked)}
                  />
                }
                label="Internal Mobility Requests"
                sx={{ mt: 1, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.notificationSettings.managerApprovals}
                    onChange={(e) => handleNestedSettingChange('notificationSettings', 'managerApprovals', e.target.checked)}
                  />
                }
                label="Manager Approvals"
                sx={{ mt: 1, display: 'block' }}
              />
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          size="large"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </Box>
    </Box>
  );
};

export default RecruiterSettings; 